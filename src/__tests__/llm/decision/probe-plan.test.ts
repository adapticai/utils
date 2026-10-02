/**
 * The operator's decision contract probe.
 *
 * The probe is the first code that will ever call the hosted decision vendor
 * with a key, and it is run by hand, once, under an operator's own account. So
 * what is pinned here is what an operator and a reviewer rely on it for: that
 * with no arguments it sends nothing, that a run which sends has to be asked
 * for by route and by the exact number of calls, that it makes those calls one
 * at a time and never faster than this package allows a production caller,
 * that it judges an answer by the rules a production call is judged by, and
 * that what it writes holds counts, timings and model ids and never a key, a
 * response body or the value of a header.
 *
 * No request leaves the machine. The vendor is a scripted HTTP call replaying
 * the contract fixtures, each loaded under the class of evidence it rests on,
 * or a server on the loopback interface for the two tests that run the command
 * itself. The clock is injected, so nothing here waits on real time except the
 * one test of the probe's own deadline.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROBE_EXIT_NOT_CONFIRMED,
  PROBE_EXIT_OK,
  PROBE_EXIT_REFUSED,
  parseProbeArguments,
  probeTextCarriesKey,
  runProbeCli,
  systemProbeCliDeps,
} from "../../../../scripts/decision-probe/probe-cli";
import type { ProbeCliDeps } from "../../../../scripts/decision-probe/probe-cli";
import {
  PROBE_BODY_SHAPES,
  PROBE_MAX_SAMPLES,
  PROBE_REFUSAL_SHAPE,
  ProbePlanError,
  buildProbePlan,
  describeProbeBody,
  recordObservation,
} from "../../../../scripts/decision-probe/probe-plan";
import type { ProbeBodyShape, ProbeShape } from "../../../../scripts/decision-probe/probe-plan";
import {
  PROBE_EVIDENCE_AUTHENTICATED,
  PROBE_LATENCY_POPULATION,
  renderProbeSummary,
  summariseLatency,
} from "../../../../scripts/decision-probe/probe-report";
import type { ProbeReport, ProbeSample } from "../../../../scripts/decision-probe/probe-report";
import {
  PROBE_CAPACITY_REFUSALS_BEFORE_STOP,
  PROBE_LONGEST_HONOURED_WAIT_MS,
  PROBE_MIN_DISPATCH_SPACING_MS,
  probeDispatchIntervalMs,
  probeDispatchSpacingMs,
  resolveProbeTarget,
  runDecisionProbe,
} from "../../../../scripts/decision-probe/probe-run";
import type {
  ProbeClock,
  ProbeFetch,
  ProbeFetchResponse,
  ProbeRunConfig,
} from "../../../../scripts/decision-probe/probe-run";
import { encodeDecisionRequest } from "../../../llm/decision/codec";
import { DECISION_BUDGET_CEILING_MS, decisionRouteTable } from "../../../llm/decision/decision-route-table";
import { DecisionCallError } from "../../../llm/decision/errors";
import type { ResolvedDecisionRoute } from "../../../llm/decision/route-types";
import {
  SYSTEMONE_PATH,
  VENDOR_REQUEST_ID_HEADER,
  createSystemOneTransport,
} from "../../../llm/decision/transports/systemone";
import { limitsFor } from "../../../llm/rate-guard";
import { loadDecisionFixture } from "./support/fixtures";
import type { DecisionEvidenceClass } from "./support/fixtures";
import {
  HOSTED_ROUTE,
  LOCAL_ROUTE,
  editableDecisionRouteTable,
  hostedProviderOf,
  hostedRouteOf,
} from "./support/routes";

/** The package root, which the command resolves its sources against. */
const UTILS_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The command, relative to the package root. */
const PROBE_SCRIPT = "scripts/probe-decision-contract.mjs";

/** The hosted route and its provider, as the canonical table declares them. */
const HOSTED = hostedRouteOf(decisionRouteTable);
const PROVIDER = hostedProviderOf(decisionRouteTable);

/** The model id the canonical table pins the hosted route to. */
const PIN = HOSTED.version_pin;

/** Env-var NAME the hosted route's key is read from. */
const KEY_ENV = PROVIDER.api_key_env;

/** Env-var NAME that overrides the hosted route's base URL. */
const BASE_URL_ENV = PROVIDER.base_url_env ?? "";

/** The base URL the canonical table declares for the hosted route. */
const DECLARED_BASE_URL = PROVIDER.base_url ?? "";

/**
 * A recognisable stand-in for the key, searched for in everything a run writes.
 *
 * Assembled at runtime so that no credential-shaped literal sits in the tree
 * for a secret scan to trip over.
 */
const SENTINEL_KEY = ["dk", "probe", "7c1e9a40b6d2f358", "do-not-leak"].join("-");

/** A key a JSON string has to escape: it holds a quote and a backslash. */
const ESCAPED_KEY = ["dk", "probe", '5d"2b\\9e', "do-not-leak"].join("-");

/** A key of both cases, short enough to stand in a header's name and made only of characters one may hold. */
const MIXED_CASE_KEY = ["dk", "Probe", "9E4b7A", "DoNotLeak"].join("-");

/** The scheme the key is sent under. */
const BEARER = "Bearer ";

/** Text a vendor might write, searched for in everything a run writes. */
const VENDOR_WORDS = ["vendor", "wrote", "this", "3f9a1c"].join("-");

/** A vendor request id, in the form the observed response header carries one. */
const REQUEST_ID = "req_0123456789abcdef0123456789abcdef";

/** A model a vendor reports answering with that is not the route's pin. */
const SUBSTITUTED_MODEL = "jev-1.14.0";

/** The date the injected clock starts on, and the instant. */
const RUN_DATE = "2026-10-02";
const RUN_STARTED_MS = Date.UTC(2026, 9, 2, 14, 30, 0);

/** The status the tests replay a documented success under; the reference quotes none. */
const OK = 200;

/** The calls of a plan with one sample: three answerable shapes and the refused request. */
const DEFAULT_PLAN_CALLS = 4;

/** How long a scripted vendor takes to answer, on the injected clock. */
const VENDOR_LATENCY_MS = 30;

/** How long a scripted vendor takes to send a body once its headers have arrived, on the injected clock. */
const BODY_READ_MS = 7;

/** The most requests a second the hosted vendor publishes that an account may send. */
const PUBLISHED_REQUESTS_PER_SECOND = 40;

/** One second, the span the published ceiling is counted over. */
const ONE_SECOND_MS = 1_000;

/** The status a vendor answers with when it is being called too often. */
const TOO_MANY_REQUESTS = 429;

/** How long a scripted vendor takes to refuse a call it then asks the run to wait after. */
const SLOW_REFUSAL_MS = 400;

/** Samples of each shape in a run long enough to show that a refusing vendor ends it early. */
const LONG_RUN_SAMPLES = 100;

/** Longest the command may run as a child process before a test gives up on it. */
const COMMAND_TIMEOUT_MS = 60_000;

/** The address a loopback server listens on. */
const LOOPBACK_HOST = "127.0.0.1";

/** Temporary directories made by a test, removed after it. */
const temporaryDirs: string[] = [];

/** Loopback servers started by a test, closed after it. */
const servers: Server[] = [];

beforeEach(() => {
  vi.stubEnv(KEY_ENV, SENTINEL_KEY);
  vi.stubEnv(BASE_URL_ENV, "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/**
 * Read a value as an object with named members.
 *
 * @param value The value.
 * @returns The value, typed as a record.
 * @throws When it is not a non-null, non-array object.
 */
function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * The body of a contract fixture.
 *
 * @param name The fixture's file name.
 * @param evidence The evidence class the caller relies on.
 * @returns The body.
 */
function fixtureBody(name: string, evidence: DecisionEvidenceClass): unknown {
  return loadDecisionFixture(name, { allow: [evidence] }).envelope.body;
}

/** One request the scripted vendor received, as the runtime would have sent it. */
interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly redirect: string;
  readonly signal: AbortSignal;
}

/** What the scripted vendor does with a request. */
type VendorScript = (call: RecordedCall, index: number) => ProbeFetchResponse | Promise<ProbeFetchResponse>;

/** A scripted vendor and what it received. */
interface VendorDouble {
  readonly fetchImpl: ProbeFetch;
  readonly calls: readonly RecordedCall[];
  /** The most requests that were ever in flight at once. */
  readonly peakInFlight: () => number;
}

/**
 * Build a scripted vendor.
 *
 * Each call is turned into a real `Request` first, so what is recorded is what
 * would have gone on the wire and not what the probe handed over.
 *
 * @param script What to do with each request.
 * @returns The HTTP call to inject, the requests it received, and how many overlapped.
 */
function vendor(script: VendorScript): VendorDouble {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    calls,
    peakInFlight: () => peak,
    fetchImpl: async (url, init) => {
      const request = new Request(url, init);
      const call: RecordedCall = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.text(),
        redirect: request.redirect,
        signal: init.signal,
      };
      calls.push(call);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await script(call, calls.length - 1);
      } finally {
        inFlight -= 1;
      }
    },
  };
}

/**
 * A response with a status, a text body and headers.
 *
 * @param status The HTTP status.
 * @param body The body, written as JSON unless it is already text.
 * @param headers The response headers.
 * @returns The response.
 */
function reply(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): ProbeFetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, headers: new Headers(headers), text: () => Promise.resolve(text) };
}

/**
 * Which of the plan's shapes a request body is.
 *
 * @param body The request body as sent.
 * @returns The shape: the kind of its one question, or the refused shape when the question has no instructions.
 */
function shapeOfSent(body: string): ProbeShape {
  const question = recordOf(Object.values(recordOf(recordOf(JSON.parse(body)).questions))[0]);
  if (!Object.hasOwn(question, "instructions")) {
    return PROBE_REFUSAL_SHAPE;
  }
  const kind = question.type;
  if (kind !== "choice" && kind !== "noul" && kind !== "score") {
    throw new Error("the probe sent a question of no known kind");
  }
  return kind;
}

/** The headers an answering vendor sends with every response in these tests. */
const VENDOR_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json",
  [VENDOR_REQUEST_ID_HEADER]: REQUEST_ID,
};

/**
 * What a vendor that honours the contract answers each shape with.
 *
 * The choice is the documented example. The other two are the fixtures built
 * from the documented field tables, and the refusal is a body nobody has seen,
 * which is all there is for that status.
 */
const CONTRACT_ANSWERS: Readonly<Record<ProbeShape, () => ProbeFetchResponse>> = {
  choice: () => reply(OK, fixtureBody("response.choice.documented.json", "documented-verbatim"), VENDOR_HEADERS),
  noul: () =>
    reply(OK, fixtureBody("response.noul.constructed.json", "constructed-from-documented-fields"), VENDOR_HEADERS),
  score: () =>
    reply(OK, fixtureBody("response.score.constructed.json", "constructed-from-documented-fields"), VENDOR_HEADERS),
  [PROBE_REFUSAL_SHAPE]: () =>
    reply(422, fixtureBody("error.422.unobserved.json", "synthetic-unobserved"), VENDOR_HEADERS),
};

