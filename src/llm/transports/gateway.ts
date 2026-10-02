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
 * answer as the leg's; the served model is read from the gateway's own
 * served-model header, else from the upstream body's `model`, so such a
 * substitution stays visible while any remains configured. A body `model` that
 * merely echoes the name the leg was addressed by is the gateway naming its
 * model GROUP, not the model that answered, and is reported as unknown.
 *
 * The gateway key is read from the environment by NAME at call time and never
 * stored, logged, or included in an error (PD-2). Reading it per call rather
 * than caching it at import means a rotation takes effect without a restart.
 *
 * Keeping the key out of an error takes more than not writing it there,
 * because an error raised here is read far from here: its message becomes an
 * attempt's recorded reason and part of the exhausted-chain error. Four rules
 * hold on every path. A key that a request header cannot carry is refused
 * before any request is built, by a message that names the variable. A failure
 * of the HTTP layer is named by its class and system code and never quoted,
 * because a layer that refuses a request quotes the header it refused. Once
 * the leg's signal has aborted, what is raised is the signal's own reason and
 * never what the HTTP layer threw at that moment. And text the gateway answers
 * a failure with has the key taken out before it is quoted, because a gateway
 * may quote back the credential it was sent. A successful answer is returned
 * as the gateway sent it.
 *
 * @module llm/transports/gateway
 */

import { parseStructuredContent } from "../structured-content";
import { describeFailure, withoutCredential } from "./failure-description";
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

/**
 * Response header in which the gateway reports the upstream model that
 * actually answered. Takes precedence over the body's `model`, which a proxy
 * may overwrite with the model-group name it was addressed by.
 */
export const SERVED_MODEL_HEADER = "x-adaptic-served-model";

/** Response header in which the gateway reports the upstream provider that answered. */
export const SERVED_PROVIDER_HEADER = "x-adaptic-served-provider";

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
 * The user and password part of a URL's authority, with the scheme before it.
 *
 * Matched on the text and not by parsing the URL, so an address that holds no
 * credentials is printed exactly as it was configured.
 */
const URL_USERINFO = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/?#]*@/;

/**
 * A character a request header's value cannot hold: anything but a tab, a
 * space, visible ASCII and the upper half of Latin-1 (RFC 9110, section 5.5).
 * The HTTP layer refuses a request whose header holds one.
 */
const NOT_A_HEADER_CHARACTER = /[^\t\x20-\x7e\x80-\xff]/;

/** Blanks before a key. They follow the scheme in the header, which carries them. */
const LEADING_BLANKS = /^[\t ]+/;

/** Whitespace after a key. It ends the header's value, which drops it. */
const TRAILING_WHITESPACE = /[\t\n\r ]+$/;

/**
 * A reason for a failure, in words this module wrote.
 *
 * The one kind of cause whose message an error raised here repeats. Every
 * other failure reaches this module from the HTTP layer, whose words can quote
 * the request it refused.
 */
class GatewayOwnReason extends Error {
  /**
   * @param reason The reason, holding nothing another layer said.
   */
  public constructor(reason: string) {
    super(reason);
    this.name = "GatewayOwnReason";
  }
}

/**
 * The gateway's address as it may be printed.
 *
 * @param baseUrl The configured base URL.
 * @returns The same text without a user and password, when it held one.
 */
