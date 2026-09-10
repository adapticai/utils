/**
 * Scripted transport doubles for the alias-client test suite.
 *
 * The client's guarantees are all about what it does BETWEEN transports —
 * which leg it tries next, how long it waits, what it records, what it refuses
 * to invent. Observing those needs a transport whose every outcome is chosen by
 * the test and whose every invocation is recorded, so an assertion can be made
 * about a leg that was never called at all. A real provider, or a network
 * mock, would make exactly those assertions unavailable.
 *
 * @module __tests__/llm/client/support/transports
 */

import type {
  LlmResponseFormat,
  LlmToolCall,
  LlmTransport,
  LlmTransportRequest,
  LlmTransportResponse,
  LlmUsageRecord,
  ResolvedRoute,
} from "../../../../llm/types";

/** One invocation, captured for assertions about routing and normalisation. */
export interface ScriptedCall {
  /** Zero-based invocation order across the whole transport. */
  readonly index: number;
  readonly route: ResolvedRoute;
  readonly content: string | readonly unknown[];
  readonly params: Readonly<Record<string, unknown>>;
  readonly responseFormat: LlmResponseFormat;
  /** The per-leg signal, kept live so a test can observe an abort after the fact. */
  readonly signal: AbortSignal;
  readonly correlationId?: string;
}

/** What a scripted leg does when invoked. */
export type LegBehaviour =
  | {
      readonly kind: "ok";
      readonly response: unknown;
      readonly usage: LlmUsageRecord;
      readonly toolCalls?: readonly LlmToolCall[];
    }
  | { readonly kind: "fail"; readonly error: Error }
  /** Never settles on its own: the leg ends only when its signal aborts. */
  | { readonly kind: "hang" };

/** Token counts a scripted leg reports. */
export interface UsageOverrides {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly cost?: number;
  readonly provider?: string;
  readonly model?: string;
}

/**
 * Build a usage record attributed to a leg.
 *
 * @param route The leg the usage belongs to.
 * @param overrides Counts to report.
 * @returns The usage record.
 */
export function usageFor(
  route: ResolvedRoute,
  overrides: UsageOverrides = {},
): LlmUsageRecord {
  return {
    prompt_tokens: overrides.promptTokens ?? 0,
    completion_tokens: overrides.completionTokens ?? 0,
    provider: overrides.provider ?? route.providerName,
    model: overrides.model ?? route.modelId,
    cost: overrides.cost ?? 0,
  };
}

/**
 * A leg that answers.
 *
 * @param response The payload to return.
 * @param usage The usage to report.
 * @param toolCalls Tool calls the model asked for, if any.
 * @returns The behaviour.
 */
export function answers(
  response: unknown,
  usage: LlmUsageRecord,
  toolCalls?: readonly LlmToolCall[],
): LegBehaviour {
  return { kind: "ok", response, usage, toolCalls };
}

/**
 * A leg that throws.
 *
 * @param error The error to throw.
 * @returns The behaviour.
 */
export function fails(error: Error): LegBehaviour {
  return { kind: "fail", error };
}

/**
 * A leg that never answers until its signal aborts.
 *
 * @returns The behaviour.
 */
export function hangs(): LegBehaviour {
  return { kind: "hang" };
}

/**
 * Present a scripted payload as the caller's requested type.
 *
 * `LlmTransport.execute` is generic in the payload because only the CALL SITE
 * knows what shape it asked the model for; no implementation can prove the
 * relation, which is why the production transports assert it at the same seam.
 * A double is in the same position, so the assertion is made once here rather
 * than at every scripted response.
 *
 * @param value The scripted payload.
 * @returns The same value at the caller's payload type.
 */
function asPayload<T>(value: unknown): T {
  return value as T;
}

/**
 * A transport whose every outcome is chosen by the test and whose every
 * invocation is recorded.
 */
export class ScriptedTransport implements LlmTransport {
  /** Identifies which transport answered, so degraded-path tests can tell them apart. */
  public readonly name: string;

  /** Every invocation, in order. */
  public readonly calls: ScriptedCall[] = [];

  private readonly plan: (call: ScriptedCall) => LegBehaviour;

  /**
   * @param name Transport name, surfaced on the `LlmTransport` contract.
   * @param plan Decides what each invocation does, given the recorded call.
   */
  public constructor(name: string, plan: (call: ScriptedCall) => LegBehaviour) {
    this.name = name;
    this.plan = plan;
  }

  /** Route keys invoked, in order. */
  public get routeKeys(): string[] {
    return this.calls.map((call) => call.route.routeKey);
  }

  /** Provider tiers invoked, in order, for the degraded path's closed-only rule. */
  public get tiers(): string[] {
    return this.calls.map((call) => call.route.provider.tier);
  }

  /**
   * Execute one scripted leg.
   *
   * @param request The normalised leg request.
   * @returns Whatever the plan decided for this invocation.
   */
  public async execute<T>(
    request: LlmTransportRequest,
  ): Promise<LlmTransportResponse<T>> {
    const call: ScriptedCall = {
      index: this.calls.length,
      route: request.route,
      content: request.content,
      params: request.params,
      responseFormat: request.responseFormat,
      signal: request.signal,
      correlationId: request.correlationId,
    };
    this.calls.push(call);

    const behaviour = this.plan(call);
    if (behaviour.kind === "fail") {
      throw behaviour.error;
    }
    if (behaviour.kind === "ok") {
      return {
        response: asPayload<T>(behaviour.response),
        usage: behaviour.usage,
        tool_calls: behaviour.toolCalls,
      };
    }

    // A hanging leg ends only when something aborts it, which is precisely what
    // makes it a probe of the timeout and cancellation machinery.
    return new Promise<LlmTransportResponse<T>>((_resolve, reject) => {
      if (request.signal.aborted) {
        reject(request.signal.reason);
        return;
      }
      request.signal.addEventListener(
        "abort",
        () => {
          reject(request.signal.reason);
        },
        { once: true },
      );
    });
  }
}
