import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { callLLMByAlias, configureLlmClient } from "../../../llm/alias-client";
import { CircuitBreakerRegistry } from "../../../llm/circuit-breaker";
import { ChainExhaustedError, executeChain } from "../../../llm/fallback-chain";
import { classify } from "../../../llm/leg-attempt";
import type { LegFailure } from "../../../llm/leg-attempt";
import { routeTable } from "../../../llm/route-table";
import { CREDENTIAL_REMOVED } from "../../../llm/transports/failure-description";
import {
  GatewayResponseError,
  GatewayUnreachableError,
  createGatewayTransport,
} from "../../../llm/transports/gateway";
import type { LlmTransport, LlmTransportRequest } from "../../../llm/types";
import { exposes, isExactly, raisedBy } from "./support/exposure";
import { rejection } from "./support/rejections";
import { TEST_LEG_TIMEOUT_MS, makeRoute } from "./support/routes";
import { ScriptedTransport, answers, fails, usageFor } from "./support/transports";

/** An alias whose chain has more than one leg and a closed incumbent. */
const ALIAS = "llm.extract";

/**
 * Env var the transport is told to read its key from. A name no deployment
 * uses, so the suite never reads or replaces a variable that holds a real key.
 */
const KEY_ENV = "LLM_GATEWAY_API_KEY_FOR_HYGIENE_SUITE";

/** An env var the suite leaves unset. */
const UNSET_KEY_ENV = "LLM_GATEWAY_API_KEY_ABSENT_FOR_HYGIENE_SUITE";

/**
 * A credential-shaped value. Assembled at runtime, so no credential-shaped
 * text stands in the tree for a secret scan to stop on, and distinctive
 * enough that finding it in a message can only be a leak.
 */
const SENTINEL = ["sk", "test", "3e7a9c1f5b2d", "do-not-leak"].join("-");

/** What follows the line break in a key that holds one. Also must never appear. */
const SECOND_LINE = ["second", "line", "8d4f"].join("-");

/** A credential that is a bare identifier, the one shape a failure's class name could repeat. */
const IDENTIFIER_SENTINEL = ["sk", "test", "6c2b8e", "donotleak"].join("_");

/** A credential a JSON string has to escape. */
const ESCAPED_SENTINEL = ["sk", "test", '5a"9d\\2f', "do-not-leak"].join("-");

/** Everything a raised value must not hold, whichever key a case plants. */
const SECRETS: readonly string[] = [SENTINEL, SECOND_LINE, IDENTIFIER_SENTINEL, ESCAPED_SENTINEL];

/** Base URL the transport is pointed at; the name cannot resolve. */
const GATEWAY_URL = "https://llm-gateway.invalid";

/** The status with which a gateway rejects a key. */
const UNAUTHORIZED = 401;

/** A status a healthy gateway relays for a failing provider. */
const BAD_GATEWAY = 502;

/** How much of a failing body an error quotes. */
const BODY_EXCERPT = 400;

/** How much of an unparseable text the platform's JSON parser is relied on to quote. */
const QUOTED_BY_PARSER = 8;

/** What a healthy leg answers. */
const ANSWER = "the model answered";

/** The message an unset key has always produced, word for word. */
const UNSET_KEY_MESSAGE =
  `LLM gateway at ${GATEWAY_URL} is unreachable: ${UNSET_KEY_ENV} is unset, so the LLM gateway cannot be authenticated against. ` +
  "Provision it from the secrets manager; it is never read from a file or a default.";

/** What the HTTP layer was asked to do, recorded by a double. */
interface FetchLog {
  calls: number;
  /** The authorization header exactly as the transport handed it over. */
  authorization: string | null;
}

/**
 * A fresh record of what the HTTP layer was asked.
 *
 * @returns An empty log.
 */
function newLog(): FetchLog {
  return { calls: 0, authorization: null };
}

/**
 * The authorization header a request was built with, before any header layer
 * has had the chance to refuse or rewrite it.
 *
 * @param init The request the transport built.
 * @returns The header's value, or `null` when the request carries none.
 */
function authorizationOf(init: RequestInit | undefined): string | null {
  const headers = init?.headers;
  if (headers === undefined || headers instanceof Headers || Array.isArray(headers)) {
    return null;
  }
  const value: unknown = headers.authorization;
  return typeof value === "string" ? value : null;
}

