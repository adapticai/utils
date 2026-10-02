/**
 * An offline stand-in for the HTTP call the hosted decision transport makes.
 *
 * No request leaves the process. Each call is turned into a real `Request`
 * first, so the runtime's own rules apply to it exactly as they would on the
 * way to a socket: header names are lower-cased, values are normalised, and a
 * header the runtime cannot send is refused with the runtime's own error. What
 * a test then reads back is what would have gone on the wire, not what the
 * transport handed over, and a request the runtime refuses is never recorded
 * as sent.
 */

import type {
  SystemOneFetch,
  SystemOneFetchResponse,
} from "../../../../llm/decision/transports/systemone";
import type { DecisionFixtureEnvelope } from "./fixtures";

/** One request the double received, as the runtime would have sent it. */
export interface RecordedDecisionFetch {
  readonly url: string;
  readonly method: string;
  /** Every header of the request, by lower-case name. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** How the request treats a redirect. */
  readonly redirect: string;
  /** The very signal object the transport passed, for an identity check. */
  readonly signal: AbortSignal;
}

/**
 * What the double does with a request: answer it, or throw as a network would.
 *
 * @param call The recorded request.
 * @param index The zero-based position of the request among those received.
 * @returns The response.
 */
export type DecisionFetchScript = (
  call: RecordedDecisionFetch,
  index: number,
) => SystemOneFetchResponse | Promise<SystemOneFetchResponse>;

/** A scripted HTTP call and the requests it received. */
export interface DecisionFetchDouble {
  readonly fetchImpl: SystemOneFetch;
  readonly calls: readonly RecordedDecisionFetch[];
}

/**
 * Build a scripted HTTP call.
 *
 * @param script What to do with each request.
 * @returns The call to inject, and the list it records into.
 */
export function createDecisionFetchDouble(script: DecisionFetchScript): DecisionFetchDouble {
  const calls: RecordedDecisionFetch[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      const request = new Request(url, init);
      const call: RecordedDecisionFetch = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.text(),
        redirect: request.redirect,
        signal: init.signal,
      };
      calls.push(call);
      return script(call, calls.length - 1);
    },
  };
}

/**
 * A response with a status, a text body and headers.
 *
 * Built structurally rather than as a platform `Response`, which cannot be
 * constructed with a status below 200: the transport must classify every
 * status it could be handed, including the ones a platform never surfaces.
 *
 * @param status The HTTP status.
 * @param body The body as text.
 * @param headers The response headers.
 * @returns The response.
 */
export function decisionResponse(
  status: number,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): SystemOneFetchResponse {
  return { status, headers: new Headers(headers), text: () => Promise.resolve(body) };
}

/**
 * A response whose body cannot be read.
 *
 * @param status The HTTP status.
 * @param failure What reading the body throws.
 * @param headers The response headers.
 * @returns The response.
 */
export function unreadableDecisionResponse(
  status: number,
  failure: unknown,
  headers: Readonly<Record<string, string>> = {},
): SystemOneFetchResponse {
  return { status, headers: new Headers(headers), text: () => Promise.reject(failure) };
}

/**
 * The response a fixture's envelope describes.
 *
 * @param envelope The fixture's content.
 * @param fallbackStatus The status to use when the envelope records none, as
 *   for a documented success, whose status the reference does not quote.
 * @param extraHeaders Headers to add to the envelope's own.
 * @returns The response, with the envelope's body written as JSON.
 */
export function decisionResponseFromFixture(
  envelope: DecisionFixtureEnvelope,
  fallbackStatus: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): SystemOneFetchResponse {
  return decisionResponse(envelope.status ?? fallbackStatus, JSON.stringify(envelope.body), {
    ...envelope.headers,
    ...extraHeaders,
  });
}
