/**
 * A scripted stand-in for the hosted decision transport.
 *
 * What the decision client guarantees is all about what it does around the
 * transport: whether it calls it at all, how many times, with what body and
 * under which signal, and what it makes of each outcome. Observing those needs
 * a transport whose every outcome the test chooses and whose every invocation
 * is recorded, so an assertion can be made about a call that never happened.
 *
 * Each invocation is recorded as it stood at the moment of dispatch: the body
 * is written to text there and then, and the signal's state is read there and
 * then, because both can change afterwards and a later reading would describe
 * a different moment.
 */

import { decisionUsageOf } from "../../../../llm/decision/metering";
import type { ResolvedDecisionRoute } from "../../../../llm/decision/route-types";
import type {
  SystemOneTransport,
  SystemOneTransportRequest,
  SystemOneTransportResult,
} from "../../../../llm/decision/transports/systemone";
import type { DecisionWireRequest } from "../../../../llm/decision/types";

/** The status a scripted answer arrives under unless a test says otherwise. */
const ANSWERED_STATUS = 200;

/** How long a scripted answer says the vendor took, in milliseconds. */
const SCRIPTED_VENDOR_MS = 120;

/** One invocation of the transport, as it stood when it was made. */
export interface RecordedDecisionDispatch {
  /** Zero-based position among the invocations received. */
  readonly index: number;
  readonly route: ResolvedDecisionRoute;
  /** The very body object the client handed over. */
  readonly body: DecisionWireRequest;
  /** The body written as JSON at the moment of dispatch. */
  readonly bodyText: string;
  /** The very signal the client handed over, kept live so a later abort can be observed. */
  readonly signal: AbortSignal;
  /** Whether that signal had already aborted when the transport was invoked. */
  readonly abortedAtDispatch: boolean;
}

/**
 * What the double does with an invocation: answer it, or fail as a transport would.
 *
 * @param call The recorded invocation.
 * @returns The transport's result.
 */
export type DecisionDispatchScript = (
  call: RecordedDecisionDispatch,
) => SystemOneTransportResult | Promise<SystemOneTransportResult>;

/** A scripted transport and the invocations it received. */
export interface DecisionTransportDouble {
  readonly transport: SystemOneTransport;
  readonly calls: readonly RecordedDecisionDispatch[];
}

/**
 * Build a scripted transport.
 *
 * @param script What to do with each invocation.
 * @returns The transport to inject, and the list it records into.
 */
export function createDecisionTransportDouble(script: DecisionDispatchScript): DecisionTransportDouble {
  const calls: RecordedDecisionDispatch[] = [];
  return {
    calls,
    transport: {
      name: "systemone",
      execute: async (request: SystemOneTransportRequest): Promise<SystemOneTransportResult> => {
        const call: RecordedDecisionDispatch = {
          index: calls.length,
          route: request.route,
          body: request.body,
          bodyText: JSON.stringify(request.body),
          signal: request.signal,
          abortedAtDispatch: request.signal.aborted,
        };
        calls.push(call);
        return script(call);
      },
    },
  };
}

/** What a scripted answer reports beyond its body. */
export interface ScriptedAnswerOverrides {
  readonly status?: number;
  readonly vendorRequestId?: string | null;
}

/**
 * The transport's result for a response body, as the real transport would
 * build it: the body undecoded, the answering model exactly as the body
 * reports it, and the usage priced at the route's own anchor.
 *
 * @param route The route the answer is for.
 * @param responseBody The response body, as parsed JSON.
 * @param overrides The status and the vendor's request id, when a test sets them.
 * @returns The result.
 * @throws When the body is not an object that names an answering model, which
 *   the real transport would have refused before returning.
 */
export function scriptedAnswer(
  route: ResolvedDecisionRoute,
  responseBody: unknown,
  overrides: ScriptedAnswerOverrides = {},
): SystemOneTransportResult {
  if (typeof responseBody !== "object" || responseBody === null || Array.isArray(responseBody)) {
    throw new Error("a scripted answer needs an object body");
  }
  const payload = responseBody as Readonly<Record<string, unknown>>;
  const servedModel = payload.model;
  if (typeof servedModel !== "string" || servedModel === "") {
    throw new Error("a scripted answer needs a body that names the answering model");
  }
  return {
    payload,
    servedModel,
    vendorRequestId: overrides.vendorRequestId ?? null,
    usage: decisionUsageOf(payload.usage, { provider: route.providerName, model: route.modelPin }, route.priceAnchor),
    status: overrides.status ?? ANSWERED_STATUS,
    durationMs: SCRIPTED_VENDOR_MS,
  };
}

/**
 * A call that never answers and ends only when its signal aborts.
 *
 * It rejects with the signal's own reason, the very value, which is what the
 * real transport does once its signal has aborted.
 *
 * @param call The recorded invocation.
 * @returns A promise that rejects when the signal aborts and never resolves.
 */
export function heldUntilAborted(call: RecordedDecisionDispatch): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const raise = (): void => {
      const reason: unknown = call.signal.reason;
      reject(reason);
    };
    if (call.signal.aborted) {
      raise();
      return;
    }
    call.signal.addEventListener("abort", raise, { once: true });
  });
}
