/**
 * Gateway transport: the normal path for every LLM call.
 *
 * The client sends an alias to the LiteLLM proxy and the proxy resolves it. The
 * vendor model string therefore exists only in the gateway's configuration and
 * never in application code (PD-5), which is what makes a model swap a config
 * change rather than a deploy.
 *
 * The client still walks its own chain on top of the gateway's, and the
 * duplication is deliberate. The gateway's fallbacks cover a provider being
 * down; the client's cover the gateway being down. Only one of those two can
 * cover the other, so the outer chain is the one that must exist.
 *
 * The gateway key is read from the environment by NAME at call time and never
 * stored, logged, or included in an error (PD-2). Reading it per call rather
 * than caching it at import means a rotation takes effect without a restart.
 *
 * @module llm/transports/gateway
 */

import type {
  LlmTransport,
  LlmTransportRequest,
  LlmTransportResponse,
  LlmUsageRecord,
} from "../types";

/** HTTP statuses that mean "try the next leg" rather than "this request is wrong". */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Maximum characters of an error body echoed into a message. */
const ERROR_BODY_EXCERPT = 400;

/** Configuration for the gateway transport. */
export interface GatewayTransportConfig {
  /** Base URL of the proxy, e.g. `https://llm-gateway.internal`. */
  readonly baseUrl: string;
  /** Env-var NAME holding the gateway key. Never the key itself. */
  readonly apiKeyEnv: string;
  /** Injected for testing; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Resolves the gateway model name for a leg.
   *
   * Injected because the naming convention belongs to the route table, and a
   * transport that reinvented it would be a second place for the client and the
   * gateway config to disagree about what a leg is called.
   */
  readonly modelNameFor: (request: LlmTransportRequest) => string;
}

/**
 * Thrown when the gateway itself is unreachable, as opposed to a provider
 * behind it failing.
 *
 * The distinction is what licenses the degraded direct path: a 502 from a
 * provider means try the next leg, while a connection refused from the proxy
 * means the whole gateway is gone and the chain cannot be walked through it at
 * all.
 */
