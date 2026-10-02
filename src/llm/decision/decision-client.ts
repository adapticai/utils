/**
 * The decision client: the one exported way to ask a typed decision model.
 *
 * A caller names a route and hands over a state and the questions about it. It
 * receives validated answers from the model the route pins, or a rejection of
 * one of a closed set of classes. There is no third outcome, and nothing in
 * between is the caller's to arrange: which model is asked, where it is
 * reached, how long the call may take and whether the route may be called at
 * all are read from the route table.
 *
 * A call is one attempt on one route. Nothing here retries, hedges or falls
 * back. A typed call runs inside a deadline measured in fractions of a second,
 * and a second attempt made here would spend the time the caller's next step
 * needs while hiding that the first one failed. Which route to try next is the
 * caller's decision, made with the first failure in hand.
 *
 * The order of a call is the order of what it costs to refuse it. A route that
 * is closed is refused first, before the request is looked at. A request that
 * must not be sent is refused next, before any guard is charged. Only then is
 * the route's breaker consulted, a place taken in this process's own rate and
 * concurrency guards, and the vendor contacted.
 *
 * One budget covers the whole call: the wait for this package's own guards and
 * the vendor's answer together. A call still queued when the budget runs out
 * was never sent, so it ends as an admission fault that cost nothing; a call
 * the budget overtakes after dispatch ends as a timeout, because the vendor
 * may have done the work.
 *
 * The answering model is compared with the route's pin before the answer is
 * read. A serving stack that substitutes another model returns answers of the
 * right shape from the wrong source, and a body that has been validated reads
 * as trustworthy, so the comparison comes first and is made on the whole id.
 *
 * Every rejection is one of this package's decision errors, with the record
 * of the attempt attached. A failure that arrives as anything else (a throw
 * from a caller's own getter, from an injected clock or transport, from this
 * file's own code) is given the fault of the stage the call had reached, and
 * is described by its class and system code and never by its message, which
 * can quote the request it failed on. A failure of the client's own machinery
 * has a fault of its own, so it is never counted as the vendor's. So a
 * consumer that keys on the fault never meets a rejection that has none.
 *
 * The breaker measures one thing: whether the vendor can be reached in time.
 * A rejected key, a rejected request, a malformed answer and a substituted
 * model each arrived in time from a vendor that was reachable, and each has a
 * fault class of its own, so none of them is counted against the route. The
 * registry is this client's own and shares nothing with the generative
 * client's: a typed route and a generative leg fail for unrelated reasons, and
 * a registry they shared would let either close the other.
 *
 * @module llm/decision/decision-client
 */

import { CircuitBreakerRegistry } from "../circuit-breaker";
import type { BreakerFailureKind } from "../circuit-breaker";
import { RateGuardTimeoutError, withProviderGuards } from "../rate-guard";
import { describeFailure, withoutCredential } from "../transports/failure-description";
import { decodeDecisionResponse, encodeDecisionRequest, resolveProbabilitySumTolerance } from "./codec";
import type { DecodedDecisionResponse } from "./codec";
import { decisionRouteTable, decisionRouteViolations, resolveDecisionRoute } from "./decision-route-table";
import {
  DecisionAdmissionError,
  DecisionCallError,
  DecisionClientFaultError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
  DecisionRouteMismatchError,
  DecisionRouteUnavailableError,
  DecisionTimeoutError,
  DecisionTransportError,
  decisionErrorExcerpt,
} from "./errors";
import type { DecisionTimeoutSource } from "./errors";
import type { DecisionRouteTable, ResolvedDecisionRoute } from "./route-types";
import { createSystemOneTransport, decisionFaultForStatus } from "./transports/systemone";
import type { SystemOneTransport, SystemOneTransportResult } from "./transports/systemone";
import type {
  DecisionAttemptMeasurement,
  DecisionCallOptions,
  DecisionCallResult,
  DecisionRequest,
  DecisionRoute,
  DecisionWireRequest,
} from "./types";

/** What every key of the decision breaker registry begins with. */
const BREAKER_KEY_PREFIX = "decision:";

/** The path that names a request body itself, not a field of it. */
const ROOT_PATH = "$";