/**
 * An HTTP layer whose behaviour the test chooses and whose every call is recorded.
 *
 * @param log Receives the call count and the header.
 * @param behave What the layer does with the request.
 * @returns The double.
 */
function fetchDouble(
  log: FetchLog,
  behave: (authorization: string | null, signal: AbortSignal | null) => Response | Promise<Response>,
): typeof fetch {
  return async (_input, init) => {
    log.calls += 1;
    log.authorization = authorizationOf(init);
    return behave(log.authorization, init?.signal ?? null);
  };
}

/**
 * An HTTP layer that refuses the request the way a runtime does: its message
 * quotes the header it was given, and so does the cause it carries.
 *
 * @param log Receives the call count and the header.
 * @returns The double.
 */
function quotingRefusal(log: FetchLog): typeof fetch {
  return fetchDouble(log, (authorization) => {
    throw new TypeError(`Headers.append: "${authorization ?? ""}" is an invalid header value.`, {
      cause: new Error(`refused the header ${authorization ?? ""}`),
    });
  });
}

/**
 * Build the gateway transport over a double.
 *
 * @param fetchImpl The HTTP layer.
 * @param apiKeyEnv The variable the key is read from.
 * @param baseUrl The gateway's address.
 * @returns The transport.
 */
function transportOver(
  fetchImpl: typeof fetch,
  apiKeyEnv: string = KEY_ENV,
  baseUrl: string = GATEWAY_URL,
): LlmTransport {
  return createGatewayTransport({
    baseUrl,
    apiKeyEnv,
    fetchImpl,
    modelNameFor: (request: LlmTransportRequest) => request.route.alias,
  });
}

/**
 * Build a transport request for a leg.
 *
 * @param signal The leg's abort signal.
 * @param responseFormat The shape the caller asked for.
 * @returns A minimal request.
 */
function requestFor(
  signal: AbortSignal = new AbortController().signal,
  responseFormat: LlmTransportRequest["responseFormat"] = "text",
): LlmTransportRequest {
  return { route: makeRoute({ alias: ALIAS }), content: "prompt", responseFormat, params: {}, signal };
}

/**
 * A healthy chat-completion response.
 *
 * @returns The response.
 */
function healthyResponse(): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: ANSWER } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A response whose body fails while it is being read, with a failure that
 * quotes the given text.
 *
 * @param status The response's status.
 * @param quoted Text the failure's message holds.
 * @returns The response.
 */
function unreadableResponse(status: number, quoted: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller): void {
      controller.error(new Error(`the connection dropped while sending ${quoted}`));
    },
  });
  return new Response(body, { status });
}

/**
 * A signal that has aborted with the given reason.
 *
 * @param reason The reason.
 * @returns The signal.
 */
function abortedWith(reason: unknown): AbortSignal {
  const controller = new AbortController();
  controller.abort(reason);
  return controller.signal;
}

/** The fields of a classification other than its free-text reason. */
type Verdict = Omit<LegFailure, "reason">;

/**
 * A classification without its free-text reason.
 *
 * @param error The failure to classify.
 * @returns The outcome, the health verdict, the cooldown kind and the typed class.
 */
function verdictOf(error: unknown): Verdict {
  const { reason: _reason, ...verdict } = classify(error, undefined);
  return verdict;
}

/** How an unreachable gateway has always been classified. */
const UNREACHABLE_VERDICT: Verdict = {
  outcome: "error",
  countsAgainstHealth: true,
  failureKind: "hard",
  failureClass: "gateway_unreachable",
};

/** How a provider failure with no status and no telling wording has always been classified. */
const PROVIDER_ERROR_VERDICT: Verdict = {
  outcome: "error",
  countsAgainstHealth: true,
  failureKind: "hard",
  failureClass: "provider_error",
};

/**
 * The unreachable-gateway error as it was built when its message repeated the
 * message of what it wrapped. Kept here as the reference the present
 * classification is compared against.
 */