export class GatewayUnreachableError extends Error {
  /**
   * @param baseUrl The gateway that could not be reached.
   * @param cause The underlying transport error.
   */
  public constructor(baseUrl: string, cause: unknown) {
    super(
      `LLM gateway at ${baseUrl} is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "GatewayUnreachableError";
  }
}

/** Thrown when the gateway answered, but with a failure. */
export class GatewayResponseError extends Error {
  /** The HTTP status. */
  public readonly status: number;

  /** Whether advancing to the next leg could plausibly help. */
  public readonly retryable: boolean;

  /**
   * @param status The HTTP status.
   * @param body A bounded excerpt of the response body.
   */
  public constructor(status: number, body: string) {
    super(`LLM gateway returned ${status}: ${body.slice(0, ERROR_BODY_EXCERPT)}`);
    this.name = "GatewayResponseError";
    this.status = status;
    this.retryable = RETRYABLE_STATUSES.has(status);
  }
}

/**
 * Read the gateway key from the environment by name.
 *
 * @param envVar The variable's NAME.
 * @returns The key.
 * @throws When the variable is unset, because an unauthenticated call would
 *   reach the gateway as an anonymous caller and be rejected there anyway —
 *   later, and with a less useful message.
 */
function readGatewayKey(envVar: string): string {
  const value = process.env[envVar];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `${envVar} is unset, so the LLM gateway cannot be authenticated against. ` +
        "Provision it from the secrets manager; it is never read from a file or a default.",
    );
  }
  return value;
}

/**
 * Extract usage from a chat-completion response.
 *
 * Absent counts stay zero rather than being estimated. A fabricated token count
 * would flow straight into the budget accounting that the spend controls are
 * built on, and a budget computed from invented numbers is worse than one that
 * knows it is missing a call.
 *
 * @param payload The parsed response body.
 * @param request The request it answers.
 * @returns The usage record.
 */
function readUsage(
  payload: Record<string, unknown>,
  request: LlmTransportRequest,
): LlmUsageRecord {
  const usage = (payload.usage ?? {}) as Record<string, unknown>;
  const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cached = details.cached_tokens;
  const reasoningDetails = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
  const reasoning = reasoningDetails.reasoning_tokens;

  return {
    prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    completion_tokens:
      typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
    reasoning_tokens: typeof reasoning === "number" ? reasoning : undefined,
    cached_tokens: typeof cached === "number" ? cached : undefined,
    provider: request.route.providerName,
    model: request.route.modelId,
    cost: typeof usage.response_cost === "number" ? usage.response_cost : 0,
  };
}

/**
 * Build the gateway transport.
 *
 * @param config Transport configuration.
 * @returns A transport that executes one leg through the proxy.
 */
export function createGatewayTransport(
  config: GatewayTransportConfig,
): LlmTransport {
  const doFetch = config.fetchImpl ?? fetch;

  return {
    name: "gateway",
    async execute<T>(
      request: LlmTransportRequest,
    ): Promise<LlmTransportResponse<T>> {
      const messages = buildMessages(request);
      const body = {
        model: config.modelNameFor(request),
        messages,
        ...request.params,
      };

      let response: Response;
      try {
        response = await doFetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${readGatewayKey(config.apiKeyEnv)}`,
            ...(request.correlationId === undefined
              ? {}
              : { "x-correlation-id": request.correlationId }),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        // A transport-level throw means the proxy was never reached. Abort is
        // re-thrown untouched so the chain's timeout classification stays
        // accurate rather than being masked as a gateway outage.
        if (request.signal.aborted) {
          throw error;
        }
        throw new GatewayUnreachableError(config.baseUrl, error);
      }

      if (!response.ok) {
        throw new GatewayResponseError(response.status, await response.text());
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const choices = payload.choices as
        | { message?: { content?: unknown; tool_calls?: unknown } }[]
        | undefined;
      const message = choices?.[0]?.message;

      return {
        response: parseContent<T>(message?.content, request.responseFormat),
        usage: readUsage(payload, request),
        tool_calls: Array.isArray(message?.tool_calls)
          ? (message.tool_calls as LlmTransportResponse<T>["tool_calls"])
          : undefined,
      };
    },
  };
}

/**
 * Compose the message array for a request.
 *
 * @param request The request.
 * @returns Chat messages.
 */
function buildMessages(request: LlmTransportRequest): Record<string, unknown>[] {
  const content =
    typeof request.content === "string" ? request.content : [...request.content];
  const messages: Record<string, unknown>[] = [];
  // Order is the contract: the developer instruction must precede the history it
  // governs, and the history must precede the turn it is the memory for. A
  // transport that emitted only the final turn would not be sending a shorter
  // prompt — it would be asking a different question, of an unprompted model.
  if (request.developerPrompt !== undefined && request.developerPrompt !== "") {
    messages.push({ role: "system", content: request.developerPrompt });
  }
  if (request.context !== undefined) {
    for (const turn of request.context) {
      messages.push(turn as Record<string, unknown>);
    }
  }
  messages.push({ role: "user", content });
  return messages;
}

/**
 * Interpret the model's content according to the requested format.
 *
 * A JSON format that does not parse is an error, not an empty object. Returning
 * a default here would hand the caller a well-typed value that means nothing,
 * and the failure would surface much later as a decision made on absent data.
 *
 * @param content The raw content.
 * @param responseFormat The format the caller asked for.
 * @returns The parsed value.
 */
function parseContent<T>(
  content: unknown,
  responseFormat: LlmTransportRequest["responseFormat"],
): T {
  const text = typeof content === "string" ? content : "";
  if (responseFormat === "text") {
    return text as unknown as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `LLM returned content that is not valid JSON for a ${
        typeof responseFormat === "string" ? responseFormat : "json_schema"
      } request: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