/** The path that names a call's options. */
const OPTIONS_PATH = "options";

/**
 * What a call is recorded under when the value given as its route is not text.
 *
 * A route is named in every error and every attempt record, so a value that
 * cannot be written there is replaced before anything reads it. No table
 * declares this name, so the call is refused like any other unknown route.
 */
const UNNAMED_ROUTE: string = "(not a route name)";

/** How the client is wired. Every field is optional; an absent one is the package's own. */
export interface DecisionClientConfig {
  /**
   * The route table to resolve against. The canonical one unless a test or an
   * onboarding probe supplies another.
   */
  readonly routeTable?: DecisionRouteTable;
  /** The transport to dispatch through. The hosted one unless a test supplies another. */
  readonly transport?: SystemOneTransport;
  /**
   * The current time in milliseconds since the epoch. The system clock unless
   * one is injected.
   *
   * It times the queue and the call, and it is the clock the breakers read a
   * cooldown against.
   */
  readonly now?: () => number;
}

/** A measurement of an attempt while the attempt is still being made. */
type AttemptInProgress = { -readonly [Field in keyof DecisionAttemptMeasurement]: DecisionAttemptMeasurement[Field] };

/** What an attempt tells the route's breaker. */
type BreakerVerdict =
  | { readonly kind: "reachable" }
  | { readonly kind: "failed"; readonly failureKind: BreakerFailureKind }
  /** The attempt never tested the vendor, so it says nothing about the route's health. */
  | { readonly kind: "none" };

/** How a guarded dispatch ended, or that the call's own budget or caller ended it first. */
type Settlement =
  | { readonly kind: "answered"; readonly result: SystemOneTransportResult }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "ended"; readonly ending: DecisionTimeoutError };

/**
 * How far a call has got, in the order a call moves through them.
 *
 * - `resolving`: the route is being looked up; nothing of the caller's has been read.
 * - `options`: the caller's options are being read.
 * - `request`: the caller's request is being copied, checked and written.
 * - `admitting`: the breaker and the guards are being passed; no request exists.
 * - `dispatched`: the transport has been invoked and has not answered.
 * - `answered`: an answer arrived and is being read.
 * - `recording`: the call has its outcome, and the breaker is being told.
 */
type CallStage = "resolving" | "options" | "request" | "admitting" | "dispatched" | "answered" | "recording";

/** What is known about a call while it runs. */
interface CallProgress {
  /** How far the call has got. It names what a failure of no known class is a failure of. */
  stage: CallStage;
  /** When the transport was invoked, or `null` while it has not been. */
  dispatchedAtMs: number | null;
  /**
   * The key the request was sent with, or empty while none was read.
   *
   * Held for the life of the call for one purpose: recognising it in what the
   * vendor sends back. It is never written anywhere.
   */
  key: string;
}

/** A call that has passed every check that costs nothing. */
interface PreparedCall {
  readonly resolved: ResolvedDecisionRoute;
  /** The request as it is sent: a private copy no caller holds a reference to. */
  readonly body: DecisionWireRequest;
  readonly budgetMs: number;
  readonly callerSignal: AbortSignal | undefined;
  readonly probabilitySumTolerance: number | undefined;
}

/** Active wiring. */
let config: DecisionClientConfig = {};

/** The hosted transport, built on first use and rebuilt whenever the wiring changes. */
let hostedTransport: SystemOneTransport | null = null;

/**
 * The decision routes' breakers.
 *
 * Process-wide, so every caller of a route reads one account of that route's
 * health. A different object from the generative client's registry, and keyed
 * in a namespace of its own.
 */
let breakers = new CircuitBreakerRegistry(decisionRouteTable.defaults.circuit_breaker);

/**
 * Wire the client.
 *
 * The published package runs on its defaults and never needs this. It exists
 * so a test can exercise a call without a network, and so the operator's
 * onboarding probe can address a table whose hosted route is open. Because a
 * table handed in here decides which routes may be called, a consumer that
 * restricts who may import the client must restrict this function with it.
 *
 * Calling it discards all breaker state: the breakers are built from the
 * table's own defaults and read the injected clock.
 *
 * @param next The wiring; an absent field is the package's own.
 * @returns void
 * @throws {Error} When the table breaks a rule the loader enforces. The wiring
 *   in force is then left as it was: a table that would have stopped the
 *   module from loading must not be installed at runtime either.
 */