class MessageQuotingUnreachableError extends Error {
  /**
   * @param baseUrl The gateway that could not be reached.
   * @param cause The underlying failure.
   */
  public constructor(baseUrl: string, cause: unknown) {
    super(`LLM gateway at ${baseUrl} is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "GatewayUnreachableError";
  }
}

/** One failure of the HTTP layer, shaped as the platform's client raises it. */
interface OrdinaryFailure {
  readonly label: string;
  readonly build: () => unknown;
}

/**
 * A platform HTTP failure: a generic outer error whose cause names the system fault.
 *
 * @param causeName The cause's class name.
 * @param code The cause's system code.
 * @param message The cause's message.
 * @returns The failure.
 */
function fetchFailed(causeName: string, code: string, message: string): Error {
  const cause = Object.assign(new Error(message), { code });
  cause.name = causeName;
  return new TypeError("fetch failed", { cause });
}

/** The failures an unreachable gateway ordinarily produces. */
const ORDINARY_FAILURES: readonly OrdinaryFailure[] = [
  { label: "a refused connection", build: () => fetchFailed("Error", "ECONNREFUSED", "connect ECONNREFUSED 10.0.0.1:443") },
  { label: "a name that does not resolve", build: () => fetchFailed("Error", "ENOTFOUND", "getaddrinfo ENOTFOUND llm-gateway.invalid") },
  { label: "a reset connection", build: () => fetchFailed("Error", "ECONNRESET", "read ECONNRESET") },
  { label: "a connection that timed out at the socket", build: () => fetchFailed("Error", "ETIMEDOUT", "connect ETIMEDOUT 10.0.0.1:443") },
  { label: "a connect timeout of the HTTP client", build: () => fetchFailed("ConnectTimeoutError", "UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error") },
  { label: "a socket closed by the other side", build: () => fetchFailed("SocketError", "UND_ERR_SOCKET", "other side closed") },
  { label: "a bare error with no cause", build: () => new Error("connect ECONNREFUSED 10.0.0.1:443") },
  { label: "a thrown value that is not an error", build: () => "connection reset" },
];

/** One shape of key, and what it is called in a test's title. */
interface KeyShape {
  readonly label: string;
  readonly key: string;
}

/**
 * Keys a header cannot carry. The request for each of these never left the
 * process before either: the header layer refused it, and said so by quoting it.
 * A NUL is absent because an environment variable cannot hold one.
 */
const UNCARRIABLE_KEYS: readonly KeyShape[] = [
  { label: "a line break inside it", key: `${SENTINEL}\n${SECOND_LINE}` },
  { label: "a carriage return inside it", key: `${SENTINEL}\r${SECOND_LINE}` },
  { label: "a line break before it", key: `\n${SENTINEL}` },
  { label: "a control character inside it", key: `${SENTINEL}\u0001${SECOND_LINE}` },
  { label: "a delete character inside it", key: `${SENTINEL}\u007f${SECOND_LINE}` },
  { label: "a character outside Latin-1 inside it", key: `${SENTINEL}”${SECOND_LINE}` },
];

/**
 * Keys a header carries. Each of these was sent before, exactly as it was
 * read, and still is.
 */
const CARRIABLE_KEYS: readonly KeyShape[] = [
  { label: "visible ASCII only", key: SENTINEL },
  { label: "a line break after it", key: `${SENTINEL}\n` },
  { label: "a carriage return and line break after it", key: `${SENTINEL}\r\n` },
  { label: "a space after it", key: `${SENTINEL} ` },
  { label: "a tab after it", key: `${SENTINEL}\t` },
  { label: "a space before it", key: ` ${SENTINEL}` },
  { label: "a tab before it", key: `\t${SENTINEL}` },
  { label: "a space inside it", key: `${SENTINEL} ${SECOND_LINE}` },
  { label: "a tab inside it", key: `${SENTINEL}\t${SECOND_LINE}` },
  { label: "a Latin-1 character inside it", key: `${SENTINEL}é${SECOND_LINE}` },
  { label: "nothing but blanks", key: "   " },
];

describe("the gateway key never reaches an error", () => {
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  beforeEach(() => {
    process.env[KEY_ENV] = SENTINEL;
    delete process.env[UNSET_KEY_ENV];
    configureLlmClient({});
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    // The transport writes nothing to the console, so nothing it could have
    // written there can hold the key either.
    const written = consoleSpies.flatMap((spy) => spy.mock.calls);
    for (const spy of consoleSpies) {
      spy.mockRestore();
    }
    delete process.env[KEY_ENV];
    configureLlmClient({});
    expect(exposes(written, SECRETS)).toBe(false);
  });

  describe("a failure of the HTTP layer is named, never quoted", () => {
    it("on a live signal, raises an unreachable-gateway error that holds no text from the failure", async () => {
      const log = newLog();
      const transport = transportOver(quotingRefusal(log));

      const outcome = await raisedBy(transport.execute(requestFor()));

      // Anti-vacuity: the key was read and handed to the HTTP layer, whose
      // failure did quote it, so its absence below is a property of the transport.
      expect(log.calls).toBe(1);
      expect(log.authorization === `Bearer ${SENTINEL}`).toBe(true);
      expect(outcome.raised && outcome.value instanceof GatewayUnreachableError).toBe(true);
      expect(exposes(outcome, SECRETS)).toBe(false);
      expect(
        isExactly(
          outcome.raised && outcome.value instanceof Error ? outcome.value.message : null,
          `LLM gateway at ${GATEWAY_URL} is unreachable: TypeError, caused by Error`,
        ),
      ).toBe(true);
    });

    it("does not print a thrown value that is not an error", async () => {
      const log = newLog();
      const transport = transportOver(
        fetchDouble(log, (authorization) => {
          const notAnError: unknown = `refused ${authorization ?? ""}`;
          throw notAnError;
        }),
      );

      const error = await rejection(transport.execute(requestFor()), GatewayUnreachableError);

      expect(exposes(error, SECRETS)).toBe(false);
      expect(
        isExactly(
          error.message,
          `LLM gateway at ${GATEWAY_URL} is unreachable: a thrown value that is not an error`,
        ),
      ).toBe(true);
    });

    it("takes the key out of a failure's class name and system code", async () => {
      process.env[KEY_ENV] = IDENTIFIER_SENTINEL;
      const log = newLog();
      const transport = transportOver(
        fetchDouble(log, () => {
          // A failure named after the key itself: the one way an identifier
          // this layer would print could be the credential.
          throw Object.assign(new Error("refused"), { name: IDENTIFIER_SENTINEL, code: IDENTIFIER_SENTINEL });
        }),
      );

      const error = await rejection(transport.execute(requestFor()), GatewayUnreachableError);

      expect(log.authorization === `Bearer ${IDENTIFIER_SENTINEL}`).toBe(true);
      expect(exposes(error, SECRETS)).toBe(false);
      expect(
        isExactly(
          error.message,
          `LLM gateway at ${GATEWAY_URL} is unreachable: ${CREDENTIAL_REMOVED} ${CREDENTIAL_REMOVED}`,
        ),
      ).toBe(true);
    });

    it("keeps the key out of every attempt's recorded reason and out of the exhausted-chain error", async () => {
      const log = newLog();
      const transport = transportOver(quotingRefusal(log));
      const routes = [makeRoute({ alias: ALIAS, role: "primary" }), makeRoute({ alias: ALIAS, role: "secondary" })];

      const error = await rejection(
        executeChain<string>(ALIAS, {
          legs: routes.map((route) => ({ route, transport, params: {} })),
          content: "prompt",
          responseFormat: "text",
          breakers: new CircuitBreakerRegistry(routeTable.defaults.circuit_breaker, () => Date.now()),
        }),
        ChainExhaustedError,
      );

      expect(log.calls).toBe(routes.length);
      expect(error.attempts.map((attempt) => attempt.failureClass)).toEqual(routes.map(() => "gateway_unreachable"));
      expect(error.attempts.every((attempt) => attempt.reason?.includes("is unreachable") === true)).toBe(true);
      expect(exposes(error, SECRETS)).toBe(false);
      expect(exposes(error.attempts, SECRETS)).toBe(false);
    });

    it("keeps the key out of what the client raises when the degraded path fails as well", async () => {
      const log = newLog();
      configureLlmClient({
        gatewayTransport: transportOver(quotingRefusal(log)),
        directTransport: new ScriptedTransport("direct", () =>
          fails(new Error("the degraded path is unavailable too")),
        ),
      });

      const error = await rejection(callLLMByAlias<string>("prompt", "text", { alias: ALIAS }), ChainExhaustedError);

      expect(log.calls).toBeGreaterThan(0);
      expect(exposes(error, SECRETS)).toBe(false);
    });
  });

  describe("once the signal has aborted, what is raised is the signal's own reason", () => {
    it("raises the reason itself when the HTTP layer fails with something else at that moment", async () => {
      const reason = new Error("the leg's own deadline");
      const log = newLog();
      const transport = transportOver(quotingRefusal(log));

      const outcome = await raisedBy(transport.execute(requestFor(abortedWith(reason))));

      expect(log.calls).toBe(1);
      expect(outcome.raised && outcome.value === reason).toBe(true);
      expect(exposes(outcome, SECRETS)).toBe(false);
    });

    it("raises null when the signal aborted with null, not what the HTTP layer threw", async () => {
      const transport = transportOver(quotingRefusal(newLog()));

      const outcome = await raisedBy(transport.execute(requestFor(abortedWith(null))));

      expect(outcome.raised && outcome.value === null).toBe(true);
    });

    it("raises the signal's default reason when it aborted without one", async () => {
      const signal = abortedWith(undefined);
      const transport = transportOver(quotingRefusal(newLog()));

      const outcome = await raisedBy(transport.execute(requestFor(signal)));

      expect(outcome.raised && outcome.value === signal.reason).toBe(true);
      expect(exposes(outcome, SECRETS)).toBe(false);
    });

    it("raises the reason when the abort lands while the request is in flight", async () => {
      const controller = new AbortController();
      const reason = new Error("the caller stopped waiting");
      const log = newLog();
      const transport = transportOver(
        fetchDouble(
          log,
          (authorization, signal) =>
            new Promise<Response>((_resolve, reject) => {
              signal?.addEventListener("abort", () => {
                reject(new TypeError(`the request for "${authorization ?? ""}" was cut`));
              });
            }),
        ),
      );

      const pending = raisedBy(transport.execute(requestFor(controller.signal)));
      controller.abort(reason);
      const outcome = await pending;

      expect(outcome.raised && outcome.value === reason).toBe(true);
      expect(exposes(outcome, SECRETS)).toBe(false);
    });

    it("raises the reason when the abort lands while a body is being read", async () => {
      const reason = new Error("the leg's own deadline");

      for (const status of [200, BAD_GATEWAY]) {
        const controller = new AbortController();
        const transport = transportOver(
          fetchDouble(newLog(), () => {
            // The answer has started; the abort arrives before its body does.
            controller.abort(reason);
            return unreadableResponse(status, SENTINEL);
          }),
        );

        const outcome = await raisedBy(transport.execute(requestFor(controller.signal)));

        expect(outcome.raised && outcome.value === reason).toBe(true);
      }
    });

    it("records a leg that ran out its budget as a timeout, with the key in no reason", async () => {
      vi.useFakeTimers();
      try {
        const log = newLog();
        const transport = transportOver(
          fetchDouble(
            log,
            (authorization, signal) =>
              new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener("abort", () => {
                  reject(new TypeError(`Headers.append: "${authorization ?? ""}" is an invalid header value.`));
                });
              }),
          ),
        );
        const route = makeRoute({ alias: ALIAS, role: "primary" });
        const walk = rejection(
          executeChain<string>(ALIAS, {
            legs: [{ route, transport, params: {} }],
            content: "prompt",
            responseFormat: "text",
            breakers: new CircuitBreakerRegistry(routeTable.defaults.circuit_breaker, () => Date.now()),
            now: () => Date.now(),
          }),
          ChainExhaustedError,
        );

        await vi.advanceTimersByTimeAsync(TEST_LEG_TIMEOUT_MS);
        const error = await walk;

        expect(log.calls).toBe(1);
        expect(error.attempts.map((attempt) => attempt.failureClass)).toEqual(["leg_timeout"]);
        expect(error.attempts.map((attempt) => attempt.outcome)).toEqual(["timeout"]);
        expect(exposes(error, SECRETS)).toBe(false);
        expect(exposes(error.attempts, SECRETS)).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("a key a header cannot carry is refused before any request is made", () => {
    it.each(UNCARRIABLE_KEYS)("refuses a key with $label, naming the variable and not the value", async ({ key }) => {
      process.env[KEY_ENV] = key;
      const log = newLog();
      const transport = transportOver(fetchDouble(log, healthyResponse));

      const error = await rejection(transport.execute(requestFor()), GatewayUnreachableError);

      expect(log.calls).toBe(0);
      expect(exposes(error, SECRETS)).toBe(false);
      expect(
        isExactly(
          error.message,
          `LLM gateway at ${GATEWAY_URL} is unreachable: ${KEY_ENV} holds a value that cannot be carried in a request header, ` +
          "so the LLM gateway cannot be authenticated against; no request was made. " +
          "Provision it again from the secrets manager, without a line break or a control character inside it.",
        ),
      ).toBe(true);
      // The class is the one such a key always had: the header layer refused
      // the request, which read as a gateway that could not be reached.
      expect(verdictOf(error)).toEqual(UNREACHABLE_VERDICT);
    });

    it("raises the signal's reason, and still makes no request, when the signal has aborted", async () => {
      process.env[KEY_ENV] = `${SENTINEL}\n${SECOND_LINE}`;
      const reason = new Error("the leg's own deadline");
      const log = newLog();
      const transport = transportOver(fetchDouble(log, healthyResponse));

      const outcome = await raisedBy(transport.execute(requestFor(abortedWith(reason))));

      expect(log.calls).toBe(0);
      expect(outcome.raised && outcome.value === reason).toBe(true);
    });

    it("says of an unset key exactly what it always said, and makes no request", async () => {
      const log = newLog();
      const transport = transportOver(fetchDouble(log, healthyResponse), UNSET_KEY_ENV);

      const error = await rejection(transport.execute(requestFor()), GatewayUnreachableError);

      expect(log.calls).toBe(0);
      expect(isExactly(error.message, UNSET_KEY_MESSAGE)).toBe(true);
      expect(verdictOf(error)).toEqual(UNREACHABLE_VERDICT);
    });

    it.each(CARRIABLE_KEYS)("sends a key with $label exactly as it was read", async ({ key }) => {
      process.env[KEY_ENV] = key;
      const log = newLog();
      const transport = transportOver(fetchDouble(log, healthyResponse));

      const result = await transport.execute<string>(requestFor());

      expect(log.calls).toBe(1);
      expect(log.authorization === `Bearer ${key}`).toBe(true);
      expect(result.response).toBe(ANSWER);
    });

    it("still degrades to the direct path for such a key, as it did when the header layer refused it", async () => {
      process.env[KEY_ENV] = `${SENTINEL}\n${SECOND_LINE}`;
      const log = newLog();
      const direct = new ScriptedTransport("direct", (call) => answers(ANSWER, usageFor(call.route)));
      configureLlmClient({ gatewayTransport: transportOver(fetchDouble(log, healthyResponse)), directTransport: direct });

      const result = await callLLMByAlias<string>("prompt", "text", { alias: ALIAS });

      expect(log.calls).toBe(0);
      expect(result.degraded).toBe(true);
      expect(result.response).toBe(ANSWER);
      const refused = result.attempts.filter((attempt) => attempt.outcome !== "ok");
      expect(refused.length).toBeGreaterThan(0);
      expect(refused.every((attempt) => attempt.failureClass === "gateway_unreachable")).toBe(true);
      expect(exposes(result.attempts, SECRETS)).toBe(false);
    });
  });

  describe("what the gateway answers a failure with has the key taken out", () => {
    it("removes a key the gateway quotes back in the body of a rejection", async () => {
      const transport = transportOver(
        fetchDouble(newLog(), (authorization) =>
          new Response(JSON.stringify({ error: { message: `invalid token: ${authorization ?? ""}` } }), {
            status: UNAUTHORIZED,
          }),
        ),
      );

      const error = await rejection(transport.execute(requestFor()), GatewayResponseError);

      expect(exposes(error, SECRETS)).toBe(false);
      expect(error.status).toBe(UNAUTHORIZED);
      expect(
        isExactly(
          error.message,
          `LLM gateway returned ${UNAUTHORIZED}: ${JSON.stringify({ error: { message: `invalid token: Bearer ${CREDENTIAL_REMOVED}` } })}`,
        ),
      ).toBe(true);
      expect(classify(error, undefined).failureClass).toBe("credential");
    });

    it("removes the key the header carried when the one read had a line break after it", async () => {
      process.env[KEY_ENV] = `${SENTINEL}\r\n`;
      const transport = transportOver(
        fetchDouble(newLog(), () => new Response(`Received API Key = ${SENTINEL}.`, { status: UNAUTHORIZED })),
      );

      const error = await rejection(transport.execute(requestFor()), GatewayResponseError);

      expect(exposes(error, SECRETS)).toBe(false);
      expect(isExactly(error.message, `LLM gateway returned ${UNAUTHORIZED}: Received API Key = ${CREDENTIAL_REMOVED}.`)).toBe(true);
    });

    it("removes a key the body quotes in its JSON-escaped form", async () => {
      process.env[KEY_ENV] = ESCAPED_SENTINEL;
      const body = JSON.stringify({ error: { message: `no such key: ${ESCAPED_SENTINEL}` } });
      const transport = transportOver(fetchDouble(newLog(), () => new Response(body, { status: UNAUTHORIZED })));

      const error = await rejection(transport.execute(requestFor()), GatewayResponseError);

      expect(
        isExactly(
          error.message,
          `LLM gateway returned ${UNAUTHORIZED}: ${JSON.stringify({ error: { message: `no such key: ${CREDENTIAL_REMOVED}` } })}`,
        ),
      ).toBe(true);
      expect(error.message.includes(JSON.stringify(ESCAPED_SENTINEL).slice(1, -1))).toBe(false);
    });

    it("removes a key that lies across the end of the excerpt whole, leaving no prefix of it", async () => {
      const lead = "x".repeat(BODY_EXCERPT - SENTINEL.length / 2);
      const transport = transportOver(
        fetchDouble(newLog(), () => new Response(`${lead}${SENTINEL} trailing text`, { status: BAD_GATEWAY })),
      );

      const error = await rejection(transport.execute(requestFor()), GatewayResponseError);

      expect(error.message.includes(SENTINEL.slice(0, SENTINEL.length / 2))).toBe(false);
      expect(error.message.startsWith(`LLM gateway returned ${BAD_GATEWAY}: ${lead}`)).toBe(true);
    });

    it("quotes a body that does not hold the key exactly as it always did", async () => {
      const short = JSON.stringify({ error: { message: "upstream primary refused the request" } });
      const long = "upstream said: ".concat("y".repeat(BODY_EXCERPT * 2));

      for (const body of [short, long]) {
        const transport = transportOver(fetchDouble(newLog(), () => new Response(body, { status: BAD_GATEWAY })));

        const error = await rejection(transport.execute(requestFor()), GatewayResponseError);

        expect(isExactly(error.message, `LLM gateway returned ${BAD_GATEWAY}: ${body.slice(0, BODY_EXCERPT)}`)).toBe(true);
        expect(error.retryable).toBe(true);
      }
    });
  });

  describe("an answer that cannot be read is described, not quoted", () => {
    it("names a body that is not JSON without repeating any of it, and classifies it as before", async () => {
      const body = `${SENTINEL} is not a recognised key`;
      const transport = transportOver(fetchDouble(newLog(), () => new Response(body, { status: 200 })));

      const outcome = await raisedBy(transport.execute(requestFor()));

      // What this path raised before: the parser's own error, which quotes
      // the start of the text it could not parse.
      const start = body.slice(0, QUOTED_BY_PARSER);
      let parserError: unknown;
      try {
        JSON.parse(body);
      } catch (error) {
        parserError = error;
      }
      expect(exposes(parserError, [start])).toBe(true);

      expect(outcome.raised).toBe(true);
      expect(exposes(outcome, [...SECRETS, start])).toBe(false);
      const raised = outcome.raised ? outcome.value : undefined;
      expect(
        isExactly(
          raised instanceof Error ? raised.message : null,
          "LLM gateway answered 200 with a body that could not be read: it is not JSON",
        ),
      ).toBe(true);
      expect(verdictOf(raised)).toEqual(PROVIDER_ERROR_VERDICT);
      expect(verdictOf(new SyntaxError("Unexpected token 'h', \"hello\" is not valid JSON"))).toEqual(
        PROVIDER_ERROR_VERDICT,
      );
    });

    it.each([200, BAD_GATEWAY, UNAUTHORIZED])(
      "names a %i body that failed while it was being read by the failure's class, on a live signal",
      async (status) => {
        const transport = transportOver(fetchDouble(newLog(), () => unreadableResponse(status, SENTINEL)));

        const outcome = await raisedBy(transport.execute(requestFor()));

        expect(outcome.raised).toBe(true);
        expect(exposes(outcome, SECRETS)).toBe(false);
        const raised = outcome.raised ? outcome.value : undefined;
        expect(
          isExactly(
            raised instanceof Error ? raised.message : null,
            `LLM gateway answered ${status} with a body that could not be read: Error`,
          ),
        ).toBe(true);
        // As before, when the raw read failure was rethrown: a failure with no
        // status to go by, whatever status the unread answer began with.
        expect(verdictOf(raised)).toEqual(PROVIDER_ERROR_VERDICT);
      },
    );

    it("returns a readable answer exactly as it always did", async () => {
      const transport = transportOver(fetchDouble(newLog(), healthyResponse));

      const result = await transport.execute<string>(requestFor());

      expect(result.response).toBe(ANSWER);
      expect(result.usage.prompt_tokens).toBeNull();
      expect(result.servedModel).toBeNull();
    });
  });

  describe("the gateway's address is printed without the credentials in it", () => {
    it("leaves out a user and password written into the base URL", async () => {
      const baseUrl = `https://operator:${SENTINEL}@llm-gateway.invalid/v1`;
      const transport = transportOver(quotingRefusal(newLog()), KEY_ENV, baseUrl);

      const error = await rejection(transport.execute(requestFor()), GatewayUnreachableError);

      expect(exposes(error, SECRETS)).toBe(false);
      expect(
        isExactly(
          error.message,
          "LLM gateway at https://llm-gateway.invalid/v1 is unreachable: TypeError, caused by Error",
        ),
      ).toBe(true);
    });