/**
 * A vendor that honours the contract, except where a test says otherwise.
 *
 * @param overrides What to answer a shape with instead, given how many requests of that shape came before.
 * @returns The script.
 */
function answering(
  overrides: Partial<Record<ProbeShape, (nth: number, call: RecordedCall) => ProbeFetchResponse | Promise<ProbeFetchResponse>>> = {},
): VendorScript {
  const seen = new Map<ProbeShape, number>();
  return (call) => {
    const shape = shapeOfSent(call.body);
    const nth = seen.get(shape) ?? 0;
    seen.set(shape, nth + 1);
    const override = overrides[shape];
    return override === undefined ? CONTRACT_ANSWERS[shape]() : override(nth, call);
  };
}

/** An injected clock, what it was asked to wait, and a way to move it. */
interface FakeTime {
  readonly clock: ProbeClock;
  readonly waits: readonly number[];
  readonly advance: (ms: number) => void;
  readonly nowMs: () => number;
}

/**
 * Build an injected clock.
 *
 * Waiting moves the clock and takes no real time.
 *
 * @returns The clock, the waits it was asked for, and its control.
 */
function fakeTime(): FakeTime {
  let elapsed = 0;
  const waits: number[] = [];
  return {
    waits,
    advance: (ms) => {
      elapsed += ms;
    },
    nowMs: () => elapsed,
    clock: {
      monotonicMs: () => elapsed,
      epochMs: () => RUN_STARTED_MS + elapsed,
      wait: (ms) => {
        waits.push(ms);
        elapsed += ms;
        return Promise.resolve();
      },
    },
  };
}

/**
 * Make one run against a scripted vendor.
 *
 * @param double The vendor.
 * @param config What differs from one sample of each shape plus the refused request.
 * @param time The clock; a fresh one unless given.
 * @returns The report.
 */
function probe(
  double: VendorDouble,
  config: Partial<ProbeRunConfig> = {},
  time: FakeTime = fakeTime(),
): Promise<ProbeReport> {
  return runDecisionProbe({
    route: HOSTED_ROUTE,
    samples: 1,
    includeRefusal: true,
    fetchImpl: double.fetchImpl,
    clock: time.clock,
    ...config,
  });
}

/**
 * The one sample of a shape in a report.
 *
 * @param report The report.
 * @param shape The shape.
 * @returns Its first sample.
 * @throws When the report holds none.
 */
function sampleOf(report: ProbeReport, shape: ProbeShape): ProbeSample {
  const sample = report.samples.find((candidate) => candidate.shape === shape);
  if (sample === undefined) {
    throw new Error(`the report holds no ${shape} sample`);
  }
  return sample;
}

/** The command driven in-process, and everything it wrote. */
interface CliHarness {
  readonly deps: ProbeCliDeps;
  readonly printed: string[];
  readonly warned: string[];
  readonly prepared: string[];
  readonly written: { readonly dir: string; readonly fileName: string; readonly text: string }[];
}

/**
 * Build the command's outside world from doubles.
 *
 * @param double The vendor.
 * @returns What to hand the command, and what it did with it.
 */
function cliHarness(double: VendorDouble): CliHarness {
  const printed: string[] = [];
  const warned: string[] = [];
  const prepared: string[] = [];
  const written: { dir: string; fileName: string; text: string }[] = [];
  return {
    printed,
    warned,
    prepared,
    written,
    deps: {
      fetchImpl: double.fetchImpl,
      clock: fakeTime().clock,
      print: (line) => {
        printed.push(line);
      },
      warn: (line) => {
        warned.push(line);
      },
      prepareOut: (dir) => {
        prepared.push(dir);
      },
      writeReport: (dir, fileName, text) => {
        written.push({ dir, fileName, text });
        return join(dir, fileName);
      },
    },
  };
}

/** The arguments of a run that sends the default plan. */
const EXECUTE_ARGS: readonly string[] = [
  "--execute",
  "--route",
  HOSTED_ROUTE,
  "--acknowledge-real-calls",
  String(DEFAULT_PLAN_CALLS),
  "--out",
  "probe-out",
];