function printableBaseUrl(baseUrl: string): string {
  return baseUrl.replace(URL_USERINFO, "$1");
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
   * @param baseUrl The gateway that could not be reached. Printed without any
   *   user and password it holds.
   * @param cause The underlying failure. Named by its class and system code;
   *   its message is never repeated, because it is another layer's free text.
   */
  public constructor(baseUrl: string, cause: unknown) {
    super(
      `LLM gateway at ${printableBaseUrl(baseUrl)} is unreachable: ` +
        (cause instanceof GatewayOwnReason ? cause.message : describeFailure(cause)),
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
 * Thrown when the gateway answered and the answer's body could not be read:
 * the connection failed while the body was arriving, or the body of a
 * successful answer is not JSON.
 *
 * It carries no status to classify by, on purpose. The status came with a body
 * that was never read, and the failure is that of the exchange, so it is
 * accounted like any other failure that has no status.
 */
export class GatewayResponseUnreadableError extends Error {
  /**
   * @param status The HTTP status the unread answer began with.
   * @param detail Why the body could not be read, in words that quote neither
   *   the body nor a lower layer's message.
   */
  public constructor(status: number, detail: string) {
    super(`LLM gateway answered ${status} with a body that could not be read: ${detail}`);
    this.name = "GatewayResponseUnreadableError";
  }
}

/**
 * Read the gateway key from the environment by name.
 *
 * The key is returned as it was read and sent as it was read. Whether a header
 * can carry it is judged on the key without the blanks before it and the
 * whitespace after it, because the header carries the first and drops the
 * second: a key that differs from a usable one only there reaches the gateway
 * as the usable one.
 *
 * @param envVar The variable's NAME.
 * @returns The key.
 * @throws When the variable is unset, because an unauthenticated call would
 *   reach the gateway as an anonymous caller and be rejected there anyway —
 *   later, and with a less useful message. And when it holds a value a request
 *   header cannot carry, because the HTTP layer would refuse the request and
 *   say so by quoting the value. Both name the variable and never its value.
 */
function readGatewayKey(envVar: string): string {
  const value = process.env[envVar];
  if (value === undefined || value.length === 0) {
    throw new GatewayOwnReason(
      `${envVar} is unset, so the LLM gateway cannot be authenticated against. ` +
        "Provision it from the secrets manager; it is never read from a file or a default.",
    );
  }
  const carried = value.replace(LEADING_BLANKS, "").replace(TRAILING_WHITESPACE, "");
  if (NOT_A_HEADER_CHARACTER.test(carried)) {
    throw new GatewayOwnReason(
      `${envVar} holds a value that cannot be carried in a request header, ` +
        "so the LLM gateway cannot be authenticated against; no request was made. " +
        "Provision it again from the secrets manager, without a line break or a control character inside it.",
    );
  }
  return value;
}

/**
 * Turn a throw from below this transport, made before any answer arrived, into
 * the leg's outcome.
 *
 * Once the signal has aborted, the outcome is the signal's own reason, so the
 * chain reads its own timeout or cancellation and not a gateway outage. What
 * was thrown is dropped. For an abort that loses nothing: the platform's HTTP
 * call rejects with the signal's reason, so the two are one object. For
 * anything else it is the point: a failure that merely coincides with the
 * abort is another layer's free text.
 *
 * While the signal is live, the gateway was not reached.
 *
 * @param error What was thrown.
 * @param signal The leg's abort signal.
 * @param baseUrl The gateway's base URL.
 * @param key The key the request carried, or `null` when none was read.
 * @returns Never.
 * @throws The signal's reason, or a {@link GatewayUnreachableError}.
 */
function raiseUnanswered(error: unknown, signal: AbortSignal, baseUrl: string, key: string | null): never {
  if (signal.aborted) {
    const reason: unknown = signal.reason;
    throw reason;
  }
  throw new GatewayUnreachableError(
    baseUrl,
    error instanceof GatewayOwnReason
      ? error
      : new GatewayOwnReason(withoutCredential(describeFailure(error), key)),
  );
}

/**
 * Read a response's body as text.
 *
 * @param response The response.
 * @param signal The leg's abort signal.
 * @param key The key the request carried.
 * @returns The body.
 * @throws The signal's reason once it has aborted; otherwise a
 *   {@link GatewayResponseUnreadableError} naming the failure by its class.
 */
async function readBody(response: Response, signal: AbortSignal, key: string): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    if (signal.aborted) {
      const reason: unknown = signal.reason;
      throw reason;
    }
    throw new GatewayResponseUnreadableError(response.status, withoutCredential(describeFailure(error), key));
  }
}

/**
 * Parse the body of a successful answer.
 *
 * @param text The body.
 * @param status The answer's status.
 * @returns The parsed body.
 * @throws {GatewayResponseUnreadableError} When the body is not JSON. The
 *   parser's own error is not rethrown: it quotes the text it stopped on.
 */
function parseBody(text: string, status: number): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new GatewayResponseUnreadableError(status, "it is not JSON");
  }
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

      let key: string | null = null;
      let response: Response;
      try {
        key = readGatewayKey(config.apiKeyEnv);
        response = await doFetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
            ...(request.correlationId === undefined
              ? {}
              : { "x-correlation-id": request.correlationId }),
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        // A throw here means the proxy was never reached. An abort surfaces as
        // the signal's reason, so the chain's timeout classification stays
        // accurate rather than being masked as a gateway outage.
        return raiseUnanswered(error, request.signal, config.baseUrl, key);
      }

      const text = await readBody(response, request.signal, key);
      if (!response.ok) {
        throw new GatewayResponseError(response.status, withoutCredential(text, key));
      }

      const payload = parseBody(text, response.status);
      const addressedAs = body.model;
      const choices = payload.choices as
        | {
            message?: { content?: unknown; tool_calls?: unknown };
            finish_reason?: unknown;
          }[]
        | undefined;
      // The ANSWERING choice, held as one value: `finish_reason` is a sibling of
      // `message` on it, so reading them off separate lookups could in principle
      // describe different choices.
      const choice = choices?.[0];
      const message = choice?.message;
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
        // The model that answered, which a proxy-side fallback can make differ
        // from the leg's route model; unreported (or only the group echo) stays null.
        servedModel: servedModelOf(response.headers, payload.model, addressedAs),
        servedDeploymentId: nonEmptyOrNull(response.headers?.get(DEPLOYMENT_ID_HEADER)),
        servedProvider: nonEmptyOrNull(response.headers?.get(SERVED_PROVIDER_HEADER)),
        // Why generation stopped. `length` is the one a consumer cannot infer:
        // it means this request's own output cap cut the answer.
        finishReason: nonEmptyOrNull(choice?.finish_reason),
      };
    },
  };
}

/**
 * The model that answered, as far as the gateway says.
 *
 * The gateway's served-model header is authoritative when present. Otherwise
 * the body's `model` is used — unless it equals the name the leg was addressed
 * by, which is the proxy echoing its model group rather than naming the
 * upstream model, and would otherwise read as a confirmed same-model answer.
 *
 * @param headers The response headers.
 * @param bodyModel The body's `model` field.
 * @param addressedAs The gateway model name the leg was sent to.
 * @returns The served model, or null when the gateway did not say.
 */
export function servedModelOf(
  headers: Headers | undefined,
  bodyModel: unknown,
  addressedAs: string,
): string | null {
  const fromHeader = nonEmptyOrNull(headers?.get(SERVED_MODEL_HEADER));
  if (fromHeader !== null) {
    return fromHeader;
  }
  const fromBody = nonEmptyOrNull(bodyModel);
  return fromBody === null || fromBody === addressedAs ? null : fromBody;
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