export function configureDecisionClient(next: DecisionClientConfig = {}): void {
  const table = next.routeTable ?? decisionRouteTable;
  if (table !== decisionRouteTable) {
    const violations = decisionRouteViolations(table);
    if (violations.length > 0) {
      throw new Error(`decision route table is invalid: ${violations.join("; ")}`);
    }
  }
  config = { ...next };
  hostedTransport = null;
  breakers = new CircuitBreakerRegistry(table.defaults.circuit_breaker, next.now);
}

/**
 * Inspect decision-route health.
 *
 * @returns The live breaker registry of the decision routes.
 */
export function decisionBreakers(): CircuitBreakerRegistry {
  return breakers;
}

/**
 * The key a route's breaker is held under.
 *
 * @param route The route.
 * @returns Its key in {@link decisionBreakers}.
 */
export function decisionBreakerKey(route: DecisionRoute): string {
  return `${BREAKER_KEY_PREFIX}${route}`;
}

/**
 * The transport a call is dispatched through.
 *
 * @returns The injected transport, or the hosted one, built on first use.
 */
function transportFor(): SystemOneTransport {
  if (config.transport !== undefined) {
    return config.transport;
  }
  hostedTransport ??= createSystemOneTransport({ now: config.now });
  return hostedTransport;
}

