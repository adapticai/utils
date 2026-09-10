#!/usr/bin/env node
/**
 * CI entry point for the LLM migration eval gate (backlog W0-03).
 *
 * The gate this script fronts has one job: block a merge that would move LLM
 * traffic onto a model that grades worse than the one it replaces. PD-6 makes
 * that a deterministic CI decision — every verdict is computed by code from
 * recorded data, and nothing here asks a model or an agent for an opinion.
 *
 * The modes below exist because a gate nobody can see fail is a gate nobody
 * should trust. `--self-check red` deliberately grades a failing fixture set and
 * insists the harness reports it as failed; `--assertion-coverage` insists every
 * assertion the route table requires was demonstrated in BOTH directions by the
 * run that just happened; `--offline-check` insists none of it touched a
 * provider. Together they answer "is this gate alive" before the gate is asked
 * "is this model good".
 *
 * Usage:
 *   node scripts/run-llm-evals.mjs                    grade registered golden sets, after full self-verification
 *   node scripts/run-llm-evals.mjs --self-check green pass fixtures must grade as PASSED
 *   node scripts/run-llm-evals.mjs --self-check red   fail fixtures must grade as FAILED (exits 0)
 *   node scripts/run-llm-evals.mjs --assertion-coverage
 *   node scripts/run-llm-evals.mjs --judge-pinning-check
 *   node scripts/run-llm-evals.mjs --ci-wiring-check
 *   node scripts/run-llm-evals.mjs --offline-check
 *
 * Environment:
 *   LLM_EVAL_GOLDEN_DIR  overrides the golden-set directory
 *
 * @module scripts/run-llm-evals
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Exit code for an assertion that did not hold. */
const EXIT_ASSERTION_FAILED = 1;

/** Exit code for a usage error, kept distinct so CI can tell misuse from a red gate. */
const EXIT_USAGE = 2;

/** The utils package root, derived from this file's location. */
const UTILS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The workspace root holding the sibling repos and the golden-set directory. */
const WORKSPACE_ROOT = dirname(UTILS_ROOT);

/** Where golden sets live. */
const GOLDEN_DIR =
  process.env.LLM_EVAL_GOLDEN_DIR ?? join(WORKSPACE_ROOT, "docs", "llm-migration", "golden-sets");

/** The workflow that makes this gate a blocking PR check. */
const WORKFLOW_PATH = join(WORKSPACE_ROOT, ".github", "workflows", "llm-eval-gate.yml");

/** Distinct ways the judge pin must be shown to refuse before the check is satisfied. */
const EXPECTED_PINNING_REFUSALS = 5;

/** Repos that carry a thin wrapper delegating to this harness. */
const WRAPPER_REPOS = ["engine", "lumic-utils", "backend-legacy"];

/** Thrown when an assertion this script makes does not hold. */
class GateAssertionError extends Error {
  /**
   * @param {string} message What did not hold.
   */
  constructor(message) {
    super(message);
    this.name = "GateAssertionError";
  }
}

/**
 * Assert a condition, or fail the gate.
 *
 * @param {boolean} condition The condition that must hold.
 * @param {string} message What it means when it does not.
 * @returns {void}
 */
function must(condition, message) {
  if (!condition) {
    throw new GateAssertionError(message);
  }
}

/**
 * Load a JSON document from the golden-set directory.
 *
 * @param {string} relativePath Path relative to the golden-set directory.
 * @returns {unknown} The parsed document.
 */