    it("holds nothing the platform's own HTTP client says when it refuses such an address", async () => {
      // No double: the platform's client refuses a URL that holds credentials
      // before it looks the name up, and says so by quoting the URL.
      const baseUrl = `https://operator:${SENTINEL}@llm-gateway.invalid`;
      const platformRefusal = await raisedBy(fetch(`${baseUrl}/chat/completions`, { method: "POST" }));
      expect(exposes(platformRefusal, SECRETS)).toBe(true);
      const transport = createGatewayTransport({
        baseUrl,
        apiKeyEnv: KEY_ENV,
        modelNameFor: (request: LlmTransportRequest) => request.route.alias,
      });

      const live = await raisedBy(transport.execute(requestFor()));
      const reason = new Error("the leg's own deadline");
      const aborted = await raisedBy(transport.execute(requestFor(abortedWith(reason))));

      expect(live.raised && live.value instanceof GatewayUnreachableError).toBe(true);
      expect(exposes(live, SECRETS)).toBe(false);
      expect(aborted.raised && aborted.value === reason).toBe(true);
    });

    it("prints an address with no credentials in it unchanged", () => {
      for (const baseUrl of [GATEWAY_URL, "http://10.0.0.7:4000/", "https://llm-gateway.internal/v1?team=a@b"]) {
        expect(
          isExactly(
            new GatewayUnreachableError(baseUrl, new Error("x")).message,
            `LLM gateway at ${baseUrl} is unreachable: Error`,
          ),
        ).toBe(true);
      }
    });
  });

  describe("an ordinary unreachable gateway is classified exactly as it was", () => {
    it.each(ORDINARY_FAILURES)("$label keeps its outcome, health verdict, cooldown and class", ({ build }) => {
      const now = verdictOf(new GatewayUnreachableError(GATEWAY_URL, build()));
      const before = verdictOf(new MessageQuotingUnreachableError(GATEWAY_URL, build()));

      expect(now).toEqual(before);
      expect(now).toEqual(UNREACHABLE_VERDICT);
    });

    it.each(ORDINARY_FAILURES)("$label still reads as a gateway outage to the client", async ({ build }) => {
      const direct = new ScriptedTransport("direct", (call) => answers(ANSWER, usageFor(call.route)));
      configureLlmClient({
        gatewayTransport: transportOver(
          fetchDouble(newLog(), () => {
            throw build();
          }),
        ),
        directTransport: direct,
      });

      const result = await callLLMByAlias<string>("prompt", "text", { alias: ALIAS });

      expect(result.degraded).toBe(true);
      const failed = result.attempts.filter((attempt) => attempt.outcome !== "ok");
      expect(failed.length).toBeGreaterThan(0);
      expect(failed.every((attempt) => attempt.failureClass === "gateway_unreachable")).toBe(true);
      expect(failed.every((attempt) => attempt.outcome === "error")).toBe(true);
    });

    it("classifies a connection the platform itself refuses as an unreachable gateway", async () => {
      // A port that was open a moment ago and is now closed: the platform's
      // own HTTP client raises its own refusal, with nothing stood in for it.
      const server = createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      const transport = createGatewayTransport({
        baseUrl,
        apiKeyEnv: KEY_ENV,
        modelNameFor: (request: LlmTransportRequest) => request.route.alias,
      });

      const error = await rejection(transport.execute(requestFor()), GatewayUnreachableError);

      expect(isExactly(error.message, `LLM gateway at ${baseUrl} is unreachable: TypeError, caused by Error ECONNREFUSED`)).toBe(true);
      expect(verdictOf(error)).toEqual(UNREACHABLE_VERDICT);
      expect(exposes(error, SECRETS)).toBe(false);
    });
  });
});
