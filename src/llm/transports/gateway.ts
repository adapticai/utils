/**
 * Gateway transport: the normal path for every LLM call.
 *
 * The client sends an alias to the LiteLLM proxy and the proxy resolves it. The
 * vendor model string therefore exists only in the gateway's configuration and
 * never in application code (PD-5), which is what makes a model swap a config
 * change rather than a deploy.
 *
 * The client's chain is the single fallback owner: every leg is addressed to the
 * gateway by its own model name, so the gateway serves one deployment per leg
 * and needs no fallback of its own. A proxy-side fallback inside a leg would
 * spend the leg's budget on a model the chain did not choose and report the
 * answer as the leg's; the served model is read from the response body so such
 * a substitution stays visible while any remains configured.
 *
 * The gateway key is read from the environment by NAME at call time and never
 * stored, logged, or included in an error (PD-2). Reading it per call rather
 * than caching it at import means a rotation takes effect without a restart.
 *
 * @module llm/transports/gateway
 */

import { parseStructuredContent } from "../structured-content";
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

/** Response header in which the LiteLLM proxy reports the call's cost in USD. */
const RESPONSE_COST_HEADER = "x-litellm-response-cost";

/** Response header naming the proxy deployment that served the call. */
const DEPLOYMENT_ID_HEADER = "x-litellm-model-id";

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
 * A count the provider did not report is `null`, never zero and never an
 * estimate. A fabricated count — zero included — would flow straight into the
 * budget accounting the spend controls are built on, where a zero reads as a
 * free call and can never trip a limit.
 *
 * Cost is read from the body's `usage.response_cost` or, failing that, from the
 * proxy's cost header, which is where the LiteLLM proxy reports it.
 *
 * @param payload The parsed response body.
 * @param request The request it answers.
 * @param headers The response headers.
 * @returns The usage record.
 */
function readUsage(
  payload: Record<string, unknown>,
  request: LlmTransportRequest,
  headers: Headers | undefined,
): LlmUsageRecord {
  const usage = (payload.usage ?? {}) as Record<string, unknown>;
  const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cached = details.cached_tokens;
  const reasoningDetails = (usage.completion_tokens_details ?? {}) as Record<string, unknown>;
  const reasoning = reasoningDetails.reasoning_tokens;

  return {
    prompt_tokens: finiteOrNull(usage.prompt_tokens),
    completion_tokens: finiteOrNull(usage.completion_tokens),
    reasoning_tokens: typeof reasoning === "number" ? reasoning : undefined,
    cached_tokens: typeof cached === "number" ? cached : undefined,
    provider: request.route.providerName,
    model: request.route.modelId,
    cost: finiteOrNull(usage.response_cost) ?? headerNumber(headers, RESPONSE_COST_HEADER),
  };
}

/**
 * A reported number, or null when it was not reported as a finite number.
 *
 * @param value The raw value.
 * @returns The number, or null.
 */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A numeric response header, or null when absent or not a finite number.
 *
 * @param headers The response headers, if the transport exposes them.
 * @param name The header name.
 * @returns The number, or null.
 */
function headerNumber(headers: Headers | undefined, name: string): number | null {
  const raw = headers?.get(name);
  if (raw === undefined || raw === null || raw.trim() === "") {
    return null;
  }
  return finiteOrNull(Number(raw));
}

/**
 * A non-empty string, or null.
 *
 * @param value The raw value.
 * @returns The string, or null.
 */
function nonEmptyOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
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
      // Usage is read before the content is interpreted. The provider billed for
      // this answer whether or not it parses, and a parse failure that dropped
      // the count would report the attempt as free.
      const usage = readUsage(payload, request, response.headers);

      return {
        response: interpretContent<T>(message?.content, request.responseFormat, usage),
        usage,
        tool_calls: Array.isArray(message?.tool_calls)
          ? (message.tool_calls as LlmTransportResponse<T>["tool_calls"])
          : undefined,
        // The model the provider says answered, which a proxy-side fallback can
        // make differ from the leg's route model; unreported stays null.
        servedModel: nonEmptyOrNull(payload.model),
        servedDeploymentId: nonEmptyOrNull(response.headers?.get(DEPLOYMENT_ID_HEADER)),
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
 * Text is returned as sent. A structured format is parsed under the strict
 * single-fence rule of {@link parseStructuredContent}; a structured answer that
 * does not parse is an error carrying what the provider billed for it, never an
 * empty object.
 *
 * @param content The raw content.
 * @param responseFormat The format the caller asked for.
 * @param usage What the provider billed for this answer.
 * @returns The interpreted value.
 * @throws {LlmResponseFormatError} When a structured answer does not parse.
 */
function interpretContent<T>(
  content: unknown,
  responseFormat: LlmTransportRequest["responseFormat"],
  usage: LlmUsageRecord,
): T {
  if (responseFormat === "text") {
    return (typeof content === "string" ? content : "") as unknown as T;
  }
  return parseStructuredContent<T>(content, responseFormat, usage);
}