function readGoldenJson(relativePath) {
  const path = join(GOLDEN_DIR, relativePath);
  must(
    existsSync(path),
    `golden-set document "${relativePath}" is missing from ${GOLDEN_DIR}. The gate grades recorded ` +
      "evidence; it cannot proceed by assuming what the missing file would have said.",
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Import the eval harness and the alias client from their TypeScript sources.
 *
 * Loading source rather than a build artefact keeps the gate honest about which
 * code it is grading with: a bundle can be stale, and a stale eval harness fails
 * silently by continuing to certify against yesterday's rules.
 *
 * @returns {Promise<{evalHarness: object, llmClient: object}>} The loaded modules.
 */
async function loadHarness() {
  const hooks = join(UTILS_ROOT, "src", "llm", "eval", "ts-loader-hooks.mjs");
  must(
    existsSync(hooks),
    `the eval harness loader is missing at ${hooks}; this script cannot grade anything without it`,
  );
  register(pathToFileURL(hooks).href, import.meta.url, {
    data: { resolveFrom: pathToFileURL(join(UTILS_ROOT, "package.json")).href },
  });
  const evalHarness = await import(
    pathToFileURL(join(UTILS_ROOT, "src", "llm", "eval", "index.ts")).href
  );
  const llmClient = await import(pathToFileURL(join(UTILS_ROOT, "src", "llm", "index.ts")).href);
  return { evalHarness, llmClient };
}

/**
 * A transport that fails if it is ever reached.
 *
 * Self-check grading is offline by construction — it reads recorded answers —
 * so any transport call during it is a defect, and one that would show up in CI
 * as flakiness on a provider outage rather than as the wiring bug it is.
 */
const EXPLODING_TRANSPORT = {
  name: "offline-guard",
  /**
   * @returns {Promise<never>} Never; always throws.
   */
  execute() {
    throw new Error(
      "offline guard: the eval harness attempted a live provider call during a self-check",
    );
  },
};

/**
 * Grade the self-check fixtures and assert the manifest's expectations.
 *
 * @param {object} harness The loaded eval harness module.
 * @param {"green"|"red"} mode Which half of the manifest to assert.
 * @returns {{green: string[], red: string[], lines: string[]}} Assertions demonstrated, and log lines.
 */
function gradeSelfCheck(harness, mode) {
  const manifest = readGoldenJson(join("self-check", "manifest.json"));
  const lines = [];
  const green = [];
  const red = [];

  /**
   * Load one manifest entry into a gradeable pair.
   *
   * @param {{set: string, candidate: string}} entry The manifest entry.
   * @returns {object} The set-and-candidate pair.
   */
  const pairFor = (entry) => ({
    set: harness.parseGoldenSet(
      readGoldenJson(join("self-check", entry.set)),
      `self-check/${entry.set}`,
    ),
    candidate: harness.parseCandidateRun(
      readGoldenJson(join("self-check", entry.candidate)),
      `self-check/${entry.candidate}`,
    ),
  });

  if (mode === "green") {
    must(
      Array.isArray(manifest.green) && manifest.green.length > 0,
      "the self-check manifest declares no green fixtures; a harness that has never been seen to pass " +
        "has not been shown to admit a good candidate",
    );
    const pairs = manifest.green.map(pairFor);
    const report = harness.evaluateRun(pairs);
    lines.push(...harness.formatRunReport(report));
    must(
      report.status === "PASSED",
      `green fixtures graded ${report.status}: ${report.summary}`,
    );
    manifest.green.forEach((entry, index) => {
      const setReport = report.sets[index];
      for (const assertion of entry.expect_pass_assertions) {
        const verdict = setReport.verdicts.find((candidate) => candidate.assertion === assertion);
        must(
          verdict !== undefined && verdict.kind === "pass",
          `green fixture ${entry.candidate} was expected to PASS "${assertion}" but rendered ` +
            `${verdict === undefined ? "no verdict" : verdict.kind}`,
        );
        green.push(assertion);
      }
    });
    return { green, red, lines };
  }

  must(
    Array.isArray(manifest.red) && manifest.red.length > 0,
    "the self-check manifest declares no red fixtures; an eval gate that cannot be seen to fail " +
      "certifies nothing when it passes",
  );

  const redPairs = manifest.red.map(pairFor);
  const redReport = harness.evaluateRun(redPairs);
  lines.push(...harness.formatRunReport(redReport));
  must(
    redReport.status === "FAILED",
    "the red fixtures graded PASSED; the harness did not detect a candidate it was built to reject",
  );

  manifest.red.forEach((entry, index) => {
    const setReport = redReport.sets[index];
    must(
      setReport.status === "FAILED",
      `red fixture ${entry.candidate} graded ${setReport.status}; it must fail`,
    );
    const target = setReport.verdicts.find(
      (verdict) => verdict.assertion === entry.expect_fail_assertion,
    );
    must(
      target !== undefined && target.kind === "fail",
      `red fixture ${entry.candidate} was expected to FAIL "${entry.expect_fail_assertion}" but rendered ` +
        `${target === undefined ? "no verdict" : target.kind}. A comparator that stopped discriminating ` +
        "would look exactly like this.",
    );
    red.push(entry.expect_fail_assertion);
    for (const verdict of setReport.verdicts) {
      if (verdict.assertion === entry.expect_fail_assertion) {
        continue;
      }
      must(
        verdict.kind === "pass",
        `red fixture ${entry.candidate} must trip ONLY "${entry.expect_fail_assertion}", but ` +
          `"${verdict.assertion}" rendered ${verdict.kind}. Isolation is what makes this fixture a test ` +
          "of one comparator rather than of the set as a whole.",
      );
      green.push(verdict.assertion);
    }
  });

  must(
    Array.isArray(manifest.indeterminate) && manifest.indeterminate.length > 0,
    "the self-check manifest declares no indeterminate fixtures; without one, nothing proves that " +
      "missing or insufficient evidence fails to collapse into a pass",
  );
  manifest.indeterminate.forEach((entry) => {
    const pair = pairFor(entry);
    const setReport = harness.evaluateSet(pair.set, pair.candidate);
    lines.push(`  [${setReport.status}] ${setReport.setId} vs ${setReport.candidateLabel}`);
    for (const verdict of setReport.verdicts) {
      lines.push(harness.formatVerdict(verdict));
    }
    const target = setReport.verdicts.find(
      (verdict) => verdict.assertion === entry.expect_indeterminate_assertion,
    );
    must(
      target !== undefined && target.kind === "indeterminate",
      `fixture ${entry.candidate} was expected to render "${entry.expect_indeterminate_assertion}" ` +
        `INDETERMINATE but rendered ${target === undefined ? "no verdict" : target.kind}`,
    );
    must(
      setReport.status === "FAILED",
      `fixture ${entry.candidate} rendered an indeterminate verdict yet graded ${setReport.status}; ` +
        "indeterminate must never collapse into a pass",
    );
  });

  return { green, red, lines };
}

/**
 * Run both halves of the self-check and report what each assertion demonstrated.
 *
 * @param {object} harness The loaded eval harness module.
 * @returns {{green: string[], red: string[], lines: string[]}} Combined evidence.
 */
function gradeBothDirections(harness) {
  const greenRun = gradeSelfCheck(harness, "green");
  const redRun = gradeSelfCheck(harness, "red");
  return {
    green: [...greenRun.green, ...redRun.green],
    red: [...greenRun.red, ...redRun.red],
    lines: [...greenRun.lines, ...redRun.lines],
  };
}

/**
 * Assert that every assertion the route table requires was demonstrated in both
 * directions by this run.
 *
 * @param {object} harness The loaded eval harness module.
 * @returns {string[]} Log lines.
 */
function checkAssertionCoverage(harness) {
  const observed = gradeBothDirections(harness);
  const coverage = harness.computeCoverage({ green: observed.green, red: observed.red });
  const lines = [
    `  required assertions: ${coverage.required.join(", ")}`,
    `  demonstrated passing: ${[...new Set(observed.green)].sort().join(", ")}`,
    `  demonstrated failing: ${[...new Set(observed.red)].sort().join(", ")}`,
  ];
  must(
    coverage.status === "PASSED",
    `assertion coverage is incomplete:\n    - ${coverage.problems.join("\n    - ")}`,
  );
  return lines;
}

/**
 * Assert that judged assertions can only be served by the pinned judge.
 *
 * @param {object} harness The loaded eval harness module.
 * @param {object} llmClient The loaded alias client module.
 * @returns {Promise<string[]>} Log lines.
 */
async function checkJudgePinning(harness, llmClient) {
  const lines = [];
  const pinned = harness.assertPinnedJudge(harness.PINNED_JUDGE.alias);
  lines.push(
    `  route table resolves ${pinned.alias} to ${pinned.provider}/${pinned.modelId}, matching the pin`,
  );

  const refusals = [];

  // 1. A non-pinned alias may not serve a judged assertion at all.
  try {
    harness.assertPinnedJudge("llm.reason");
    must(false, "assertPinnedJudge accepted the non-pinned alias llm.reason");
  } catch (error) {
    must(
      error instanceof harness.JudgeNotPinnedError,
      `expected JudgeNotPinnedError for a non-pinned alias, got ${String(error)}`,
    );
    refusals.push("a non-pinned alias is refused");
  }

  // 2. Grading a judged set through a non-pinned alias is refused before any
  //    verdict is rendered, not reported as a low score afterwards.
  const judgedSet = harness.parseGoldenSet(
    readGoldenJson(join("self-check", "free-text-judge.golden.json")),
    "self-check/free-text-judge.golden.json",
  );
  const judgedCandidate = harness.parseCandidateRun(
    readGoldenJson(join("self-check", "free-text-judge.pass.candidate.json")),
    "self-check/free-text-judge.pass.candidate.json",
  );
  try {
    harness.evaluateSet(judgedSet, judgedCandidate, { judgeAlias: "llm.reason" });
    must(false, "a judged set was graded through a non-pinned alias");
  } catch (error) {
    must(
      error instanceof harness.JudgeNotPinnedError,
      `expected a judged set through a non-pinned alias to be refused, got ${String(error)}`,
    );
    refusals.push("grading a judged set through a non-pinned alias is refused");
  }

  // 3. A route table that unpins the judge is refused, so the guard reads live
  //    table state rather than trusting a constant on its own.
  const unpinned = JSON.parse(JSON.stringify(llmClient.routeTable));
  unpinned.aliases[harness.PINNED_JUDGE.alias].pinned = false;
  try {
    harness.assertPinnedJudge(harness.PINNED_JUDGE.alias, unpinned);
    must(false, "assertPinnedJudge accepted a route table that unpins the judge");
  } catch (error) {
    must(
      error instanceof harness.JudgeNotPinnedError,
      `expected JudgeNotPinnedError for an unpinned route table, got ${String(error)}`,
    );
    refusals.push("an unpinned route table is refused");
  }

  // 4. A route table that swaps the judge model is refused, which is the
  //    "never auto-swapped" half of PD-6.
  const swapped = JSON.parse(JSON.stringify(llmClient.routeTable));
  swapped.aliases[harness.PINNED_JUDGE.alias].routes[0].model_id = "some-other-model";
  try {
    harness.assertPinnedJudge(harness.PINNED_JUDGE.alias, swapped);
    must(false, "assertPinnedJudge accepted a route table that swapped the judge model");
  } catch (error) {
    must(
      error instanceof harness.JudgeNotPinnedError,
      `expected JudgeNotPinnedError for a swapped judge model, got ${String(error)}`,
    );
    refusals.push("a swapped judge model is refused");
  }

  // 5. The refusal happens before the transport is touched, so a mis-pinned
  //    judge costs nothing and produces nothing.
  llmClient.configureLlmClient({
    gatewayTransport: EXPLODING_TRANSPORT,
    directTransport: EXPLODING_TRANSPORT,
  });
  let scored = false;
  try {
    await harness.scoreWithPinnedJudge(
      { rubric: "r", input: "i", reference: "e", answer: "a" },
      { alias: "llm.reason" },
    );
    scored = true;
  } catch (error) {
    must(
      error instanceof harness.JudgeNotPinnedError,
      `expected the judge call through a non-pinned alias to be refused before dialling out, got ${String(error)}`,
    );
    refusals.push("the refusal precedes any provider call");
  }
  must(!scored, "a judge score was produced through a non-pinned alias");

  for (const refusal of refusals) {
    lines.push(`  refused as required: ${refusal}`);
  }
  must(
    refusals.length === EXPECTED_PINNING_REFUSALS,
    `expected ${EXPECTED_PINNING_REFUSALS} pinning refusals, observed ${refusals.length}`,
  );
  return lines;
}

/**
 * Assert that a self-check makes no live provider call.
 *
 * @param {object} harness The loaded eval harness module.
 * @param {object} llmClient The loaded alias client module.
 * @returns {string[]} Log lines.
 */
function checkOffline(harness, llmClient) {
  llmClient.configureLlmClient({
    gatewayTransport: EXPLODING_TRANSPORT,
    directTransport: EXPLODING_TRANSPORT,
  });
  const realFetch = globalThis.fetch;
  let fetchAttempts = 0;
  globalThis.fetch = () => {
    fetchAttempts += 1;
    throw new Error("offline guard: the eval harness attempted a network fetch during a self-check");
  };
  try {
    const observed = gradeBothDirections(harness);
    must(
      observed.green.length > 0 && observed.red.length > 0,
      "the offline run graded nothing; completing without grading would prove only that nothing ran",
    );
    must(fetchAttempts === 0, `the self-check attempted ${fetchAttempts} network fetch(es)`);
    return [
      "  both self-check directions completed with every transport rigged to throw",
      `  network fetch attempts: ${fetchAttempts}`,
    ];
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * Assert that this gate is wired into CI and that every wrapper fails loudly
 * when the harness is absent.
 *
 * A wrapper that exits 0 when it cannot find the harness is precisely the
 * failure this gate exists to prevent: the check would report green in the one
 * situation where it graded nothing at all. So the property is verified by
 * making it happen — each wrapper is pointed at a harness path that does not
 * exist, and must exit non-zero.
 *
 * @returns {string[]} Log lines.
 */
function checkCiWiring() {
  const lines = [];
  must(
    existsSync(WORKFLOW_PATH),
    `the blocking PR check is missing at ${WORKFLOW_PATH}; a harness nobody runs gates nothing`,
  );
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");
  const requiredFragments = [
    "pull_request:",
    "llm-eval-gate:",
    "scripts/run-llm-evals.mjs",
  ];
  for (const fragment of requiredFragments) {
    must(
      workflow.includes(fragment),
      `${WORKFLOW_PATH} does not contain "${fragment}"; the workflow must run this harness on every PR`,
    );
  }
  must(
    !workflow.includes("continue-on-error"),
    `${WORKFLOW_PATH} sets continue-on-error, which turns a blocking gate into a notification`,
  );
  lines.push(`  workflow ${WORKFLOW_PATH} runs on pull_request and is blocking`);

  for (const repo of WRAPPER_REPOS) {
    const wrapper = join(WORKSPACE_ROOT, repo, "scripts", "run-llm-evals.mjs");
    must(existsSync(wrapper), `${repo} has no eval wrapper at ${wrapper}`);
    const missingHarness = join(WORKSPACE_ROOT, repo, "scripts", "no-such-harness.mjs");
    must(
      !existsSync(missingHarness),
      `the wiring check needs ${missingHarness} to be absent to prove the wrapper fails loudly`,
    );
    const probe = spawnSync(process.execPath, [wrapper], {
      env: { ...process.env, LLM_EVAL_HARNESS: missingHarness },
      encoding: "utf8",
    });
    must(
      probe.status !== 0,
      `${repo}'s wrapper exited 0 with the harness absent. A wrapper that passes when it graded ` +
        "nothing is worse than no wrapper: it reports the gate as green precisely when it is blind.",
    );
    lines.push(`  ${repo} wrapper exits ${probe.status} when the harness is absent`);
  }
  return lines;
}

/**
 * Grade every golden set registered for the gate.
 *
 * @param {object} harness The loaded eval harness module.
 * @returns {string[]} Log lines.
 */
function gradeRegisteredSets(harness) {
  const registry = readGoldenJson("registry.json");
  must(
    Array.isArray(registry.sets),
    "registry.json must declare a `sets` array, even when it is empty",
  );
  if (registry.sets.length === 0) {
    return [
      "  registered golden sets: 0",
      `  awaiting: ${registry.awaiting}`,
      "  nothing was graded, so nothing about any candidate model is claimed by this run",
    ];
  }
  const pairs = registry.sets.map((entry) => ({
    set: harness.parseGoldenSet(readGoldenJson(entry.set), entry.set),
    candidate: harness.parseCandidateRun(readGoldenJson(entry.candidate), entry.candidate),
  }));
  const report = harness.evaluateRun(pairs);
  const lines = harness.formatRunReport(report);
  must(report.status === "PASSED", `registered golden sets graded FAILED: ${report.summary}`);
  return lines;
}

/**
 * Print a named section of log lines.
 *
 * @param {string} title The section heading.
 * @param {string[]} lines The lines.
 * @returns {void}
 */
function section(title, lines) {
  console.log(`\n${title}`);
  for (const line of lines) {
    console.log(line);
  }
}

/**
 * Parse the command line into a mode.
 *
 * @param {string[]} argv Raw arguments.
 * @returns {{mode: string, selfCheck: string|null}} The selected mode.
 */
function parseArgs(argv) {
  if (argv.length === 0) {
    return { mode: "full", selfCheck: null };
  }
  const [flag, value] = argv;
  if (flag === "--self-check") {
    if (value !== "green" && value !== "red") {
      throw new GateAssertionError('--self-check takes "green" or "red"');
    }
    return { mode: "self-check", selfCheck: value };
  }
  const modes = {
    "--assertion-coverage": "coverage",
    "--judge-pinning-check": "judge-pinning",
    "--ci-wiring-check": "ci-wiring",
    "--offline-check": "offline",
  };
  const mode = modes[flag];
  if (mode === undefined) {
    throw new GateAssertionError(`unknown flag "${flag}"`);
  }
  return { mode, selfCheck: null };
}

/**
 * Run the selected mode.
 *
 * @returns {Promise<number>} The process exit code.
 */
async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`usage error: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }

  const { evalHarness, llmClient } = await loadHarness();
  console.log(`LLM eval gate — golden sets: ${GOLDEN_DIR}`);

  try {
    if (parsed.mode === "self-check" && parsed.selfCheck === "green") {
      section("self-check (green)", gradeSelfCheck(evalHarness, "green").lines);
      console.log("\nEVAL_HARNESS_GREEN");
      return 0;
    }
    if (parsed.mode === "self-check") {
      section("self-check (red)", gradeSelfCheck(evalHarness, "red").lines);
      console.log(
        "\nthe harness graded every deliberately failing fixture as FAILED, which is the expected outcome",
      );
      console.log("EVAL_HARNESS_RED_AS_EXPECTED");
      return 0;
    }
    if (parsed.mode === "coverage") {
      section("assertion coverage", checkAssertionCoverage(evalHarness));
      console.log("\nEVAL_ASSERTIONS_COVERED");
      return 0;
    }
    if (parsed.mode === "judge-pinning") {
      section("judge pinning (PD-6)", await checkJudgePinning(evalHarness, llmClient));
      console.log("\nEVAL_JUDGE_PINNED");
      return 0;
    }
    if (parsed.mode === "ci-wiring") {
      section("CI wiring", checkCiWiring());
      console.log("\nEVAL_CI_WIRED");
      return 0;
    }
    if (parsed.mode === "offline") {
      section("offline verification", checkOffline(evalHarness, llmClient));
      console.log("\nEVAL_OFFLINE_VERIFIED");
      return 0;
    }

    section("self-check (green)", gradeSelfCheck(evalHarness, "green").lines);
    section("self-check (red)", gradeSelfCheck(evalHarness, "red").lines);
    section("assertion coverage", checkAssertionCoverage(evalHarness));
    section("judge pinning (PD-6)", await checkJudgePinning(evalHarness, llmClient));
    section("offline verification", checkOffline(evalHarness, llmClient));
    section("CI wiring", checkCiWiring());
    section("registered golden sets", gradeRegisteredSets(evalHarness));
    console.log("\nEVAL_GATE_GREEN");
    return 0;
  } catch (error) {
    console.error(`\nEVAL GATE FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack !== undefined && !(error instanceof GateAssertionError)) {
      console.error(error.stack);
    }
    return EXIT_ASSERTION_FAILED;
  }
}

process.exitCode = await main();
