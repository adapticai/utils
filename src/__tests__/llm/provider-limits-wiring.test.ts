/**
 * The limits verifier's wiring mode reads the code that owns the guard.
 *
 * `scripts/verify-provider-limits.mjs wiring` asserts that the rate and
 * concurrency guards are on the execution path rather than merely present: a
 * leg reaches its transport only through `withProviderGuards`, a guard timeout
 * is not charged to provider health, the guard bounds its queue by the caller's
 * budget and always returns its permit, and a probe slot an attempt ends
 * without a verdict on comes back. A check of that kind is only as good as the
 * files it reads. Pointed at a file the guarded call has moved out of, every
 * assertion fails on the healthy tree and the gate is red noise; pointed at a
 * file that merely mentions the right names, it passes on a tree where the
 * guard guards nothing.
 *
 * So the check is run here three ways: against the tree as it is, which must
 * pass and which puts the wiring mode on the test command; against the tree
 * with exactly one guarded construct removed, which must fail for that
 * construct's own reason, in the file that owns it, and for no other; and by
 * importing the script, which must run nothing.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { checkWiring, readWiringSources, WIRING_FILES } from "../../../scripts/verify-provider-limits.mjs";
import type { WiringSources } from "../../../scripts/verify-provider-limits.mjs";

/** The package root, which the verifier resolves its inputs against. */
const UTILS_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** The verifier, relative to the package root. */
const VERIFIER = "scripts/verify-provider-limits.mjs";

/** What the wiring mode prints when every guard is on the path. */
const WIRED_TOKEN = "PROVIDER_LIMITS_WIRED";

/** The decision client, the second production site that dispatches to a transport. */
const DECISION_CLIENT = "src/llm/decision/decision-client.ts";

/**
 * Replace the first occurrence of `from` that follows `anchor`.
 *
 * Throws when either is absent, so a mutation the tree no longer admits fails
 * its case loudly instead of passing it on unmutated source.
 *
 * @param text The source.
 * @param anchor Text the replacement must come after.
 * @param from The text to replace.
 * @param to Its replacement.
 * @returns The mutated source.
 */
function replaceAfter(text: string, anchor: string, from: string, to: string): string {
  const anchorAt = text.indexOf(anchor);
  if (anchorAt < 0) {
    throw new Error(`mutation anchor not found: ${anchor}`);
  }
  const fromAt = text.indexOf(from, anchorAt);
  if (fromAt < 0) {
    throw new Error(`mutation target not found after ${anchor}: ${from}`);
  }
  return `${text.slice(0, fromAt)}${to}${text.slice(fromAt + from.length)}`;
}

/**
 * Replace every occurrence of `from`, requiring at least one.
 *
 * @param text The source.
 * @param from The text to replace.
 * @param to Its replacement.
 * @returns The mutated source.
 */
function replaceEvery(text: string, from: string, to: string): string {
  if (!text.includes(from)) {
    throw new Error(`mutation target not found: ${from}`);
  }
  return text.split(from).join(to);
}

/** One guarded construct removed from the real tree, and the one failure that must name it. */
interface WiringMutation {
  /** What the case removes. */
  readonly name: string;
  /** The tree with that construct removed. */
  readonly mutate: (sources: WiringSources) => WiringSources;
  /** The single failure the mutated tree must produce. */
  readonly expected: RegExp;
}

/**
 * Escape a path for use inside a regular expression.
 *
 * @param path A package-relative path.
 * @returns The escaped path.
 */