describe("the plan", () => {
  let target: ResolvedDecisionRoute;

  // Resolved inside each test, after the environment has been stubbed: a base
  // URL override in the shell that runs the suite must not reach it.
  beforeEach(() => {
    target = resolveProbeTarget(HOSTED_ROUTE, RUN_DATE).resolved;
  });

  it("the plan is exactly four requests and addresses the pin, never an alias", () => {
    const plan = buildProbePlan(target);

    expect(plan.requests.map((request) => request.shape)).toEqual(["choice", "noul", "score", PROBE_REFUSAL_SHAPE]);
    expect(plan.dispatches).toHaveLength(DEFAULT_PLAN_CALLS);
    expect(plan.dispatches).toEqual(plan.requests);

    expect(PIN).not.toMatch(/(?:latest|preview)$/i);
    for (const request of plan.dispatches) {
      expect(request.body.model).toBe(PIN);
    }

    const documented = recordOf(fixtureBody("request.choice.documented.json", "documented-verbatim"));
    expect(documented.model).not.toBe(PIN);
    expect(JSON.stringify(plan.requests[0].body)).toBe(JSON.stringify({ ...documented, model: PIN }));
    expect(JSON.stringify(plan.requests[1].body)).toBe(
      JSON.stringify(fixtureBody("request.noul.constructed.json", "constructed-from-documented-fields")),
    );
    expect(JSON.stringify(plan.requests[2].body)).toBe(
      JSON.stringify(fixtureBody("request.score.constructed.json", "constructed-from-documented-fields")),
    );
  });

  it("an answerable request is written by the production encoder under the route's own limits", () => {
    for (const request of buildProbePlan(target).requests) {
      if (request.expect === "answer") {
        expect(request.body).toEqual(encodeDecisionRequest(request.request, { model: PIN, caps: target.caps }));
      }
    }
    expect(target.caps).toEqual({
      maxOptions: HOSTED.caps.max_options,
      maxScoreLevels: HOSTED.caps.max_score_levels,
      maxQuestions: HOSTED.caps.max_questions,
    });
  });

  it("the refused request is the documented choice with its instructions taken out and nothing else changed", () => {
    const [choice, , , refused] = buildProbePlan(target).requests;
    const expected = recordOf(JSON.parse(JSON.stringify(choice.body)));
    const withoutInstructions = {
      ...expected,
      questions: Object.fromEntries(
        Object.entries(recordOf(expected.questions)).map(([id, question]) => {
          const { instructions: _removed, ...rest } = recordOf(question);
          return [id, rest];
        }),
      ),
    };

    expect(refused.expect).toBe("refusal");
    expect(JSON.stringify(refused.body)).toBe(JSON.stringify(withoutInstructions));
    expect(JSON.stringify(refused.body)).not.toContain("instructions");
  });

  it("more samples repeat each answerable shape in turn, and the refused request is still sent once and last", () => {
    const samples = 3;
    const plan = buildProbePlan(target, { samples });

    expect(plan.requests).toHaveLength(DEFAULT_PLAN_CALLS);
    expect(plan.dispatches.map((request) => request.shape)).toEqual([
      "choice",
      "noul",
      "score",
      "choice",
      "noul",
      "score",
      "choice",
      "noul",
      "score",
      PROBE_REFUSAL_SHAPE,
    ]);
  });

  it("the refused request can be left out, and then only answerable requests are sent", () => {
    const plan = buildProbePlan(target, { includeRefusal: false });

    expect(plan.dispatches.map((request) => request.expect)).toEqual(["answer", "answer", "answer"]);
  });

  it("a number of samples that is not a whole number from one to the ceiling is refused", () => {
    for (const samples of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, PROBE_MAX_SAMPLES + 1]) {
      expect(() => buildProbePlan(target, { samples })).toThrow(ProbePlanError);
    }
    expect(buildProbePlan(target, { samples: PROBE_MAX_SAMPLES }).dispatches).toHaveLength(
      PROBE_MAX_SAMPLES * 3 + 1,
    );
  });

  it("the route is resolved as onboarding will leave it, and a route the consumer serves is refused", () => {
    expect(target.modelPin).toBe(PIN);
    expect(target.expectedServedModel).toBe(HOSTED.expected_served_model);
    expect(target.budgetMs).toBe(HOSTED.budget_ms);
    expect(target.baseUrl).toBe(DECLARED_BASE_URL);
    expect(resolveProbeTarget(HOSTED_ROUTE, RUN_DATE).endpoint).toBe("declared");

    let refusal: unknown;
    try {
      resolveProbeTarget(LOCAL_ROUTE, RUN_DATE);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(DecisionCallError);
    expect(recordOf(refusal).code).toBe("engine_served");
  });

  it("a route whose model id is not confirmed is refused, because a run settles the account and the contract only", () => {
    const unconfirmed = editableDecisionRouteTable();
    hostedRouteOf(unconfirmed).model_id_status = "pending-provider-confirmation";

    let refusal: unknown;
    try {
      resolveProbeTarget(HOSTED_ROUTE, RUN_DATE, unconfirmed);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(DecisionCallError);
    expect(recordOf(refusal).code).toBe("route_not_admitted");
    expect(String(recordOf(refusal).reason)).toContain("model id unconfirmed");
  });
});

describe("an observation", () => {
  it("only the allow-listed response headers are recorded, by name and never by value", () => {
    const values = {
      "content-type": ["application/json", VENDOR_WORDS, "1"].join(";"),
      [VENDOR_REQUEST_ID_HEADER]: [VENDOR_WORDS, "2"].join("-"),
      "retry-after": [VENDOR_WORDS, "3"].join("-"),
      "retry-after-ms": [VENDOR_WORDS, "4"].join("-"),
      "x-ratelimit-limit-requests": [VENDOR_WORDS, "5"].join("-"),
      "X-RateLimit-Remaining-Tokens": [VENDOR_WORDS, "6"].join("-"),
      "set-cookie": [VENDOR_WORDS, "7"].join("-"),
      server: [VENDOR_WORDS, "8"].join("-"),
      date: [VENDOR_WORDS, "9"].join("-"),
      "x-request-cost": [VENDOR_WORDS, "10"].join("-"),
    };

    const observation = recordObservation({ status: OK, headers: new Headers(values), body: "{}" });

    expect(observation.headersPresent).toEqual([
      "content-type",
      "retry-after",
      "retry-after-ms",
      "x-ratelimit-limit-requests",
      "x-ratelimit-remaining-tokens",
      VENDOR_REQUEST_ID_HEADER,
    ]);
    expect(observation.headerNamesWithheld).toBe(0);
    expect(JSON.stringify(observation)).not.toContain(VENDOR_WORDS);
  });

  it("a rate-limit header whose name is not a plain name is counted and not written", () => {
    const long = `x-ratelimit-${"a".repeat(80)}`;
    const marked = "x-ratelimit-limit_requests!";

    const observation = recordObservation({
      status: OK,
      headers: new Headers({ [long]: "1", [marked]: "2", "x-ratelimit-reset": "3" }),
      body: "",
    });

    expect(observation.headersPresent).toEqual(["x-ratelimit-reset"]);
    expect(observation.headerNamesWithheld).toBe(2);
  });

  it("a body is sorted into a closed list of shapes and never quoted", () => {
    const cases: readonly (readonly [string, ProbeBodyShape])[] = [
      ["", "empty"],
      ["  \n", "empty"],
      ["<html>Bad Gateway</html>", "not_json"],
      ["[]", "other_json"],
      ['"text"', "other_json"],
      [JSON.stringify({ code: 7 }), "other_json"],
      [JSON.stringify({ detail: { code: 7 } }), "other_json"],
      [JSON.stringify({ detail: [] }), "other_json"],
      [JSON.stringify({ detail: { message: VENDOR_WORDS, hint: VENDOR_WORDS } }), "detail_message"],
      [JSON.stringify({ detail: { error_type: VENDOR_WORDS, message: VENDOR_WORDS }, extra: 1 }), "detail_message"],
      [JSON.stringify({ detail: { error_type: VENDOR_WORDS, message: VENDOR_WORDS, hint: 1 } }), "detail_message"],
      [JSON.stringify({ detail: { error_type: "", message: VENDOR_WORDS } }), "detail_message"],
      [JSON.stringify({ detail: { error_type: 7, message: VENDOR_WORDS } }), "detail_message"],
      [JSON.stringify({ detail: { error_type: VENDOR_WORDS, message: VENDOR_WORDS } }), "detail_error_type_message"],
      [JSON.stringify(fixtureBody("error.403-missing-key.observed.json", "observed-unauthenticated")), "detail_error_type_message"],
      [JSON.stringify(fixtureBody("error.405-method-not-allowed.observed.json", "observed-unauthenticated")), "detail_string"],
      [JSON.stringify(fixtureBody("error.401.unobserved.json", "synthetic-unobserved")), "detail_string"],
      [JSON.stringify(fixtureBody("error.422.unobserved.json", "synthetic-unobserved")), "detail_list_loc_msg"],
      [JSON.stringify(fixtureBody("error.429.unobserved.json", "synthetic-unobserved")), "error_message"],
      [JSON.stringify(fixtureBody("error.529.unobserved.json", "synthetic-unobserved")), "message"],
      [JSON.stringify(fixtureBody("error.500.unobserved.json", "synthetic-unobserved")), "error_string"],
      [JSON.stringify(fixtureBody("response.choice.documented.json", "documented-verbatim")), "answers"],
    ];

    for (const [body, shape] of cases) {
      const observation = recordObservation({ status: OK, headers: new Headers(), body });
      expect(observation.bodyShape).toBe(shape);
      expect(observation.bodyCharacters).toBe(body.length);
      expect(JSON.stringify(observation)).not.toContain(VENDOR_WORDS);
      expect(PROBE_BODY_SHAPES).toContain(observation.bodyShape);
    }

    const unread = recordObservation({ status: OK, headers: new Headers(), body: null });
    expect(unread.bodyShape).toBe("unreadable");
    expect(unread.bodyCharacters).toBeNull();
  });

  it("the shape named as the observed one is exactly the shape the transport reads an error type from", async () => {
    const route = resolveProbeTarget(HOSTED_ROUTE, RUN_DATE).resolved;
    const [choice] = buildProbePlan(route).requests;
    if (choice.expect !== "answer") {
      throw new Error("the plan's first request is not an answerable one");
    }
    const transport = (body: string, status: number) =>
      createSystemOneTransport({
        fetchImpl: () => Promise.resolve(reply(status, body)),
        now: () => RUN_STARTED_MS,
      }).execute({ route, body: choice.body, signal: new AbortController().signal });
    const fixtures: readonly (readonly [string, DecisionEvidenceClass])[] = [
      ["error.403-missing-key.observed.json", "observed-unauthenticated"],
      ["error.405-method-not-allowed.observed.json", "observed-unauthenticated"],
      ["error.401.unobserved.json", "synthetic-unobserved"],
      ["error.422.unobserved.json", "synthetic-unobserved"],
      ["error.429.unobserved.json", "synthetic-unobserved"],
      ["error.529.unobserved.json", "synthetic-unobserved"],
      ["error.500.unobserved.json", "synthetic-unobserved"],
    ];
    const observed = recordOf(fixtureBody("error.403-missing-key.observed.json", "observed-unauthenticated"));
    const detail = recordOf(observed.detail);
    const nearMisses: readonly unknown[] = [
      { ...observed, extra: 1 },
      { detail: { ...detail, hint: 1 } },
      { detail: { ...detail, error_type: "" } },
      { detail: { ...detail, error_type: 7 } },
      { detail: { error_type: detail.error_type } },
    ];
    const bodies: (readonly [string, number])[] = nearMisses.map((body) => [JSON.stringify(body), 403]);
    for (const [name, evidence] of fixtures) {
      const envelope = loadDecisionFixture(name, { allow: [evidence] }).envelope;
      bodies.push([JSON.stringify(envelope.body), envelope.status ?? 0]);
    }
    let readable = 0;

    for (const [body, status] of bodies) {
      const raised: unknown = await transport(body, status).then(
        () => null,
        (error: unknown) => error,
      );
      const readByTransport = recordOf(raised).vendorErrorType !== null;

      expect(describeProbeBody(body) === "detail_error_type_message").toBe(readByTransport);
      readable += readByTransport ? 1 : 0;
    }
    expect(readable).toBe(1);
  });
});

describe("a latency summary", () => {
  /**
   * The whole numbers from one to a count, shuffled by a fixed stride so the
   * summary is shown to sort them.
   *
   * @param count How many.
   * @returns The numbers one to `count`, out of order.
   */
  function durations(count: number): number[] {
    const stride = 7;
    return Array.from({ length: count }, (_, index) => ((index * stride) % count) + 1);
  }

  it("a percentile is stated only from a sample large enough to tell it from the largest value", () => {
    expect(summariseLatency(durations(1))).toEqual({ n: 1, min: 1, p50: null, p90: null, p95: null, p99: null, max: 1 });
    expect(summariseLatency(durations(2))).toEqual({ n: 2, min: 1, p50: 1, p90: null, p95: null, p99: null, max: 2 });
    expect(summariseLatency(durations(9))).toEqual({ n: 9, min: 1, p50: 5, p90: null, p95: null, p99: null, max: 9 });
    expect(summariseLatency(durations(10))).toEqual({ n: 10, min: 1, p50: 5, p90: 9, p95: null, p99: null, max: 10 });
    expect(summariseLatency(durations(19)).p95).toBeNull();
    expect(summariseLatency(durations(20))).toEqual({ n: 20, min: 1, p50: 10, p90: 18, p95: 19, p99: null, max: 20 });
    expect(summariseLatency(durations(99)).p99).toBeNull();
    expect(summariseLatency(durations(100))).toEqual({
      n: 100,
      min: 1,
      p50: 50,
      p90: 90,
      p95: 95,
      p99: 99,
      max: 100,
    });
  });

  it("no call has no latency, and never a latency of zero", () => {
    expect(summariseLatency([])).toEqual({ n: 0, min: null, p50: null, p90: null, p95: null, p99: null, max: null });
  });
});

describe("a run", () => {
  it("sends each planned request once, one at a time, to the route's own endpoint with its key", async () => {
    const double = vendor(answering());

    const report = await probe(double);

    expect(double.calls).toHaveLength(DEFAULT_PLAN_CALLS);
    expect(double.peakInFlight()).toBe(1);
    expect(double.calls.map((call) => shapeOfSent(call.body))).toEqual(["choice", "noul", "score", PROBE_REFUSAL_SHAPE]);
    for (const call of double.calls) {
      expect(call.url).toBe(`${DECLARED_BASE_URL}${SYSTEMONE_PATH}`);
      expect(call.method).toBe("POST");
      expect(call.redirect).toBe("error");
      expect(call.headers.authorization === `${BEARER}${SENTINEL_KEY}`).toBe(true);
      expect(recordOf(JSON.parse(call.body)).model).toBe(PIN);
    }
    expect(report.planned).toBe(DEFAULT_PLAN_CALLS);
    expect(report.dispatched).toBe(DEFAULT_PLAN_CALLS);
  });

  it("an observation holds no request header and no key", async () => {
    const double = vendor(answering());

    const report = await probe(double);
    const written = JSON.stringify(report);
    const shown = renderProbeSummary(report).join("\n");

    expect(double.calls.every((call) => call.headers.authorization === `${BEARER}${SENTINEL_KEY}`)).toBe(true);
    for (const text of [written, shown]) {
      expect(text.includes(SENTINEL_KEY)).toBe(false);
      expect(text.toLowerCase().includes("authorization")).toBe(false);
      expect(text.includes(BEARER.trim())).toBe(false);
    }
    for (const sample of report.samples) {
      expect(Object.keys(sample.observation ?? {}).sort()).toEqual([
        "bodyCharacters",
        "bodyShape",
        "headerNamesWithheld",
        "headersPresent",
        "status",
      ]);
    }
  });

  it("a contract the vendor honours is confirmed, with what was found about it", async () => {
    const report = await probe(vendor(answering()));

    expect(report.verdict).toBe("confirmed");
    expect(report.verdictReasons).toEqual([]);
    expect(report.stopped).toBeNull();
    expect(report.route).toBe(HOSTED_ROUTE);
    expect(report.provider).toBe(HOSTED.provider);
    expect(report.modelPin).toBe(PIN);
    expect(report.routeBudgetMs).toBe(HOSTED.budget_ms);
    expect(report.requestTimeoutMs).toBe(DECISION_BUDGET_CEILING_MS);
    expect(report.findings.servedModels).toEqual([PIN]);
    expect(report.findings.usageOnAnswers).toBe("always");
    expect(report.findings.requestIdOnAnswers).toBe("always");
    expect(report.findings.requestIdOnFailures).toBe("always");
    expect(report.findings.rateLimitHeaderNames).toEqual([]);
    expect(report.findings.refusal).toEqual({ outcome: "refused", status: 422, bodyShape: "detail_list_loc_msg" });

    const choice = sampleOf(report, "choice");
    expect(choice.outcome).toBe("answered");
    expect(choice.fault).toBeNull();
    expect(choice.status).toBe(OK);
    expect(choice.servedModel).toBe(PIN);
    expect(choice.servedModelMatchesPin).toBe(true);
    expect(choice.inputTokens).toBe(318);
    expect(choice.outputTokens).toBe(34);
    expect(choice.cost).toBeCloseTo(0.000013356, 12);
    expect(choice.probabilitySums).toEqual({ department: 0.88 + 0.12 + 0.0 });
    expect(sampleOf(report, "noul").probabilitySums).toEqual({ payment_failure: null });
    expect(sampleOf(report, "score").probabilitySums).toEqual({ urgency: 1 });

    const refused = sampleOf(report, PROBE_REFUSAL_SHAPE);
    expect(refused.outcome).toBe("refused");
    expect(refused.fault).toBe("schema");
    expect(refused.faultSource).toBe("vendor_rejected");
    expect(refused.status).toBe(422);
    expect(refused.probabilitySums).toBeNull();

    expect(report.shapes.choice.answered).toBe(1);
    expect(report.shapes.choice.inputTokens).toEqual([318]);
    expect(report.shapes.choice.distinctAnswers).toBe(1);
    expect(report.shapes.noul.largestSumDeviation).toBeNull();
    expect(report.shapes.score.largestSumDeviation).toBe(0);
  });

  it("the report is labelled as evidence about the vendor only when the calls went to the declared endpoint", async () => {
    const declared = await probe(vendor(answering()));
    expect(declared.endpoint).toBe("declared");
    expect(declared.evidence).toBe(PROBE_EVIDENCE_AUTHENTICATED);
    expect(declared.evidenceWithheld).toBeNull();
    expect(declared.observedOn).toBe(RUN_DATE);
    expect(declared.startedAt).toBe(new Date(RUN_STARTED_MS).toISOString());

    vi.stubEnv(BASE_URL_ENV, `http://${LOOPBACK_HOST}:9`);
    const double = vendor(answering());
    const overridden = await probe(double);

    expect(double.calls[0].url).toBe(`http://${LOOPBACK_HOST}:9${SYSTEMONE_PATH}`);
    expect(overridden.verdict).toBe("confirmed");
    expect(overridden.endpoint).toBe("environment_override");
    expect(overridden.evidence).toBeNull();
    expect(overridden.evidenceWithheld).toBe("base_url_overridden");
  });

  it("never dispatches faster than the refill rate the limits config declares for the provider", async () => {
    const interval = probeDispatchIntervalMs(HOSTED.provider, PIN);
    expect(interval).toBe(60_000 / limitsFor(HOSTED.provider, PIN).requests_per_minute);
    expect(VENDOR_LATENCY_MS).toBeLessThan(interval);

    const fast = fakeTime();
    const dispatchedAt: number[] = [];
    const quick = vendor((call, index) => {
      dispatchedAt.push(fast.nowMs());
      fast.advance(VENDOR_LATENCY_MS);
      return answering()(call, index);
    });
    const report = await probe(quick, {}, fast);

    expect(report.minDispatchIntervalMs).toBe(interval);
    expect(fast.waits).toEqual([interval - VENDOR_LATENCY_MS, interval - VENDOR_LATENCY_MS, interval - VENDOR_LATENCY_MS]);
    expect(dispatchedAt).toEqual([0, interval, 2 * interval, 3 * interval]);

    const slow = fakeTime();
    const patient = vendor((call, index) => {
      slow.advance(interval + VENDOR_LATENCY_MS);
      return answering()(call, index);
    });
    await probe(patient, {}, slow);

    expect(slow.waits).toEqual([]);
  });

  it("never comes near the vendor's published ceiling, whatever the limits config says and however fast the vendor answers", async () => {
    expect(PROBE_MIN_DISPATCH_SPACING_MS).toBe(100);
    expect(probeDispatchSpacingMs(1)).toBe(PROBE_MIN_DISPATCH_SPACING_MS);
    expect(probeDispatchSpacingMs(0)).toBe(PROBE_MIN_DISPATCH_SPACING_MS);
    expect(probeDispatchSpacingMs(PROBE_MIN_DISPATCH_SPACING_MS + 150)).toBe(PROBE_MIN_DISPATCH_SPACING_MS + 150);
    expect(probeDispatchIntervalMs(HOSTED.provider, PIN)).toBeGreaterThanOrEqual(PROBE_MIN_DISPATCH_SPACING_MS);

    const time = fakeTime();
    const dispatchedAt: number[] = [];
    const instant = vendor((call, index) => {
      dispatchedAt.push(time.nowMs());
      return answering()(call, index);
    });
    const samples = 20;
    await probe(instant, { samples }, time);

    expect(dispatchedAt).toHaveLength(samples * 3 + 1);
    const mostInOneSecond = Math.max(
      ...dispatchedAt.map((from) => dispatchedAt.filter((at) => at >= from && at < from + ONE_SECOND_MS).length),
    );
    expect(mostInOneSecond).toBe(ONE_SECOND_MS / PROBE_MIN_DISPATCH_SPACING_MS);
    expect(mostInOneSecond * 4).toBeLessThanOrEqual(PUBLISHED_REQUESTS_PER_SECOND);
    expect(instant.peakInFlight()).toBe(1);
  });

  it("a vendor that asks the run to wait is waited for, counted from when it answered and not from when it was asked", async () => {
    const interval = probeDispatchIntervalMs(HOSTED.provider, PIN);
    // Each form a hint is sent in, and the earliest instant it allows the next
    // call at: a delay runs from when the answer came back, 400 ms into the
    // run, and a time of day is that time of day.
    const hints: readonly (readonly [Readonly<Record<string, string>>, number])[] = [
      [{ "retry-after": "2" }, SLOW_REFUSAL_MS + 2_000],
      [{ "retry-after-ms": "1500" }, SLOW_REFUSAL_MS + 1_500],
      [{ "retry-after": new Date(RUN_STARTED_MS + 3_000).toUTCString() }, 3_000],
    ];
    for (const [headers, notBeforeMs] of hints) {
      const time = fakeTime();
      const dispatchedAt: number[] = [];
      const double = vendor((call, index) => {
        dispatchedAt.push(time.nowMs());
        if (index === 0) {
          time.advance(SLOW_REFUSAL_MS);
          return reply(TOO_MANY_REQUESTS, fixtureBody("error.429.unobserved.json", "synthetic-unobserved"), {
            ...VENDOR_HEADERS,
            ...headers,
          });
        }
        return answering()(call, index);
      });

      const report = await probe(double, { samples: 2, includeRefusal: false }, time);

      // The refused call took 400 ms to come back. The wait starts there, and
      // not at the dispatch, so it is never shorter than the vendor asked for.
      expect(dispatchedAt.slice(0, 3)).toEqual([0, notBeforeMs, notBeforeMs + interval]);
      expect(time.waits[0]).toBe(notBeforeMs - SLOW_REFUSAL_MS);
      expect(report.retryHints).toBe(1);
      expect(report.stopped).toBeNull();
      expect(report.dispatched).toBe(6);
      expect(report.verdictReasons).toEqual(["transport"]);
      // How long was asked for is the value of a header, and is not written.
      expect(Object.keys(report.samples[0])).not.toContain("retryAfterMs");
      expect(renderProbeSummary(report)).toContain("responses that asked the run to wait before calling again: 1");
    }
  });

  it("a vendor that keeps saying it is called too often ends the run after two such answers, and the verdict says so", async () => {
    expect(PROBE_CAPACITY_REFUSALS_BEFORE_STOP).toBe(2);
    const time = fakeTime();
    const dispatchedAt: number[] = [];
    const limiting = vendor(() => {
      dispatchedAt.push(time.nowMs());
      return reply(TOO_MANY_REQUESTS, fixtureBody("error.429.unobserved.json", "synthetic-unobserved"), {
        ...VENDOR_HEADERS,
        "retry-after": "30",
      });
    });

    const report = await probe(limiting, { samples: LONG_RUN_SAMPLES }, time);

    expect(report.planned).toBe(LONG_RUN_SAMPLES * 3 + 1);
    expect(limiting.calls).toHaveLength(PROBE_CAPACITY_REFUSALS_BEFORE_STOP);
    expect(dispatchedAt).toEqual([0, 30_000]);
    expect(time.waits).toEqual([30_000]);
    expect(report.dispatched).toBe(PROBE_CAPACITY_REFUSALS_BEFORE_STOP);
    expect(report.stopped).toBe("rate_limited");
    expect(report.retryHints).toBe(1);
    expect(report.verdict).toBe("not_confirmed");
    expect(report.verdictReasons).toEqual(["rate_limited", "stopped_early", "transport"]);
    expect(report.samples.map((sample) => sample.status)).toEqual([TOO_MANY_REQUESTS, TOO_MANY_REQUESTS]);
    const lines = renderProbeSummary(report);
    expect(lines).toContain(`calls: 2 of ${report.planned} planned; stopped early (rate_limited)`);
    expect(lines.at(-1)).toBe(
      "verdict: not confirmed (rate_limited, stopped_early, transport); the vendor rate-limited the run, " +
        `which stopped after 2 of ${report.planned} calls were sent`,
    );
    expect(JSON.stringify(report)).not.toContain("30000");
  });

  it("one answer that the vendor is called too often is observed and the run goes on, at its own spacing when no wait was asked for", async () => {
    const interval = probeDispatchIntervalMs(HOSTED.provider, PIN);
    const time = fakeTime();
    const dispatchedAt: number[] = [];
    const double = vendor((call, index) => {
      dispatchedAt.push(time.nowMs());
      return index === 1 ? reply(TOO_MANY_REQUESTS, "", VENDOR_HEADERS) : answering()(call, index);
    });

    const report = await probe(double, {}, time);

    expect(dispatchedAt).toEqual([0, interval, 2 * interval, 3 * interval]);
    expect(report.dispatched).toBe(DEFAULT_PLAN_CALLS);
    expect(report.stopped).toBeNull();
    expect(report.retryHints).toBe(0);
    expect(sampleOf(report, "noul").status).toBe(TOO_MANY_REQUESTS);
    expect(sampleOf(report, "noul").observation?.bodyShape).toBe("empty");
    expect(report.verdictReasons).toEqual(["transport"]);
  });

  it("a vendor that asks for a longer wait than a run will make ends the run at once, and is not called early", async () => {
    const time = fakeTime();
    const patient = vendor(() =>
      reply(TOO_MANY_REQUESTS, "", { ...VENDOR_HEADERS, "retry-after-ms": String(PROBE_LONGEST_HONOURED_WAIT_MS + 1) }),
    );

    const report = await probe(patient, { samples: LONG_RUN_SAMPLES }, time);

    expect(patient.calls).toHaveLength(1);
    expect(time.waits).toEqual([]);
    expect(report.stopped).toBe("rate_limited");
    expect(report.retryHints).toBe(1);
    expect(report.verdictReasons).toEqual(["rate_limited", "stopped_early", "transport"]);

    const atTheLimit = fakeTime();
    const justInside = vendor((call, index) =>
      index === 0
        ? reply(TOO_MANY_REQUESTS, "", { ...VENDOR_HEADERS, "retry-after-ms": String(PROBE_LONGEST_HONOURED_WAIT_MS) })
        : answering()(call, index),
    );
    const waited = await probe(justInside, {}, atTheLimit);
    expect(atTheLimit.waits[0]).toBe(PROBE_LONGEST_HONOURED_WAIT_MS);
    expect(waited.stopped).toBeNull();
    expect(waited.dispatched).toBe(DEFAULT_PLAN_CALLS);
  });

  it("a vendor that says twice it is full or not serving ends the run too, and one such answer does not", async () => {
    for (const status of [503, 529, 408]) {
      const full = vendor(() => reply(status, "", VENDOR_HEADERS));
      const report = await probe(full, { samples: LONG_RUN_SAMPLES });

      expect(full.calls).toHaveLength(PROBE_CAPACITY_REFUSALS_BEFORE_STOP);
      expect(report.stopped).toBe("vendor_unavailable");
      expect(report.verdictReasons).toEqual(["stopped_early", "transport", "vendor_unavailable"]);
      expect(renderProbeSummary(report).at(-1)).toContain(
        `the run stopped after 2 of ${report.planned} calls were sent`,
      );
    }

    const once = await probe(vendor(answering({ choice: () => reply(529, "", VENDOR_HEADERS) })));
    expect(once.stopped).toBeNull();
    expect(once.dispatched).toBe(DEFAULT_PLAN_CALLS);

    // A vendor that failed, as opposed to one that is full, is not a reason to stop.
    const failing = vendor(() => reply(500, "", VENDOR_HEADERS));
    const failed = await probe(failing);
    expect(failing.calls).toHaveLength(DEFAULT_PLAN_CALLS);
    expect(failed.stopped).toBeNull();
  });

  it("latency is reported per shape with its count and every duration, and identical requests are counted for identical answers", async () => {
    const samples = 3;
    // Time to the response's headers. Each body then takes a little longer to
    // arrive whole, and the second yes/no lands just past the route's budget.
    const justOverBudget = HOSTED.budget_ms + 1;
    const latencies: Readonly<Record<ProbeShape, readonly number[]>> = {
      choice: [300, 100, 1600],
      noul: [210, justOverBudget - BODY_READ_MS, 230],
      score: [150, 150, 150],
      [PROBE_REFUSAL_SHAPE]: [40],
    };
    const time = fakeTime();
    const documented = recordOf(fixtureBody("response.choice.documented.json", "documented-verbatim"));
    const shifted = {
      ...documented,
      answers: {
        department: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1, sales: 0.0 }, confidence: 0.85 },
      },
    };
    const timed = (shape: ProbeShape, answer: (nth: number) => ProbeFetchResponse) => (nth: number) => {
      time.advance(latencies[shape][nth]);
      const answered = answer(nth);
      return {
        status: answered.status,
        headers: answered.headers,
        text: (): Promise<string> => {
          time.advance(BODY_READ_MS);
          return answered.text();
        },
      };
    };
    const double = vendor(
      answering({
        choice: timed("choice", (nth) => (nth === 1 ? reply(OK, shifted, VENDOR_HEADERS) : CONTRACT_ANSWERS.choice())),
        noul: timed("noul", () => CONTRACT_ANSWERS.noul()),
        score: timed("score", () => CONTRACT_ANSWERS.score()),
        [PROBE_REFUSAL_SHAPE]: timed(PROBE_REFUSAL_SHAPE, () => CONTRACT_ANSWERS[PROBE_REFUSAL_SHAPE]()),
      }),
    );

    const report = await probe(double, { samples }, time);

    expect(report.samplesPerShape).toBe(samples);
    expect(report.dispatched).toBe(samples * 3 + 1);
    // A duration is the time to the whole body, not to the headers.
    expect(report.shapes.choice.durationsMs).toEqual([300 + BODY_READ_MS, 100 + BODY_READ_MS, 1600 + BODY_READ_MS]);
    expect(report.shapes.choice.latencyMs).toEqual({
      n: 3,
      min: 100 + BODY_READ_MS,
      p50: 300 + BODY_READ_MS,
      p90: null,
      p95: null,
      p99: null,
      max: 1600 + BODY_READ_MS,
    });
    expect(report.shapes.choice.latencyPopulation).toBe(PROBE_LATENCY_POPULATION);
    expect(report.shapes.choice.overRouteBudget).toBe(1);
    expect(report.shapes.choice.withinRouteBudget).toBe(2);
    expect(report.shapes.choice.routeBudgetUnknown).toBe(0);
    expect(report.shapes.choice.distinctAnswers).toBe(2);
    // One millisecond past the route's budget is past it.
    expect(report.shapes.noul.durationsMs).toEqual([210 + BODY_READ_MS, justOverBudget, 230 + BODY_READ_MS]);
    expect(report.shapes.noul.overRouteBudget).toBe(1);
    expect(report.shapes.score.overRouteBudget).toBe(0);
    expect(report.shapes.noul.distinctAnswers).toBe(1);
    expect(report.shapes.score.latencyMs.n).toBe(samples);
    expect(report.shapes.choice.largestSumDeviation).toBe(
      Math.max(Math.abs(0.88 + 0.12 + 0.0 - 1), Math.abs(0.9 + 0.1 + 0.0 - 1)),
    );
    expect(sampleOf(report, "choice").headersMs).toBe(300);
    expect(sampleOf(report, "choice").bodyMs).toBe(300 + BODY_READ_MS);
    expect(JSON.stringify(report)).not.toContain("0.85");
  });

  it("every call that outlasted the route's budget is counted over it, whatever it ended as, and a call that was not measured is counted as not measured", async () => {
    const budget = HOSTED.budget_ms;
    const requestTimeoutMs = 25;
    const time = fakeTime();
    /**
     * A call that never answers, on a clock moved to where the probe's own
     * deadline would be when it gives up.
     *
     * @param call The request.
     * @param headersAfterMs When its headers arrive, or `null` when none do.
     * @returns The response, or a promise that only the probe's deadline ends.
     */
    const neverWhole = (call: RecordedCall, headersAfterMs: number | null): Promise<ProbeFetchResponse> => {
      const ended = new Promise<never>((_resolve, reject) => {
        call.signal.addEventListener("abort", () => reject(call.signal.reason));
      });
      if (headersAfterMs === null) {
        time.advance(DECISION_BUDGET_CEILING_MS);
        return ended;
      }
      time.advance(headersAfterMs);
      return Promise.resolve({
        status: OK,
        headers: new Headers(VENDOR_HEADERS),
        text: (): Promise<string> => {
          time.advance(DECISION_BUDGET_CEILING_MS - headersAfterMs);
          return ended;
        },
      });
    };
    const slowFailure = (): ProbeFetchResponse => {
      time.advance(budget * 6);
      return reply(503, "", VENDOR_HEADERS);
    };
    const double = vendor(
      answering({
        // No response at all; headers and then no body; a failing status that
        // arrived whole, long after the budget; and an answer inside it.
        choice: (nth, call) =>
          [
            () => neverWhole(call, null),
            () => neverWhole(call, 5_000),
            () => slowFailure(),
            () => CONTRACT_ANSWERS.choice(),
          ][nth](),
        // A call that failed at once, before any response: nothing was measured.
        noul: (nth) => {
          if (nth === 0) {
            throw new TypeError("fetch failed");
          }
          return CONTRACT_ANSWERS.noul();
        },
      }),
    );

    const report = await probe(double, { samples: 4, includeRefusal: false, requestTimeoutMs }, time);

    const choice = report.shapes.choice;
    expect(choice.dispatched).toBe(4);
    expect(choice.answered).toBe(1);
    expect(choice.faults).toEqual({ timeout: 2, transport: 1 });
    expect(choice.overRouteBudget).toBe(3);
    expect(choice.withinRouteBudget).toBe(1);
    expect(choice.routeBudgetUnknown).toBe(0);
    // The latency summary is of whole answers only, and says how many that is.
    expect(choice.latencyMs.n).toBe(1);
    expect(choice.latencyPopulation).toBe("success_status_whole_body");
    expect(choice.durationsMs).toEqual([0]);
    const [silent, cutShort, lateFailure] = report.samples.filter((sample) => sample.shape === "choice");
    expect(silent).toMatchObject({ status: null, bodyMs: null, settledMs: DECISION_BUDGET_CEILING_MS, fault: "timeout" });
    expect(cutShort).toMatchObject({ status: OK, headersMs: 5_000, bodyMs: null, settledMs: DECISION_BUDGET_CEILING_MS });
    expect(lateFailure).toMatchObject({ status: 503, bodyMs: budget * 6, fault: "transport" });

    const noul = report.shapes.noul;
    expect(noul.dispatched).toBe(4);
    expect(noul.overRouteBudget).toBe(0);
    expect(noul.routeBudgetUnknown).toBe(1);
    expect(noul.withinRouteBudget).toBe(3);
    expect(noul.overRouteBudget + noul.withinRouteBudget + noul.routeBudgetUnknown).toBe(noul.dispatched);

    const lines = renderProbeSummary(report);
    expect(lines.find((line) => line.startsWith("choice:"))).toContain(
      "latency ms over the n=1 of 4 that drew a success status and a whole body: min 0, ",
    );
    expect(lines.find((line) => line.startsWith("choice:"))).toContain(
      `of 4 made, whatever they ended as: 3 over the route's ${budget} ms budget, 1 within it, 0 not measured against it`,
    );
    expect(lines.find((line) => line.startsWith("noul:"))).toContain(
      `of 4 made, whatever they ended as: 0 over the route's ${budget} ms budget, 3 within it, 1 not measured against it`,
    );
  });

  it("an answering model other than the pin fails the run, decided on the whole id and before the body is trusted", async () => {
    const documented = recordOf(fixtureBody("response.choice.documented.json", "documented-verbatim"));
    const report = await probe(
      vendor(
        answering({
          choice: () => reply(OK, { ...documented, model: SUBSTITUTED_MODEL }, VENDOR_HEADERS),
          noul: () => reply(OK, { model: `${PIN}-20260917`, answers: VENDOR_WORDS }, VENDOR_HEADERS),
        }),
      ),
    );

    // The pin in another case is another id: the comparison is exact.
    expect(PIN.toUpperCase()).not.toBe(PIN);
    const scored = recordOf(fixtureBody("response.score.constructed.json", "constructed-from-documented-fields"));
    const inAnotherCase = await probe(
      vendor(answering({ score: () => reply(OK, { ...scored, model: PIN.toUpperCase() }, VENDOR_HEADERS) })),
    );
    expect(sampleOf(inAnotherCase, "score").fault).toBe("route_mismatch");
    expect(sampleOf(inAnotherCase, "score").servedModelMatchesPin).toBe(false);
    expect(inAnotherCase.verdictReasons).toEqual(["route_mismatch"]);

    expect(report.verdict).toBe("not_confirmed");
    expect(report.verdictReasons).toEqual(["route_mismatch"]);
    expect(renderProbeSummary(report).at(-1)).toBe(
      "verdict: not confirmed (route_mismatch); 2 call(s) were answered by a model other than the pin " +
        `${PIN}: ${[SUBSTITUTED_MODEL, `${PIN}-20260917`].sort().join(", ")}`,
    );
    const choice = sampleOf(report, "choice");
    expect(choice.outcome).toBe("fault");
    expect(choice.fault).toBe("route_mismatch");
    expect(choice.servedModel).toBe(SUBSTITUTED_MODEL);
    expect(choice.servedModelMatchesPin).toBe(false);
    expect(choice.probabilitySums).toBeNull();
    expect(choice.inputTokens).toBe(318);
    const noul = sampleOf(report, "noul");
    expect(noul.fault).toBe("route_mismatch");
    expect(noul.servedModel).toBe(`${PIN}-20260917`);
    expect(sampleOf(report, "score").outcome).toBe("answered");
    expect(report.findings.servedModels).toEqual([SUBSTITUTED_MODEL, PIN, `${PIN}-20260917`].sort());
    expect(report.shapes.choice.faults).toEqual({ route_mismatch: 1 });
  });

  it("a success that does not decode fails the run, and says where in the request's own names", async () => {
    const documented = recordOf(fixtureBody("response.choice.documented.json", "documented-verbatim"));
    const missingAnOption = {
      ...documented,
      answers: { department: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1 }, confidence: 0.8 } },
    };
    const missing = await probe(vendor(answering({ choice: () => reply(OK, missingAnOption, VENDOR_HEADERS) })));

    expect(missing.verdict).toBe("not_confirmed");
    expect(missing.verdictReasons).toEqual(["schema"]);
    const undecoded = sampleOf(missing, "choice");
    expect(undecoded.outcome).toBe("fault");
    expect(undecoded.fault).toBe("schema");
    expect(undecoded.faultFieldPath).toBe("answers.department.probabilities.sales");
    expect(undecoded.faultFieldPathWithheld).toBe(false);
    expect(undecoded.servedModelMatchesPin).toBe(true);
    expect(undecoded.inputTokens).toBe(318);

    const anOptionOfItsOwn = {
      ...documented,
      answers: {
        department: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.9, technical: 0.1, sales: 0, [VENDOR_WORDS]: 0 },
          confidence: 0.8,
        },
      },
    };
    const invented = await probe(vendor(answering({ choice: () => reply(OK, anOptionOfItsOwn, VENDOR_HEADERS) })));

    const quoted = sampleOf(invented, "choice");
    expect(quoted.fault).toBe("schema");
    expect(quoted.faultFieldPath).toBe("answers.department.probabilities");
    expect(quoted.faultFieldPathWithheld).toBe(true);
    expect(JSON.stringify(invented)).not.toContain(VENDOR_WORDS);
    expect(renderProbeSummary(invented).join("\n")).not.toContain(VENDOR_WORDS);

    const notJson = await probe(vendor(answering({ score: () => reply(OK, "<html>", VENDOR_HEADERS) })));
    const unparsed = sampleOf(notJson, "score");
    expect(unparsed.fault).toBe("schema");
    expect(unparsed.faultFieldPath).toBe("$");
    expect(unparsed.observation?.bodyShape).toBe("not_json");
  });

  it("nothing a vendor wrote reaches the report but a model id of a plain form", async () => {
    const loud: Readonly<Record<string, string>> = {
      "content-type": VENDOR_WORDS,
      [VENDOR_REQUEST_ID_HEADER]: VENDOR_WORDS,
      "retry-after": VENDOR_WORDS,
      "x-ratelimit-limit-requests": VENDOR_WORDS,
      "x-other": VENDOR_WORDS,
    };
    const report = await probe(
      vendor(
        answering({
          choice: () => reply(500, { error: VENDOR_WORDS }, loud),
          noul: () => reply(OK, { model: `not an id ${VENDOR_WORDS}`, answers: {} }, loud),
          score: () => reply(429, { error: { message: VENDOR_WORDS } }, loud),
          [PROBE_REFUSAL_SHAPE]: () => reply(422, { detail: [{ loc: [VENDOR_WORDS], msg: VENDOR_WORDS }] }, loud),
        }),
      ),
    );
    const written = JSON.stringify(report);

    expect(written).not.toContain(VENDOR_WORDS);
    expect(renderProbeSummary(report).join("\n")).not.toContain(VENDOR_WORDS);
    expect(report.findings.rateLimitHeaderNames).toEqual(["x-ratelimit-limit-requests"]);
    expect(sampleOf(report, "choice").fault).toBe("transport");
    expect(sampleOf(report, "choice").faultSource).toBe("status");
    expect(sampleOf(report, "choice").observation?.bodyShape).toBe("error_string");
    expect(sampleOf(report, "choice").bodyMs).toBe(0);
    expect(report.shapes.choice.latencyMs.n).toBe(0);
    expect(sampleOf(report, "score").observation?.bodyShape).toBe("error_message");
    expect(sampleOf(report, "score").observation?.headersPresent).toEqual([
      "content-type",
      "retry-after",
      "x-ratelimit-limit-requests",
      VENDOR_REQUEST_ID_HEADER,
    ]);
    const unnamed = sampleOf(report, "noul");
    expect(unnamed.fault).toBe("route_mismatch");
    expect(unnamed.servedModel).toBeNull();
    expect(unnamed.servedModelWithheld).toBe(true);
    expect(report.verdictReasons).toEqual(["route_mismatch", "transport"]);
  });

  it("a rejected key stops the run at once, and the report is not evidence of an authenticated call", async () => {
    const rejected = loadDecisionFixture("error.403-missing-key.observed.json", {
      allow: ["observed-unauthenticated"],
    }).envelope;
    const double = vendor(() => reply(rejected.status ?? 0, rejected.body, rejected.headers));

    const report = await probe(double);

    expect(double.calls).toHaveLength(1);
    expect(report.dispatched).toBe(1);
    expect(report.stopped).toBe("credential");
    expect(report.verdict).toBe("not_confirmed");
    expect(report.verdictReasons).toEqual(["credential", "stopped_early"]);
    expect(report.evidence).toBeNull();
    expect(report.evidenceWithheld).toBe("no_authenticated_answer");
    expect(report.samples[0].faultSource).toBe("vendor_rejected");
    expect(report.samples[0].observation?.bodyShape).toBe("detail_error_type_message");
    expect(report.findings.requestIdOnFailures).toBe("always");
    expect(report.findings.usageOnAnswers).toBeNull();
    expect(JSON.stringify(report)).not.toContain(rejected.headers?.[VENDOR_REQUEST_ID_HEADER] ?? REQUEST_ID);
  });

  it("a call that outlives the probe's own deadline is a timeout with its signal aborted, and the run goes on", async () => {
    const requestTimeoutMs = 25;
    let abandoned: AbortSignal | null = null;
    const double = vendor(
      answering({
        choice: (_nth, call) => {
          abandoned = call.signal;
          return new Promise<ProbeFetchResponse>((_resolve, reject) => {
            call.signal.addEventListener("abort", () => reject(call.signal.reason));
          });
        },
      }),
    );

    const report = await probe(double, { requestTimeoutMs, includeRefusal: false });

    const hung = sampleOf(report, "choice");
    expect(hung.outcome).toBe("fault");
    expect(hung.fault).toBe("timeout");
    expect(hung.faultSource).toBe("probe_deadline");
    expect(hung.status).toBeNull();
    expect(hung.observation).toBeNull();
    expect(hung.bodyMs).toBeNull();
    expect((abandoned as AbortSignal | null)?.aborted).toBe(true);
    expect(double.calls).toHaveLength(3);
    expect(report.requestTimeoutMs).toBe(requestTimeoutMs);
    expect(report.verdictReasons).toEqual(["timeout"]);
    expect(report.shapes.choice.latencyMs.n).toBe(0);
    expect(report.shapes.choice.latencyMs.max).toBeNull();
    expect(report.shapes.noul.answered).toBe(1);
  });

  it("a body that cannot be read is recorded as unreadable, and the status still decides the fault", async () => {
    const unreadable = (status: number): ProbeFetchResponse => ({
      status,
      headers: new Headers(VENDOR_HEADERS),
      text: () => Promise.reject(new Error(`the body was cut short ${VENDOR_WORDS}`)),
    });
    const report = await probe(
      vendor(answering({ choice: () => unreadable(OK), noul: () => unreadable(503) })),
      { includeRefusal: false },
    );

    const cut = sampleOf(report, "choice");
    expect(cut.fault).toBe("transport");
    expect(cut.faultSource).toBe("network");
    expect(cut.status).toBe(OK);
    expect(cut.bodyMs).toBeNull();
    expect(cut.headersMs).toBe(0);
    expect(cut.observation).toEqual({
      status: OK,
      headersPresent: ["content-type", VENDOR_REQUEST_ID_HEADER],
      headerNamesWithheld: 0,
      bodyShape: "unreadable",
      bodyCharacters: null,
    });
    const refusedService = sampleOf(report, "noul");
    expect(refusedService.fault).toBe("transport");
    expect(refusedService.faultSource).toBe("status");
    expect(refusedService.status).toBe(503);
    expect(refusedService.observation?.bodyShape).toBe("unreadable");
    expect(report.shapes.choice.latencyMs.n).toBe(0);
    expect(report.shapes.choice.durationsMs).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(VENDOR_WORDS);
  });

  it("a model other than the pin answering the request with no instructions fails the run like any other", async () => {
    const documented = recordOf(fixtureBody("response.choice.documented.json", "documented-verbatim"));
    const report = await probe(
      vendor(
        answering({
          [PROBE_REFUSAL_SHAPE]: () => reply(OK, { ...documented, model: SUBSTITUTED_MODEL }, VENDOR_HEADERS),
        }),
      ),
    );

    // Every answerable call was answered by the pin and decoded.
    expect(report.shapes.choice.answered + report.shapes.noul.answered + report.shapes.score.answered).toBe(3);
    const last = sampleOf(report, PROBE_REFUSAL_SHAPE);
    expect(last.status).toBe(OK);
    expect(last.fault).toBe("route_mismatch");
    expect(last.servedModel).toBe(SUBSTITUTED_MODEL);
    expect(report.findings.servedModels).toEqual([SUBSTITUTED_MODEL, PIN].sort());
    expect(report.verdict).toBe("not_confirmed");
    expect(report.verdictReasons).toEqual(["route_mismatch"]);
    expect(renderProbeSummary(report).at(-1)).toBe(
      "verdict: not confirmed (route_mismatch); 1 call(s) were answered by a model other than the pin " +
        `${PIN}: ${SUBSTITUTED_MODEL}`,
    );

    const unnamed = await probe(
      vendor(
        answering({
          [PROBE_REFUSAL_SHAPE]: () => reply(OK, { ...documented, model: `${PIN} ` }, VENDOR_HEADERS),
        }),
      ),
    );
    expect(unnamed.verdict).toBe("not_confirmed");
    expect(renderProbeSummary(unnamed).at(-1)).toContain(`other than the pin ${PIN}: a model whose id is not written`);
  });

  it("what the request with no instructions drew is a finding, and does not decide the verdict unless another model answered it", async () => {
    const accepted = await probe(vendor(answering({ [PROBE_REFUSAL_SHAPE]: () => CONTRACT_ANSWERS.choice() })));
    expect(accepted.verdict).toBe("confirmed");
    expect(accepted.findings.refusal).toEqual({ outcome: "answered", status: OK, bodyShape: "answers" });

    const otherwise = await probe(
      vendor(answering({ [PROBE_REFUSAL_SHAPE]: () => reply(400, { detail: "Bad Request" }, VENDOR_HEADERS) })),
    );
    expect(otherwise.verdict).toBe("confirmed");
    expect(otherwise.findings.refusal).toEqual({ outcome: "fault", status: 400, bodyShape: "detail_string" });
    expect(sampleOf(otherwise, PROBE_REFUSAL_SHAPE).fault).toBe("transport");

    const omitted = await probe(vendor(answering()), { includeRefusal: false });
    expect(omitted.findings.refusal).toBeNull();
    expect(omitted.verdict).toBe("confirmed");
    expect(renderProbeSummary(omitted)).toContain("request with no instructions: not sent");
  });

  it("the summary an operator reads says what the contract's open questions ask", async () => {
    const lines = renderProbeSummary(await probe(vendor(answering())));
    const text = lines.join("\n");

    expect(text).toContain(`answering models: ${PIN}`);
    expect(text).toContain("usage reported on answers: always");
    expect(text).toContain("request id on answers: always; on failures: always");
    expect(text).toContain("call 0 (choice): probabilities of department sum to 1");
    expect(text).toContain("call 2 (score): probabilities of urgency sum to 1");
    expect(text).toContain("request with no instructions: refused, HTTP 422, body shape detail_list_loc_msg");
    expect(text).toContain(
      "latency ms over the n=1 of 1 that drew a success status and a whole body: min 0, p50 not measured",
    );
    expect(text).toContain(
      `of 1 made, whatever they ended as: 0 over the route's ${HOSTED.budget_ms} ms budget, 1 within it, 0 not measured against it`,
    );
    expect(text).not.toContain("asked the run to wait");
    expect(text).toContain(`evidence: ${PROBE_EVIDENCE_AUTHENTICATED}, ${RUN_DATE}`);
    expect(lines.at(-1)).toBe("verdict: confirmed");
  });
});