/**
 * Whether a value is an array.
 *
 * @param value The value.
 * @returns True for an array, typed with elements that are still unknown.
 */
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Whether a value is a plain object.
 *
 * @param value The value.
 * @returns True for an object whose prototype is the plain one or none.
 */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || isList(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A promise and the function that settles it.
 *
 * @returns The promise, and its resolver.
 */
function deferred<Value>(): { readonly promise: Promise<Value>; readonly resolve: (value: Value) => void } {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * Rebuild a tree of arrays and plain objects, reading every member exactly once.
 *
 * The copy shares no container with its source, so nothing done to the source
 * afterwards can reach it, and a member that computes its value is asked for
 * it once, so the copy holds the value that was read and cannot later yield
 * another. Anything that is not an array, a plain object or text is carried as
 * it is, for whoever validates the copy to judge.
 *
 * The walk keeps its own stack, so a tree nested deeper than the call stack is
 * copied like any other. A container reached twice is copied once and the copy
 * reused, so a tree that contains itself yields a copy that contains itself,
 * and is not followed for ever.
 *
 * @param root The tree to copy.
 * @param textOf What each piece of text, key or value, is carried as.
 * @returns The copy.
 */
function rebuildTree(root: unknown, textOf: (text: string) => string): unknown {
  const copies = new Map<object, object>();
  const unfilled: (() => void)[] = [];
  const copyOf = (value: unknown): unknown => {
    if (typeof value === "string") {
      return textOf(value);
    }
    if (!isList(value) && !isPlainObject(value)) {
      return value;
    }
    const known = copies.get(value);
    if (known !== undefined) {
      return known;
    }
    if (isList(value)) {
      const list: unknown[] = [];
      copies.set(value, list);
      unfilled.push(() => {
        for (let index = 0; index < value.length; index += 1) {
          list.push(copyOf(value[index]));
        }
      });
      return list;
    }
    const fields: Record<string, unknown> = {};
    copies.set(value, fields);
    unfilled.push(() => {
      for (const key of Object.keys(value)) {
        // Defined, not assigned: a key that spells the name of an inherited
        // accessor would otherwise be handed to that accessor and lost.
        Object.defineProperty(fields, textOf(key), {
          value: copyOf(value[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    });
    return fields;
  };

  const rootCopy = copyOf(root);
  for (let fill = unfilled.pop(); fill !== undefined; fill = unfilled.pop()) {
    fill();
  }
  return rootCopy;
}

/**
 * Text carried as it is.
 *
 * @param text The text.
 * @returns The same text.
 */
function unchanged(text: string): string {
  return text;
}

/**
 * Build the error for a call that must not be made as it was asked.
 *
 * @param fieldPath The offending field.
 * @param reason What is wrong with it.
 * @returns The error; the route is completed with the attempt.
 */
function invalidCall(fieldPath: string, reason: string): DecisionRequestInvalidError {
  return new DecisionRequestInvalidError({ source: "request_validation", fieldPath, reason });
}

/**
 * Give a failure its decision error.
 *
 * A decision error is returned as it is. Anything else is a failure nobody
 * classified, and it is given the fault of the stage the call had reached,
 * which is the one thing the client knows for certain about it:
 *
 * - while the caller's options or request were being read, the call was asked
 *   for in a way that cannot be honoured, which is the caller's defect;
 * - after the transport was invoked and before it answered, the vendor gave
 *   no answer;
 * - after an answer arrived, the answer could not be read;
 * - at every other stage the failure is this package's own machinery or
 *   something it was wired with (the route table, the breaker, the guards,
 *   the clock), and it is raised as the fault that means exactly that. It is
 *   not a statement about the vendor, so it is never filed with the vendor's
 *   failures.
 *
 * The failure is described by the class name and system code of it and of
 * its causes and never by its message, which is free text and can quote the
 * request, the vendor's answer or the header the key travels in.
 *
 * @param error Whatever was thrown.
 * @param progress How far the call had got, and the key it was sent with.
 * @param route The route the call is recorded under.
 * @returns The decision error to raise; the attempt is attached by the caller.
 */
function typedFailure(error: unknown, progress: CallProgress, route: DecisionRoute): DecisionCallError {
  if (error instanceof DecisionCallError) {
    return error;
  }
  const failure = withoutCredential(describeFailure(error), progress.key);
  switch (progress.stage) {
    case "options":
      return invalidCall(OPTIONS_PATH, `the options could not be read: reading them raised ${failure}`);
    case "request":
      return invalidCall(ROOT_PATH, `the request could not be read: reading it raised ${failure}`);
    case "dispatched":
      return new DecisionTransportError({
        source: "network",
        route,
        retryable: false,
        detail: `the transport raised a failure that is not a decision fault: ${failure}`,
      });
    case "answered":
      return new DecisionResponseFormatError({
        fieldPath: ROOT_PATH,
        reason: `the answer could not be read: reading it raised ${failure}`,
        status: null,
        usage: null,
        vendorRequestId: null,
      });
    case "resolving":
    case "admitting":
    case "recording":
      return new DecisionClientFaultError({ route, stage: progress.stage, description: failure });
  }
}

/**
 * The caller's own id for a call, read without assuming the options are usable.
 *
 * It is read before anything is checked so that even a call refused at its
 * first step is recorded under the id its caller gave it. Options whose id
 * cannot be read yield no id here and are refused where the options are
 * checked, which is after the route has been resolved: a closed route is
 * refused as closed whatever was passed with it.
 *
 * @param options The options as passed.
 * @returns The id, or `null` when none was given or the options cannot be read.
 */
function correlationIdOf(options: unknown): string | null {
  if (typeof options !== "object" || options === null) {
    return null;
  }
  let correlationId: unknown;
  try {
    correlationId = (options as DecisionCallOptions).correlationId;
  } catch {
    correlationId = undefined;
  }
  return typeof correlationId === "string" ? correlationId : null;
}

/**
 * Check the options of a call.
 *
 * An option that cannot be honoured is refused, never replaced by a default.
 * A deadline that is not a number would otherwise run under the route's whole
 * budget, which is a longer wait than the one the caller asked for.
 *
 * Each option is read once and the values read are what the call runs on, so
 * an option that answers differently when asked again cannot be checked as one
 * value and used as another.
 *
 * @param options The options as passed.
 * @returns The options as they were read, known to be usable.
 * @throws {DecisionRequestInvalidError} Naming the option that cannot be honoured.
 */
function usableOptions(options: DecisionCallOptions): DecisionCallOptions {
  const given: unknown = options;
  if (typeof given !== "object" || given === null) {
    throw invalidCall(OPTIONS_PATH, "a call's options must be an object; leave them out to run on the route's own terms");
  }
  const { timeoutMs, signal, correlationId, probabilitySumTolerance } = options;
  if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || Number.isNaN(timeoutMs))) {
    throw invalidCall(
      "options.timeoutMs",
      "a deadline must be a number of milliseconds; leave it out to run under the route's budget",
    );
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw invalidCall("options.signal", "a signal must be an AbortSignal");
  }
  if (correlationId !== undefined && typeof correlationId !== "string") {
    throw invalidCall("options.correlationId", "a correlation id must be a string");
  }
  resolveProbabilitySumTolerance(probabilitySumTolerance);
  return { timeoutMs, signal, correlationId, probabilitySumTolerance };
}

/**
 * Require that a request can be written as JSON.
 *
 * The transport writes the body when the call is dispatched, which is after a
 * place in the guards has been taken. Writing it once here, where nothing has
 * been charged, makes a request that cannot be written a refusal that costs
 * nothing.
 *
 * @param body The request as it is sent.
 * @throws {DecisionRequestInvalidError} When the request cannot be written.
 */
function assertWritable(body: DecisionWireRequest): void {
  let text: string | undefined;
  try {
    text = JSON.stringify(body);
  } catch {
    text = undefined;
  }
  if (typeof text !== "string") {
    throw invalidCall(ROOT_PATH, "the request cannot be written as JSON");
  }
}

/**
 * Everything about a call that can be settled without charging anything.
 *
 * The route is resolved first, so a closed route is refused before the request
 * or the options are looked at. The request is then copied, checked and
 * written in one synchronous step, before the call returns its promise: what
 * is sent is the copy, so a caller that changes its request while the call
 * waits for admission changes nothing that reaches the vendor, and the answer
 * is read against the questions that were sent.
 *
 * @param route The route the caller named.
 * @param request The caller's request.
 * @param options The caller's options.
 * @param measured The attempt's measurement, filled as facts become known.
 * @param progress How far the call has got, advanced here stage by stage.
 * @returns The prepared call.
 * @throws {DecisionRouteUnavailableError} When the route may not be called.
 * @throws {DecisionRequestInvalidError} When the options or the request cannot be honoured.
 */
function prepareCall(
  route: DecisionRoute,
  request: DecisionRequest,
  options: DecisionCallOptions,
  measured: AttemptInProgress,
  progress: CallProgress,
): PreparedCall {
  const resolved = resolveDecisionRoute(route, config.routeTable ?? decisionRouteTable);
  measured.provider = resolved.providerName;
  measured.modelPin = resolved.modelPin;

  progress.stage = "options";
  const { timeoutMs, signal, probabilitySumTolerance } = usableOptions(options);

  progress.stage = "request";
  const body = encodeDecisionRequest(rebuildTree(request, unchanged) as DecisionRequest, {
    model: resolved.modelPin,
    caps: resolved.caps,
  });
  assertWritable(body);

  // The caller's deadline narrows the route's budget and never widens it. One
  // that has already passed leaves no budget at all.
  const budgetMs = timeoutMs === undefined ? resolved.budgetMs : Math.max(0, Math.min(resolved.budgetMs, timeoutMs));
  measured.budgetMs = budgetMs;
  progress.stage = "admitting";
  return { resolved, body, budgetMs, callerSignal: signal, probabilitySumTolerance };
}

/**
 * Say why a route's breaker is refusing calls.
 *
 * @param registry The registry that refused the call.
 * @param key The route's breaker key.
 * @returns The reason, in words an operator can act on.
 */
function breakerRefusal(registry: CircuitBreakerRegistry, key: string): string {
  const snapshot = registry.snapshot(key);
  return snapshot.state === "open"
    ? `the route's circuit breaker opened after ${snapshot.consecutiveFailures} consecutive failure(s) ` +
        `and admits a probe once its ${snapshot.cooldownMs} ms cooldown has run`
    : `the route's circuit breaker is testing recovery and its ${snapshot.probeBudget} probe(s) are in flight`;
}

/**
 * What a fault raised by the transport tells the route's breaker.
 *
 * Only a transport fault counts against the route, as the vendor being full or
 * the vendor failing. Any other fault that arrived with a status came from a
 * vendor that was reachable in time. A fault with no status was raised before
 * a request existed, so the vendor was not tested.
 *
 * @param error The fault.
 * @returns The verdict.
 */
function verdictOf(error: DecisionCallError): BreakerVerdict {
  if (error instanceof DecisionTransportError) {
    const statusFault = error.status === null ? null : decisionFaultForStatus(error.status);
    return { kind: "failed", failureKind: statusFault?.breakerKind ?? "hard" };
  }
  return error.status === null ? { kind: "none" } : { kind: "reachable" };
}

/**
 * Validate an answer against the request it answers.
 *
 * A rejection's field path can quote a key the vendor sent, and a vendor can
 * quote back the credential it was given. So when a body is rejected, the
 * rejection that is raised is built from a copy of the body with the
 * credential taken out of every key and every piece of text, and never from
 * the body as received.
 *
 * @param result What the transport returned.
 * @param prepared The call, with the request as it was sent.
 * @param key The key the request was sent with, or empty when none was read.
 * @returns The validated answers.
 * @throws {DecisionResponseFormatError} When the body fails validation.
 */
function decodeAnswered(
  result: SystemOneTransportResult,
  prepared: PreparedCall,
  key: string,
): DecodedDecisionResponse {
  const decodeOptions = {
    probabilitySumTolerance: prepared.probabilitySumTolerance,
    billedUsage: result.usage,
  };
  try {
    return decodeDecisionResponse(result.payload, prepared.body, decodeOptions);
  } catch (error) {
    if (!(error instanceof DecisionResponseFormatError) || key === "") {
      throw error;
    }
  }
  decodeDecisionResponse(
    rebuildTree(result.payload, (text) => withoutCredential(text, key)),
    prepared.body,
    decodeOptions,
  );
  // Reached only when the body is sound once the credential is taken out of
  // it, so what failed validation was the credential's own text.
  throw new DecisionResponseFormatError({
    fieldPath: ROOT_PATH,
    reason: "the body fails validation where it quotes the credential the request was sent with",
    status: result.status,
    usage: result.usage,
    vendorRequestId: null,
  });
}

/**
 * Turn a transport's answer into the caller's result.
 *
 * The answering model is compared with the route's pin first, on the whole id
 * as the vendor reported it, and only an answer from the pin is decoded.
 *
 * @param result What the transport returned.
 * @param prepared The call.
 * @param measured The attempt's measurement, completed here.
 * @param key The key the request was sent with, or empty when none was read.
 * @returns The caller's result.
 * @throws {DecisionRouteMismatchError} When another model answered.
 * @throws {DecisionResponseFormatError} When the body fails validation.
 */
function resultOf(
  result: SystemOneTransportResult,
  prepared: PreparedCall,
  measured: AttemptInProgress,
  key: string,
): DecisionCallResult {
  const { resolved } = prepared;
  const vendorRequestId =
    result.vendorRequestId === null ? null : decisionErrorExcerpt(withoutCredential(result.vendorRequestId, key));
  measured.status = result.status;
  measured.vendorRequestId = vendorRequestId;
  measured.usage = result.usage;
  measured.servedModel = withoutCredential(result.servedModel, key);

  if (result.servedModel !== resolved.expectedServedModel) {
    throw new DecisionRouteMismatchError({
      route: resolved.route,
      expectedServedModel: resolved.expectedServedModel,
      servedModel: measured.servedModel,
      status: result.status,
      usage: result.usage,
      vendorRequestId,
    });
  }

  const decoded = decodeAnswered(result, prepared, key);
  return {
    route: resolved.route,
    answers: decoded.answers,
    probabilitySums: decoded.probabilitySums,
    servedModel: result.servedModel,
    usage: result.usage,
    vendorRequestId,
    attempt: {
      ...measured,
      outcome: "ok",
      fault: null,
      provider: resolved.providerName,
      modelPin: resolved.modelPin,
      status: result.status,
      durationMs: measured.durationMs ?? result.durationMs,
      budgetMs: prepared.budgetMs,
      servedModel: result.servedModel,
      usage: result.usage,
    },
  };
}

/**
 * Make the one attempt of a prepared call.
 *
 * @param prepared The call.
 * @param measured The attempt's measurement, filled as facts become known.
 * @param progress How far the call has got, advanced here stage by stage.
 * @param now The clock.
 * @returns The caller's result.
 * @throws {DecisionCallError} For every way the attempt is known to fail. A
 *   failure of no known class is rethrown as it is, with the breaker already
 *   told what it means, for the caller of this function to give a fault.
 */
async function runAttempt(
  prepared: PreparedCall,
  measured: AttemptInProgress,
  progress: CallProgress,
  now: () => number,
): Promise<DecisionCallResult> {
  const { resolved, body, budgetMs, callerSignal } = prepared;
  const route = resolved.route;
  if (budgetMs <= 0) {
    throw new DecisionAdmissionError({ route, source: "route_budget", budgetMs });
  }
  if (callerSignal?.aborted === true) {
    throw new DecisionAdmissionError({ route, source: "caller_signal", budgetMs });
  }

  // One registry for the whole attempt, so a rewiring made while the call is
  // in flight cannot split its bookkeeping between two.
  const registry = breakers;
  const key = decisionBreakerKey(route);
  if (!registry.allows(key)) {
    throw new DecisionRouteUnavailableError({ route, code: "breaker_open", reason: breakerRefusal(registry, key) });
  }
  const holdsProbe = registry.onAttemptStart(key);
  let verdict: BreakerVerdict = { kind: "none" };

  const controller = new AbortController();
  const settled = deferred<Settlement>();

  /**
   * End the call. The first end stands. The call is settled before the signal
   * is aborted, so the end decides the outcome and nothing the abort sets off
   * can. The reason given to the signal is the timeout a dispatched call is
   * raised as, so the transport rejects with the very error the caller
   * receives. The reason the caller aborted its own signal with is not passed
   * on: it is the caller's value, of any type and with any content, and the
   * caller already holds it.
   *
   * @param source Whether the budget ran out or the caller stopped waiting.
   * @returns void
   */
  const end = (source: DecisionTimeoutSource): void => {
    if (!controller.signal.aborted) {
      const ending = new DecisionTimeoutError({ route, source, budgetMs });
      settled.resolve({ kind: "ended", ending });
      controller.abort(ending);
    }
  };
  const onCallerAbort = (): void => {
    end("caller_signal");
  };
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Everything from here runs under the `finally` below. The attempt is
  // already counted by the breaker, and may hold its one probe slot, so
  // nothing that can throw may come between taking that and the code that
  // gives it back.
  try {
    const transport = transportFor();
    const queuedAtMs = now();
    timer = setTimeout(() => {
      end("route_budget");
    }, budgetMs);
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

    /**
     * Invoke the transport, once.
     *
     * A place in the guards can be granted to a call that has just ended: a
     * waiter leaves either queue the moment the signal aborts, but one that
     * was admitted in that same moment is already on its way here. Such a call
     * is not dispatched.
     *
     * @returns The transport's result.
     */
    const send = async (): Promise<SystemOneTransportResult> => {
      if (controller.signal.aborted) {
        const reason: unknown = controller.signal.reason;
        throw reason;
      }
      progress.dispatchedAtMs = now();
      progress.stage = "dispatched";
      progress.key = (process.env[resolved.apiKeyEnv] ?? "").trim();
      return transport.execute({ route: resolved, body, signal: controller.signal });
    };

    // The guarded dispatch is raced against the call's end. The guards hear
    // the same signal in both of their queues, so a call that has ended takes
    // neither a rate token nor a permit, and the race is what makes the end,
    // not their refusal, the call's outcome.
    withProviderGuards(resolved.providerName, send, budgetMs, {
      modelId: resolved.modelPin,
      signal: controller.signal,
      signalEndsRateWait: true,
    }).then(
      (result) => {
        settled.resolve({ kind: "answered", result });
      },
      (error: unknown) => {
        settled.resolve({ kind: "failed", error });
      },
    );
    const settlement = await settled.promise;

    const settledAtMs = now();
    const dispatchedAtMs = progress.dispatchedAtMs;
    measured.queueMs = (dispatchedAtMs ?? settledAtMs) - queuedAtMs;
    measured.durationMs = dispatchedAtMs === null ? null : settledAtMs - dispatchedAtMs;

    if (settlement.kind === "answered") {
      // An answer arrived in time, whatever is then made of it.
      verdict = { kind: "reachable" };
      progress.stage = "answered";
      return resultOf(settlement.result, prepared, measured, progress.key);
    }

    if (settlement.kind === "ended") {
      const { ending } = settlement;
      if (dispatchedAtMs === null) {
        throw new DecisionAdmissionError({ route, source: ending.source, budgetMs });
      }
      // A vendor that did not answer inside the budget is counted as full. A
      // caller that left says nothing about the vendor.
      if (ending.source === "route_budget") {
        verdict = { kind: "failed", failureKind: "capacity" };
      }
      throw ending;
    }

    const { error } = settlement;
    if (dispatchedAtMs === null && error instanceof RateGuardTimeoutError) {
      throw new DecisionAdmissionError({ route, source: "provider_guard", budgetMs });
    }
    if (error instanceof DecisionCallError) {
      verdict = verdictOf(error);
      throw error;
    }
    // A failure of no known class. From a transport that was invoked, it is a
    // vendor that gave no answer and counts against the route. Before that,
    // no request existed and the vendor was not tested.
    if (dispatchedAtMs !== null) {
      verdict = { kind: "failed", failureKind: "hard" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    // The outcome is decided. What follows only tells the breaker, and a
    // failure while telling it is a failure of that stage and of no earlier one.
    const outcomeStage = progress.stage;
    progress.stage = "recording";
    try {
      if (verdict.kind === "reachable") {
        registry.onSuccess(key, progress.dispatchedAtMs ?? undefined);
      } else if (verdict.kind === "failed") {
        registry.onFailure(key, verdict.failureKind);
      } else if (holdsProbe) {
        // No verdict, but the probe slot this attempt took must come back, or
        // a half-open route admits no probe again.
        registry.onAttemptAbandoned(key);
      }
    } finally {
      registry.onAttemptEnd(key);
    }
    progress.stage = outcomeStage;
  }
}

/**
 * Ask a typed decision model the questions of a request, on one route.
 *
 * @param route The route to ask on.
 * @param request The state, and the questions about it keyed by the caller's ids.
 * @param options The caller's deadline, cancellation, tracing id and sum tolerance.
 * @returns The validated answers, each distribution's raw sum, the answering
 *   model, what the call cost and the record of the attempt.
 * @throws {DecisionCallError} For every failure, with the attempt attached. A
 *   failure never resolves: there is no default answer and no partial result.
 *   Nothing else is ever thrown: a failure that is not a decision error when
 *   it reaches the client leaves it as one, with the fault of the stage the
 *   call had reached. A caller that aborts its own signal receives a timeout
 *   or an admission fault whose source is `caller_signal`, never the reason
 *   it aborted with.
 */
export async function callDecisionModel(
  route: DecisionRoute,
  request: DecisionRequest,
  options: DecisionCallOptions = {},
): Promise<DecisionCallResult> {
  // The value given as the route is written into every error and record of
  // the call, so one that is not text is replaced before anything reads it.
  const given: unknown = route;
  const named = (typeof given === "string" ? given : UNNAMED_ROUTE) as DecisionRoute;
  const progress: CallProgress = { stage: "resolving", dispatchedAtMs: null, key: "" };
  const measured: AttemptInProgress = {
    route: named,
    provider: null,
    modelPin: null,
    status: null,
    queueMs: null,
    durationMs: null,
    budgetMs: null,
    retryAfterMs: null,
    vendorRequestId: null,
    servedModel: null,
    usage: null,
    correlationId: correlationIdOf(options),
  };
  try {
    const prepared = prepareCall(named, request, options, measured, progress);
    return await runAttempt(prepared, measured, progress, config.now ?? Date.now);
  } catch (error) {
    throw typedFailure(error, progress, named).withAttempt({ ...measured });
  }
}