function pathPattern(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LEG = pathPattern(WIRING_FILES.legAttempt);
const HEDGE = pathPattern(WIRING_FILES.hedge);
const GUARD = pathPattern(WIRING_FILES.guard);

/** The ten guarded constructs, each removed on its own. */
const MUTATIONS: readonly WiringMutation[] = [
  {
    name: "the leg attempt calls withProviderGuards",
    mutate: (s) => ({ ...s, legAttempt: replaceEvery(s.legAttempt, "await withProviderGuards(", "await runUnguarded(") }),
    expected: new RegExp(`^${LEG}: .*does not call withProviderGuards`),
  },
  {
    name: "the guard wraps the transport call",
    mutate: (s) => ({
      ...s,
      legAttempt: replaceEvery(s.legAttempt, "leg.transport.execute<T>(", "leg.transport.dispatch<T>("),
    }),
    expected: new RegExp(`^${LEG}: withProviderGuards does not wrap the transport call itself`),
  },
  {
    name: "the leg attempt classifies a guard timeout",
    mutate: (s) => ({
      ...s,
      legAttempt: replaceEvery(s.legAttempt, "error instanceof RateGuardTimeoutError", "error instanceof RangeError"),
    }),
    expected: new RegExp(`^${LEG}: .*does not classify a guard timeout`),
  },
  {
    name: "a guard timeout is not counted against provider health",
    mutate: (s) => ({
      ...s,
      legAttempt: replaceAfter(
        s.legAttempt,
        "error instanceof RateGuardTimeoutError",
        "countsAgainstHealth: false",
        "countsAgainstHealth: true",
      ),
    }),
    expected: new RegExp(`^${LEG}: a guard timeout is counted against provider health`),
  },
  {
    name: "the guard bounds its queue by the caller's budget",
    mutate: (s) => ({
      ...s,
      guard: replaceEvery(s.guard, "Math.min(maxWaitMs, limits.acquire_timeout_ms)", "limits.acquire_timeout_ms"),
    }),
    expected: new RegExp(`^${GUARD}: .*does not bound queue time by the caller's budget`),
  },
  {
    name: "the guard releases its permit on every path",
    mutate: (s) => ({
      ...s,
      guard: replaceAfter(s.guard, "export async function withProviderGuards<T>(", "    release();\n", ""),
    }),
    expected: new RegExp(`^${GUARD}: the concurrency permit is not released on every path`),
  },
  {
    name: "the leg attempt tells the guard which model it addresses",
    mutate: (s) => ({
      ...s,
      legAttempt: replaceEvery(
        s.legAttempt,
        "{ modelId: leg.route.modelId, signal: controller.signal }",
        "{ signal: controller.signal }",
      ),
    }),
    expected: new RegExp(`^${LEG}: .*does not tell the guard which model`),
  },
  {
    name: "the leg attempt hands its signal to the guard",
    mutate: (s) => ({
      ...s,
      legAttempt: replaceEvery(
        s.legAttempt,
        "{ modelId: leg.route.modelId, signal: controller.signal }",
        "{ modelId: leg.route.modelId }",
      ),
    }),
    expected: new RegExp(`^${LEG}: .*does not hand the leg's signal to the guard`),
  },
  {
    name: "the same-model group returns an abandoned probe slot",
    mutate: (s) => ({ ...s, hedge: replaceEvery(s.hedge, ".onAttemptAbandoned(", ".onAttemptIgnored(") }),
    expected: new RegExp(`^${HEDGE}: .*never returns a half-open probe slot`),
  },
  {
    name: "every other dispatch to a transport is guarded",
    mutate: (s) => {
      const decisionClient = s.others[DECISION_CLIENT];
      if (decisionClient === undefined) {
        throw new Error(`${DECISION_CLIENT} is not among the swept sources`);
      }
      return {
        ...s,
        others: {
          ...s.others,
          [DECISION_CLIENT]: replaceEvery(
            decisionClient,
            "withProviderGuards(resolved.providerName, send,",
            "runUnguarded(resolved.providerName, send,",
          ),
        },
      };
    },
    expected: new RegExp(`^${pathPattern(DECISION_CLIENT)}:\\d+: dispatches to a transport outside withProviderGuards`),
  },
];

describe("provider limits wiring verifier", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the wiring check passes on the tree", () => {
    expect(checkWiring()).toEqual([]);

    const result = spawnSync(process.execPath, [VERIFIER, "wiring"], { cwd: UTILS_ROOT, encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(WIRED_TOKEN);
  });

  it("reads the files that own the guarded call, the timeout classification and the probe return", () => {
    expect(WIRING_FILES).toEqual({
      legAttempt: "src/llm/leg-attempt.ts",
      hedge: "src/llm/hedge.ts",
      guard: "src/llm/rate-guard.ts",
    });
    const sources = readWiringSources();
    expect(Object.keys(sources.others)).toContain(DECISION_CLIENT);
    for (const named of Object.values(WIRING_FILES)) {
      expect(Object.keys(sources.others)).not.toContain(named);
    }
  });

  describe("each assertion fires on the source it guards", () => {
    it.each(MUTATIONS)("$name", ({ mutate, expected }) => {
      const failures = checkWiring(mutate(readWiringSources()));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(expected);
    });
  });

  describe("the guard-timeout branch is read by the polarity of its condition", () => {
    /** The guard-timeout test as the leg attempt writes it. */
    const POSITIVE = "if (error instanceof RateGuardTimeoutError) {";

    it.each([
      ["a negated", "if (!(error instanceof RateGuardTimeoutError)) {"],
      ["an or-widened", "if (error instanceof RangeError || error instanceof RateGuardTimeoutError) {"],
      ["a negated-conjunction", "if (!(error instanceof RateGuardTimeoutError && error.message !== \"\")) {"],
    ])("%s condition, whose branch runs for errors that are not guard timeouts, spares nothing", (_form, condition) => {
      const sources = readWiringSources();
      const failures = checkWiring({ ...sources, legAttempt: replaceEvery(sources.legAttempt, POSITIVE, condition) });
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(new RegExp(`^${LEG}: a guard timeout is counted against provider health`));
    });

    it.each([
      ["an and-narrowed", "if (error instanceof RateGuardTimeoutError && error.message !== \"\") {"],
      ["a doubly negated", "if (!!(error instanceof RateGuardTimeoutError)) {"],
      ["a negated disjunction of negations", "if (!(!(error instanceof RateGuardTimeoutError) || error.message === \"\")) {"],
    ])("%s condition, whose branch runs only for guard timeouts, spares health", (_form, condition) => {
      const sources = readWiringSources();
      expect(checkWiring({ ...sources, legAttempt: replaceEvery(sources.legAttempt, POSITIVE, condition) })).toEqual([]);
    });
  });

  it("a dispatch beside the guarded one in the leg attempt fails the wrap assertion", () => {
    const sources = readWiringSources();
    const bypass = `${sources.legAttempt}\nexport function bypass(leg: ChainLeg): unknown {\n  return leg.transport.execute({} as never);\n}\n`;
    const failures = checkWiring({ ...sources, legAttempt: bypass });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(new RegExp(`^${LEG}: withProviderGuards does not wrap the transport call itself`));
  });

  it("a new source that dispatches without the guard is caught wherever it lives", () => {
    const sources = readWiringSources();
    const failures = checkWiring({
      ...sources,
      others: {
        ...sources.others,
        "src/llm/unguarded.ts": "export const run = (transport: { execute: (r: object) => unknown }): unknown =>\n  transport.execute({});\n",
      },
    });
    expect(failures).toEqual([
      "src/llm/unguarded.ts:2: dispatches to a transport outside withProviderGuards, so that call is held by no rate or concurrency limit",
    ]);
  });

  it("a dispatch in a named function counts as guarded only when the guard is its sole caller", () => {
    const named = [
      "const transport = { execute: async (): Promise<number> => 1 };",
      "const send = async (): Promise<number> => {",
      "  return transport.execute();",
      "};",
      "export const guarded = withProviderGuards('p', send);",
    ];
    const sources = readWiringSources();
    expect(checkWiring({ ...sources, others: { "src/llm/named-thunk.ts": named.join("\n") } })).toEqual([]);

    const alsoCalledDirectly = [...named, "export const bypass = send();"].join("\n");
    expect(checkWiring({ ...sources, others: { "src/llm/named-thunk.ts": alsoCalledDirectly } })).toEqual([
      "src/llm/named-thunk.ts:3: dispatches to a transport outside withProviderGuards, so that call is held by no rate or concurrency limit",
    ]);
  });

  it("a mention in a comment does not satisfy an assertion", () => {
    const sources = readWiringSources();
    const commentedOut = replaceEvery(
      sources.hedge,
      ".onAttemptAbandoned(",
      ".onAttemptIgnored( /* breakers.onAttemptAbandoned(key) */ ",
    );
    const failures = checkWiring({ ...sources, hedge: commentedOut });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(new RegExp(`^${HEDGE}: `));
  });

  it("importing the script runs nothing", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    const exitCodeBefore = process.exitCode;
    vi.resetModules();

    const module: unknown = await import("../../../scripts/verify-provider-limits.mjs");

    expect(module).toHaveProperty("checkWiring");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCodeBefore);
  });
});