describe("the command", () => {
  it("a dry run performs no request", async () => {
    const double = vendor(answering());
    const harness = cliHarness(double);

    const status = await runProbeCli([], harness.deps);

    expect(status).toBe(PROBE_EXIT_OK);
    expect(double.calls).toHaveLength(0);
    expect(harness.written).toEqual([]);
    expect(harness.prepared).toEqual([]);
    expect(harness.warned).toEqual([]);
    const text = harness.printed.join("\n");
    expect(text).toContain("a dry run, nothing is sent");
    expect(text).toContain(`route ${HOSTED_ROUTE}: provider ${HOSTED.provider}, model pin ${PIN}, endpoint declared`);
    expect(text).toContain(`key variable ${KEY_ENV} (set)`);
    expect(text).toContain(`${DEFAULT_PLAN_CALLS} calls`);
    expect(text).toContain(
      `--execute --route ${HOSTED_ROUTE} --acknowledge-real-calls ${DEFAULT_PLAN_CALLS} --out <dir>`,
    );
    expect(text).not.toContain(LOCAL_ROUTE);
    expect(text.includes(SENTINEL_KEY)).toBe(false);
    expect(harness.printed.filter((line) => /^ {2}request \d/.test(line))).toHaveLength(DEFAULT_PLAN_CALLS);

    const explicit = cliHarness(double);
    expect(await runProbeCli(["--dry-run", "--route", HOSTED_ROUTE, "--samples", "20"], explicit.deps)).toBe(PROBE_EXIT_OK);
    expect(double.calls).toHaveLength(0);
    expect(explicit.printed.join("\n")).toContain(
      `--execute --route ${HOSTED_ROUTE} --samples 20 --acknowledge-real-calls 61 --out <dir>`,
    );
  });

  it("execute without the key variable refuses before any request", async () => {
    for (const unset of ["", "   "]) {
      vi.stubEnv(KEY_ENV, unset);
      const double = vendor(answering());
      const harness = cliHarness(double);

      const status = await runProbeCli(EXECUTE_ARGS, harness.deps);

      expect(status).toBe(PROBE_EXIT_REFUSED);
      expect(double.calls).toHaveLength(0);
      expect(harness.written).toEqual([]);
      expect(harness.prepared).toEqual([]);
      expect(harness.warned.join("\n")).toContain(`${KEY_ENV} is unset`);
    }
  });

  it("execute with a key that cannot be sent refuses before any request, and writes no report", async () => {
    for (const unsendable of ["dk-probe-clé", "dk probe", "dk-probe-\u0007"]) {
      vi.stubEnv(KEY_ENV, unsendable);
      const double = vendor(answering());
      const harness = cliHarness(double);

      const status = await runProbeCli(EXECUTE_ARGS, harness.deps);

      expect(status).toBe(PROBE_EXIT_REFUSED);
      expect(double.calls).toHaveLength(0);
      expect(harness.written).toEqual([]);
      expect(harness.prepared).toEqual([]);
      expect(harness.warned.join("\n")).toContain(`${KEY_ENV} holds a value that cannot be sent as a key`);
      expect(harness.warned.join("\n").includes(unsendable)).toBe(false);
    }
  });

  it("execute refuses, before any request, a run that does not name its route, repeat its count and name where it writes", async () => {
    const refusals: readonly (readonly [readonly string[], string])[] = [
      [["--execute", "--acknowledge-real-calls", "4", "--out", "probe-out"], "needs --route"],
      [["--execute", "--route", HOSTED_ROUTE, "--out", "probe-out"], "add --acknowledge-real-calls 4"],
      [["--execute", "--route", HOSTED_ROUTE, "--acknowledge-real-calls", "3", "--out", "probe-out"], "(3 was given)"],
      [
        ["--execute", "--route", HOSTED_ROUTE, "--samples", "2", "--acknowledge-real-calls", "4", "--out", "probe-out"],
        "would make 7 real, billed calls",
      ],
      [["--execute", "--route", HOSTED_ROUTE, "--acknowledge-real-calls", "4"], "needs --out"],
      [["--execute", "--route", LOCAL_ROUTE, "--acknowledge-real-calls", "4", "--out", "probe-out"], "engine_served"],
      [["--execute", "--dry-run", "--route", HOSTED_ROUTE], "both given"],
      [["--execute", "--route", HOSTED_ROUTE, "--samples", "101", "--acknowledge-real-calls", "304", "--out", "o"], "--samples"],
      [["--execute", "--route", "dm.baseline", "--acknowledge-real-calls", "4", "--out", "probe-out"], "--route takes one of"],
      [["--execute", "--route", HOSTED_ROUTE, "--acknowledge-real-calls", "four", "--out", "probe-out"], "whole number"],
      [["--execute", "--route", HOSTED_ROUTE, "--acknowledge-real-calls", "4", "--out"], "--out takes a value"],
      [["--execute", "--route", HOSTED_ROUTE, "--yes"], "--yes is not an argument"],
    ];

    for (const [argv, reason] of refusals) {
      const double = vendor(answering());
      const harness = cliHarness(double);

      const status = await runProbeCli(argv, harness.deps);

      expect(status).toBe(PROBE_EXIT_REFUSED);
      expect(double.calls).toHaveLength(0);
      expect(harness.written).toEqual([]);
      expect(harness.warned.join("\n")).toContain(reason);
    }
  });

  it("a directory that cannot be written to is refused before any request", async () => {
    const double = vendor(answering());
    const harness = cliHarness(double);
    const deps: ProbeCliDeps = {
      ...harness.deps,
      prepareOut: () => {
        throw Object.assign(new Error("permission denied, mkdir '/secret/path'"), { code: "EACCES" });
      },
    };

    const status = await runProbeCli(EXECUTE_ARGS, deps);

    expect(status).toBe(PROBE_EXIT_REFUSED);
    expect(double.calls).toHaveLength(0);
    expect(harness.warned.join("\n")).toContain("cannot be created or written to (EACCES); no call was made");
    expect(harness.warned.join("\n")).not.toContain("/secret/path");
  });

  it("the arguments are read exactly, and no arguments mean a dry run", () => {
    expect(parseProbeArguments([])).toEqual({
      mode: "dry-run",
      route: null,
      samples: 1,
      includeRefusal: true,
      acknowledgedCalls: null,
      out: null,
    });
    expect(parseProbeArguments([...EXECUTE_ARGS, "--samples", "20", "--omit-invalid-request"])).toEqual({
      mode: "execute",
      route: HOSTED_ROUTE,
      samples: 20,
      includeRefusal: false,
      acknowledgedCalls: DEFAULT_PLAN_CALLS,
      out: "probe-out",
    });
    expect(parseProbeArguments(["--help"]).mode).toBe("help");
  });

  it("execute writes one report, labelled, and prints what it found", async () => {
    const double = vendor(answering());
    const harness = cliHarness(double);

    const status = await runProbeCli(EXECUTE_ARGS, harness.deps);

    expect(status).toBe(PROBE_EXIT_OK);
    expect(double.calls).toHaveLength(DEFAULT_PLAN_CALLS);
    expect(harness.prepared).toEqual(["probe-out"]);
    expect(harness.written).toHaveLength(1);
    const [{ dir, fileName, text }] = harness.written;
    expect(dir).toBe("probe-out");
    expect(fileName).toBe(`decision-probe.${HOSTED_ROUTE}.20261002T143000Z.json`);
    const report = recordOf(JSON.parse(text));
    expect(report.tool).toBe("probe-decision-contract");
    expect(report.schemaVersion).toBe(1);
    expect(report.evidence).toBe(PROBE_EVIDENCE_AUTHENTICATED);
    expect(report.observedOn).toBe(RUN_DATE);
    expect(report.verdict).toBe("confirmed");
    expect(text.includes(SENTINEL_KEY)).toBe(false);
    expect(text).not.toContain(REQUEST_ID);
    expect(text).not.toContain("Payments, invoicing, refunds");
    expect(text).not.toContain("Field required");
    expect(harness.printed).toContain("verdict: confirmed");
    expect(harness.printed.at(-1)).toBe(`report: ${join("probe-out", fileName)}`);
    expect(harness.printed.join("\n").includes(SENTINEL_KEY)).toBe(false);
    expect(harness.warned).toEqual([]);
  });

  it("a run that does not confirm the contract still writes its report, and exits non-zero", async () => {
    const documented = recordOf(fixtureBody("response.choice.documented.json", "documented-verbatim"));
    const double = vendor(answering({ choice: () => reply(OK, { ...documented, model: SUBSTITUTED_MODEL }, VENDOR_HEADERS) }));
    const harness = cliHarness(double);

    const status = await runProbeCli(EXECUTE_ARGS, harness.deps);

    expect(status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(harness.written).toHaveLength(1);
    expect(recordOf(JSON.parse(harness.written[0].text)).verdict).toBe("not_confirmed");
    expect(harness.printed).toContain(
      "verdict: not confirmed (route_mismatch); 1 call(s) were answered by a model other than the pin " +
        `${PIN}: ${SUBSTITUTED_MODEL}`,
    );
  });

  it("exits non-zero when another model answers only the request with no instructions", async () => {
    const documented = recordOf(fixtureBody("response.choice.documented.json", "documented-verbatim"));
    const double = vendor(
      answering({
        [PROBE_REFUSAL_SHAPE]: () => reply(OK, { ...documented, model: SUBSTITUTED_MODEL }, VENDOR_HEADERS),
      }),
    );
    const harness = cliHarness(double);

    const status = await runProbeCli(EXECUTE_ARGS, harness.deps);

    expect(status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(double.calls).toHaveLength(DEFAULT_PLAN_CALLS);
    expect(recordOf(JSON.parse(harness.written[0].text)).verdictReasons).toEqual(["route_mismatch"]);
    expect(harness.printed.find((line) => line.startsWith("verdict:"))).toContain(SUBSTITUTED_MODEL);
  });

  it("a run the vendor rate limits exits non-zero, having sent two calls of the many it planned", async () => {
    const double = vendor(() =>
      reply(TOO_MANY_REQUESTS, fixtureBody("error.429.unobserved.json", "synthetic-unobserved"), {
        ...VENDOR_HEADERS,
        "retry-after": "30",
      }),
    );
    const harness = cliHarness(double);
    const planned = LONG_RUN_SAMPLES * 3 + 1;

    const status = await runProbeCli(
      ["--execute", "--route", HOSTED_ROUTE, "--samples", String(LONG_RUN_SAMPLES), "--acknowledge-real-calls", String(planned), "--out", "probe-out"],
      harness.deps,
    );

    expect(status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(double.calls).toHaveLength(PROBE_CAPACITY_REFUSALS_BEFORE_STOP);
    const report = recordOf(JSON.parse(harness.written[0].text));
    expect(report.stopped).toBe("rate_limited");
    expect(report.dispatched).toBe(PROBE_CAPACITY_REFUSALS_BEFORE_STOP);
    expect(harness.printed.find((line) => line.startsWith("verdict:"))).toContain(
      `the vendor rate-limited the run, which stopped after 2 of ${planned} calls were sent`,
    );
  });

  it("a vendor that repeats the key back is not written down or printed", async () => {
    const documented = recordOf(fixtureBody("response.choice.documented.json", "documented-verbatim"));
    const double = vendor(answering({ choice: () => reply(OK, { ...documented, model: SENTINEL_KEY }, VENDOR_HEADERS) }));
    const harness = cliHarness(double);

    const status = await runProbeCli(EXECUTE_ARGS, harness.deps);

    expect(status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(double.calls).toHaveLength(DEFAULT_PLAN_CALLS);
    expect(harness.written).toEqual([]);
    expect(harness.printed).toEqual([]);
    expect(harness.warned).toHaveLength(1);
    expect(harness.warned[0]).toContain(`repeated the credential held in ${KEY_ENV}`);
    expect(harness.warned[0].includes(SENTINEL_KEY)).toBe(false);
  });

  it("the key is recognised as it is, as a JSON string writes it, and in the lower case a header's name arrives in", () => {
    expect(probeTextCarriesKey(`a model named ${SENTINEL_KEY}`, SENTINEL_KEY)).toBe(true);
    expect(probeTextCarriesKey(JSON.stringify({ servedModel: ESCAPED_KEY }), ESCAPED_KEY)).toBe(true);
    expect(JSON.stringify({ servedModel: ESCAPED_KEY }).includes(ESCAPED_KEY)).toBe(false);
    expect(probeTextCarriesKey(JSON.stringify({ servedModel: PIN }), SENTINEL_KEY)).toBe(false);

    const observation = recordObservation({
      status: OK,
      headers: new Headers({ [`X-RateLimit-${MIXED_CASE_KEY}`]: "1" }),
      body: "",
    });
    expect(observation.headersPresent).toEqual([`x-ratelimit-${MIXED_CASE_KEY.toLowerCase()}`]);
    expect(JSON.stringify(observation).includes(MIXED_CASE_KEY)).toBe(false);
    expect(probeTextCarriesKey(JSON.stringify(observation), MIXED_CASE_KEY)).toBe(true);
  });

  it("a vendor that repeats the key back in a header's name is not written down either", async () => {
    vi.stubEnv(KEY_ENV, MIXED_CASE_KEY);
    const double = vendor(
      answering({
        score: () =>
          reply(OK, fixtureBody("response.score.constructed.json", "constructed-from-documented-fields"), {
            ...VENDOR_HEADERS,
            [`X-RateLimit-${MIXED_CASE_KEY}`]: "1",
          }),
      }),
    );
    const harness = cliHarness(double);

    const status = await runProbeCli(EXECUTE_ARGS, harness.deps);

    expect(double.calls.every((call) => call.headers.authorization === `${BEARER}${MIXED_CASE_KEY}`)).toBe(true);
    expect(status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(harness.written).toEqual([]);
    expect(harness.printed).toEqual([]);
    expect(harness.warned).toHaveLength(1);
    expect(harness.warned[0].toLowerCase().includes(MIXED_CASE_KEY.toLowerCase())).toBe(false);
  });

  it("a failure the command did not foresee is reported by class, and by message only when the message holds no key", async () => {
    const failing = (message: string): ProbeCliDeps => {
      const harness = cliHarness(vendor(answering()));
      return {
        ...harness.deps,
        clock: {
          ...harness.deps.clock,
          wait: () => Promise.reject(new RangeError(message)),
        },
      };
    };
    const warnedBy = async (message: string): Promise<{ status: number; warned: string[] }> => {
      const warned: string[] = [];
      const status = await runProbeCli(EXECUTE_ARGS, { ...failing(message), warn: (line) => warned.push(line) });
      return { status, warned };
    };

    const plain = await warnedBy("the clock stopped");
    expect(plain.status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(plain.warned).toEqual(["the probe failed: RangeError: the clock stopped"]);

    const quoting = await warnedBy(`could not send ${BEARER}${SENTINEL_KEY}`);
    expect(quoting.status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(quoting.warned).toEqual(["the probe failed: RangeError"]);
  });

  it("the system's own file writes make the directory and never replace a report that is already there", () => {
    const root = mkdtempSync(join(tmpdir(), "decision-probe-"));
    temporaryDirs.push(root);
    const out = join(root, "reports", "first");
    const { prepareOut, writeReport } = systemProbeCliDeps();

    prepareOut(out);
    const path = writeReport(out, "report.json", "first\n");

    expect(path).toBe(join(out, "report.json"));
    expect(readFileSync(path, "utf8")).toBe("first\n");
    expect(() => writeReport(out, "report.json", "second\n")).toThrow(/EEXIST/);
    expect(readFileSync(path, "utf8")).toBe("first\n");
  });

  it("a report that cannot be written is printed whole, so the calls are not lost, and the exit is non-zero", async () => {
    const double = vendor(answering());
    const harness = cliHarness(double);
    const deps: ProbeCliDeps = {
      ...harness.deps,
      writeReport: () => {
        throw Object.assign(new Error("file exists"), { code: "EEXIST" });
      },
    };

    const status = await runProbeCli(EXECUTE_ARGS, deps);

    expect(status).toBe(PROBE_EXIT_NOT_CONFIRMED);
    expect(harness.warned.join("\n")).toContain("could not be written to probe-out (EEXIST)");
    expect(recordOf(JSON.parse(harness.printed[0])).verdict).toBe("confirmed");
  });
});

/** One request a loopback server received. */
interface LoopbackRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string;
  readonly body: string;
}

/**
 * Start a server on the loopback interface that answers as the contract says.
 *
 * @returns Its base URL and the requests it received.
 */
async function loopbackVendor(): Promise<{ readonly baseUrl: string; readonly requests: LoopbackRequest[] }> {
  const requests: LoopbackRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization ?? "",
        body,
      });
      void CONTRACT_ANSWERS[shapeOfSent(body)]()
        .text()
        .then((text) => {
          const status = shapeOfSent(body) === PROBE_REFUSAL_SHAPE ? 422 : OK;
          response.writeHead(status, VENDOR_HEADERS);
          response.end(text);
        });
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, LOOPBACK_HOST, () => resolve());
  });
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the loopback server has no port");
  }
  return { baseUrl: `http://${LOOPBACK_HOST}:${address.port}`, requests };
}

/**
 * Run the command as an operator would, as a child process.
 *
 * @param args The command's arguments.
 * @param env The variables to set, or to remove when `undefined`, over this process's own.
 * @returns The exit status and both output streams.
 */
function runCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
  const childEnv: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...process.env, ...env })) {
    if (value !== undefined) {
      childEnv[name] = value;
    }
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PROBE_SCRIPT, ...args], {
      cwd: UTILS_ROOT,
      env: childEnv,
      timeout: COMMAND_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("the command, run as an operator runs it", () => {
  it(
    "with no arguments exits zero with the plan printed and makes no request",
    async () => {
      const loopback = await loopbackVendor();

      const result = await runCommand([], { [KEY_ENV]: undefined, [BASE_URL_ENV]: loopback.baseUrl });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(PROBE_EXIT_OK);
      expect(result.stdout).toContain("a dry run, nothing is sent");
      expect(result.stdout).toContain(`key variable ${KEY_ENV} (unset)`);
      expect(result.stdout).toContain("endpoint environment_override");
      expect(result.stdout).toContain(`--acknowledge-real-calls ${DEFAULT_PLAN_CALLS} --out <dir>`);
      expect(loopback.requests).toEqual([]);
    },
    COMMAND_TIMEOUT_MS,
  );

  it(
    "with execute makes the planned calls with the key, writes one report without it, and does not call a loopback server the vendor",
    async () => {
      const loopback = await loopbackVendor();
      const out = mkdtempSync(join(tmpdir(), "decision-probe-"));
      temporaryDirs.push(out);

      const result = await runCommand(
        ["--execute", "--route", HOSTED_ROUTE, "--acknowledge-real-calls", String(DEFAULT_PLAN_CALLS), "--out", out],
        { [KEY_ENV]: SENTINEL_KEY, [BASE_URL_ENV]: loopback.baseUrl },
      );

      expect(result.stderr).toBe("");
      expect(result.status).toBe(PROBE_EXIT_OK);
      expect(loopback.requests).toHaveLength(DEFAULT_PLAN_CALLS);
      for (const request of loopback.requests) {
        expect(request.method).toBe("POST");
        expect(request.url).toBe(SYSTEMONE_PATH);
        expect(request.authorization === `${BEARER}${SENTINEL_KEY}`).toBe(true);
      }
      const files = readdirSync(out);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^decision-probe\.dm\.hosted\.\d{8}T\d{6}Z\.json$/);
      const text = readFileSync(join(out, files[0]), "utf8");
      const report = recordOf(JSON.parse(text));
      expect(report.verdict).toBe("confirmed");
      expect(report.dispatched).toBe(DEFAULT_PLAN_CALLS);
      expect(report.endpoint).toBe("environment_override");
      expect(report.evidence).toBeNull();
      expect(report.evidenceWithheld).toBe("base_url_overridden");
      expect(text.includes(SENTINEL_KEY)).toBe(false);
      expect(result.stdout.includes(SENTINEL_KEY)).toBe(false);
      expect(result.stdout).toContain("verdict: confirmed");
      expect(result.stdout).toContain("evidence: none about the vendor (base_url_overridden)");
    },
    COMMAND_TIMEOUT_MS,
  );
});
