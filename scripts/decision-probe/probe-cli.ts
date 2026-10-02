/**
 * The command line of the decision contract probe.
 *
 * The probe spends real, billed calls against a vendor under an operator's own
 * key, so the command is built so that it cannot do that by accident. With no
 * arguments it is a dry run: it prints the plan and sends nothing. A run that
 * sends must be asked for, must name the route, and must repeat back the exact
 * number of calls it will make, which the dry run prints. A flag that merely
 * said "yes" could be pasted without being read; the count cannot be right
 * unless the plan was looked at. Every refusal happens before any call.
 *
 * What a run writes is one report, and what it prints is taken from that
 * report. Before either leaves the process, both are searched for the key the
 * calls were made with, and if a vendor repeated it back anywhere they hold,
 * nothing is written and nothing is printed.
 *
 * Everything the command touches outside itself is handed in: the HTTP call,
 * the clock, the two output streams and the file system. A test drives the
 * whole command with none of them real.
 *
 * @module scripts/decision-probe/probe-cli
 */

import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DECISION_BUDGET_CEILING_MS,
  decisionRouteDeclaration,
  decisionRouteTable,
  listDecisionRoutes,
} from "../../src/llm/decision/decision-route-table";
import { DecisionRouteUnavailableError } from "../../src/llm/decision/errors";
import type { DecisionRouteTable } from "../../src/llm/decision/route-types";
import { DECISION_ROUTES } from "../../src/llm/decision/types";
import type { DecisionRoute } from "../../src/llm/decision/types";
import { PROBE_DEFAULT_SAMPLES, ProbePlanError, buildProbePlan } from "./probe-plan";
import type { ProbePlan } from "./probe-plan";
import { probeReportFileName, renderProbeSummary, utcDateOf } from "./probe-report";
import { ProbeRefusal, probeDispatchIntervalMs, resolveProbeTarget, runDecisionProbe } from "./probe-run";
import type { ProbeClock, ProbeFetch, ProbeTarget } from "./probe-run";

/** Exit status of a dry run, and of a run that confirmed the contract. */
export const PROBE_EXIT_OK = 0;

/** Exit status of a run that did not confirm the contract, or that could not be completed. */
export const PROBE_EXIT_NOT_CONFIRMED = 1;

/** Exit status of a command that was refused before any call was made. */
export const PROBE_EXIT_REFUSED = 2;

/** The command as an operator types it, for the lines that say what to run. */
const COMMAND = "node scripts/probe-decision-contract.mjs";

/** The flag that asks for calls to be sent. */
const EXECUTE_FLAG = "--execute";

/** The flag that asks for the plan only. It is also what no flag at all means. */
const DRY_RUN_FLAG = "--dry-run";

/** The flag that names the route. */
const ROUTE_FLAG = "--route";

/** The flag that sets how many times each answerable shape is asked. */
const SAMPLES_FLAG = "--samples";

/** The flag that leaves out the request a vendor is expected to refuse. */
const OMIT_REFUSAL_FLAG = "--omit-invalid-request";

/** The flag that repeats back how many real calls the run will make. */
const ACKNOWLEDGE_FLAG = "--acknowledge-real-calls";

/** The flag that names the directory the report is written to. */
const OUT_FLAG = "--out";

/** The flag that prints how the command is used. */
const HELP_FLAG = "--help";

/** A whole number written in digits only. */
const WHOLE_NUMBER = /^\d+$/;

/** The form of a system failure code, such as `EACCES`. */
const SYSTEM_CODE = /^[A-Z][A-Z0-9_]{0,31}$/;

/** How many spaces the report is indented by, so a reviewer can read it. */
const REPORT_INDENT = 2;

/** How the command is used. */
const USAGE: readonly string[] = [
  "The decision contract probe: the first authenticated calls to a hosted decision route.",
  "",
  `  ${COMMAND} [${ROUTE_FLAG} <route>] [${SAMPLES_FLAG} <n>] [${OMIT_REFUSAL_FLAG}]`,
  "      A dry run. Prints the plan and sends nothing. This is what no arguments means.",
  "",
  `  ${COMMAND} ${EXECUTE_FLAG} ${ROUTE_FLAG} <route> ${ACKNOWLEDGE_FLAG} <count> ${OUT_FLAG} <dir>`,
  `      [${SAMPLES_FLAG} <n>] [${OMIT_REFUSAL_FLAG}]`,
  "      Makes the calls, which are real and billed, and writes one report into <dir>.",
  "      <count> is the number of calls the dry run prints for the same arguments.",
  "      The key is read from the environment variable the route's provider names.",
  "",
  `  Exit status: ${PROBE_EXIT_OK} a dry run, or a run that confirmed the contract;`,
  `  ${PROBE_EXIT_NOT_CONFIRMED} a run that did not confirm it;`,
  `  ${PROBE_EXIT_REFUSED} a command refused before any call.`,
];

/** What the command reaches outside itself through. */
export interface ProbeCliDeps {
  readonly fetchImpl: ProbeFetch;
  readonly clock: ProbeClock;
  /** Write one line to standard output. */
  readonly print: (line: string) => void;
  /** Write one line to standard error. */
  readonly warn: (line: string) => void;
  /**
   * Make sure a directory exists and can be written to.
   *
   * @throws When it cannot be created or written to.
   */
  readonly prepareOut: (dir: string) => void;
  /**
   * Write a report into a directory, never over a file that is already there.
   *
   * @returns The path written.
   * @throws When the file cannot be written.
   */
  readonly writeReport: (dir: string, fileName: string, text: string) => string;
  /** The route table to read; the canonical one unless a test supplies another. */
  readonly table?: DecisionRouteTable;
}

/** What the arguments ask for. */
export interface ProbeArguments {
  readonly mode: "dry-run" | "execute" | "help";
  readonly route: DecisionRoute | null;
  readonly samples: number;
  readonly includeRefusal: boolean;
  /** The number of calls the operator repeated back, or `null` when none was given. */
  readonly acknowledgedCalls: number | null;
  /** The directory the report is written to, or `null` when none was given. */
  readonly out: string | null;
}

/**
 * Read a whole number given as a flag's value.
 *
 * @param flag The flag.
 * @param value The text given.
 * @returns The number.
 * @throws {ProbeRefusal} When the text is not a whole number in digits.
 */
function wholeNumber(flag: string, value: string): number {
  if (!WHOLE_NUMBER.test(value)) {
    throw new ProbeRefusal(`${flag} takes a whole number`);
  }
  return Number(value);
}

/**
 * Whether a name is one of the decision routes.
 *
 * @param name The name.
 * @returns Whether it is a route a caller may name.
 */
function isDecisionRoute(name: string): name is DecisionRoute {
  return (DECISION_ROUTES as readonly string[]).includes(name);
}

/**
 * Read the command's arguments.
 *
 * Nothing is guessed. An argument the command does not know is refused, as is
 * a flag given without its value, because a mistyped flag silently ignored
 * would leave a run doing something other than what was typed.
 *
 * @param argv The arguments, without the program and the script.
 * @returns What they ask for. With no arguments, a dry run.
 * @throws {ProbeRefusal} When an argument is unknown, a value is missing or
 *   malformed, or a dry run and a run that sends are both asked for.
 */
export function parseProbeArguments(argv: readonly string[]): ProbeArguments {
  let execute = false;
  let dryRun = false;
  let help = false;
  let route: DecisionRoute | null = null;
  let samples = PROBE_DEFAULT_SAMPLES;
  let includeRefusal = true;
  let acknowledgedCalls: number | null = null;
  let out: string | null = null;

  const valueAfter = (index: number): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new ProbeRefusal(`${argv[index]} takes a value`);
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case EXECUTE_FLAG:
        execute = true;
        break;
      case DRY_RUN_FLAG:
        dryRun = true;
        break;
      case HELP_FLAG:
        help = true;
        break;
      case OMIT_REFUSAL_FLAG:
        includeRefusal = false;
        break;
      case ROUTE_FLAG: {
        const name = valueAfter(index);
        if (!isDecisionRoute(name)) {
          throw new ProbeRefusal(`${ROUTE_FLAG} takes one of ${DECISION_ROUTES.join(", ")}`);
        }
        route = name;
        index += 1;
        break;
      }
      case SAMPLES_FLAG:
        samples = wholeNumber(SAMPLES_FLAG, valueAfter(index));
        index += 1;
        break;
      case ACKNOWLEDGE_FLAG:
        acknowledgedCalls = wholeNumber(ACKNOWLEDGE_FLAG, valueAfter(index));
        index += 1;
        break;
      case OUT_FLAG:
        out = valueAfter(index);
        index += 1;
        break;
      default:
        throw new ProbeRefusal(`${argument} is not an argument of this command; ${HELP_FLAG} lists them`);
    }
  }
  if (execute && dryRun) {
    throw new ProbeRefusal(`${EXECUTE_FLAG} and ${DRY_RUN_FLAG} were both given; a run either sends or it does not`);
  }
  const mode = help ? "help" : execute ? "execute" : "dry-run";
  return { mode, route, samples, includeRefusal, acknowledgedCalls, out };
}

/**
 * The flags that reproduce a plan, as they are typed after the command.
 *
 * @param args What the arguments asked for.
 * @returns The flags for the number of samples and the refused request, when either differs from the default.
 */
function planFlags(args: ProbeArguments): string {
  return (
    (args.samples === PROBE_DEFAULT_SAMPLES ? "" : ` ${SAMPLES_FLAG} ${args.samples}`) +
    (args.includeRefusal ? "" : ` ${OMIT_REFUSAL_FLAG}`)
  );
}

/**
 * The key a route's calls are made with, or `null` when there is none.
 *
 * Read by NAME, as the transport reads it. It is read here only to refuse a run
 * that has none and to keep it out of what the run writes; it is never stored
 * and never printed.
 *
 * @param target The route.
 * @returns The key without surrounding whitespace, or `null` when the variable is unset or blank.
 */
function keyOf(target: ProbeTarget): string | null {
  const value = process.env[target.resolved.apiKeyEnv];
  const key = value === undefined ? "" : value.trim();
  return key.length === 0 ? null : key;
}

/**
 * Whether a text holds the key.
 *
 * The key is looked for as it is and as a JSON string writes it, which differs
 * when it holds a quote or a backslash and is the form a report would hold it
 * in. Case is ignored, because the name of a header reaches a report in lower
 * case whatever case the vendor wrote it in.
 *
 * @param text The text about to leave the process.
 * @param key The key the calls were made with.
 * @returns True when the text holds the key in either form, in any case.
 */
export function probeTextCarriesKey(text: string, key: string): boolean {
  const searched = text.toLowerCase();
  const sought = key.toLowerCase();
  return searched.includes(sought) || searched.includes(JSON.stringify(sought).slice(1, -1));
}

/**
 * The system's own code for a failure, such as `EACCES`, when it gave one.
 *
 * A failure of the file system is described by its code and not by its
 * message: the code says what went wrong, and the message repeats a path.
 *
 * @param error Whatever was thrown.
 * @returns The code in brackets, or nothing when the failure carries none.
 */
function systemCodeOf(error: unknown): string {
  const code: unknown = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && SYSTEM_CODE.test(code) ? ` (${code})` : "";
}

/**
 * Resolve a route for the command, turning a closed route into a refusal.
 *
 * @param route The route named.
 * @param observedOn The date of the run.
 * @param table The table to read.
 * @returns The resolved route and where its calls go.
 * @throws {ProbeRefusal} When the route cannot be probed, with the table's own reason.
 */
function targetOf(route: DecisionRoute, observedOn: string, table: DecisionRouteTable): ProbeTarget {
  try {
    return resolveProbeTarget(route, observedOn, table);
  } catch (error) {
    if (error instanceof DecisionRouteUnavailableError) {
      throw new ProbeRefusal(`${route} cannot be probed (${error.code}): ${error.reason}`);
    }
    throw error;
  }
}

/**
 * Print the plan for one route.
 *
 * @param route The route.
 * @param args What the arguments asked for.
 * @param deps The output stream, the clock and the table.
 */
function printPlan(route: DecisionRoute, args: ProbeArguments, deps: ProbeCliDeps): void {
  const target = targetOf(route, utcDateOf(deps.clock.epochMs()), deps.table ?? decisionRouteTable);
  const { resolved } = target;
  const plan = planOf(target, args);
  const answerable = plan.requests.filter((request) => request.expect === "answer").length;
  const keyState = keyOf(target) === null ? "unset" : "set";
  deps.print(
    `route ${route}: provider ${resolved.providerName}, model pin ${resolved.modelPin}, ` +
      `endpoint ${target.endpoint}, key variable ${resolved.apiKeyEnv} (${keyState})`,
  );
  deps.print(
    `  ${plan.dispatches.length} calls: ${answerable} answerable shapes asked ${plan.samples} time(s) each` +
      (args.includeRefusal ? ", then 1 request the vendor is expected to refuse" : ""),
  );
  const intervalMs = probeDispatchIntervalMs(resolved.providerName, resolved.modelPin);
  deps.print(
    `  one call in flight at a time, at least ${intervalMs} ms between dispatches, ` +
      `each abandoned after ${DECISION_BUDGET_CEILING_MS} ms`,
  );
  plan.requests.forEach((request, index) => {
    const expects = request.expect === "answer" ? "an answer" : "a refusal";
    deps.print(`  request ${index + 1} (${request.shape}, expects ${expects}): ${JSON.stringify(request.body)}`);
  });
  deps.print(
    `  to make these calls: ${COMMAND} ${EXECUTE_FLAG} ${ROUTE_FLAG} ${route}${planFlags(args)} ` +
      `${ACKNOWLEDGE_FLAG} ${plan.dispatches.length} ${OUT_FLAG} <dir>`,
  );
}

/**
 * The plan the arguments ask for, turning a plan the probe will not send into a refusal.
 *
 * @param target The route.
 * @param args What the arguments asked for.
 * @returns The plan.
 * @throws {ProbeRefusal} When the number of samples is one the probe will not send.
 */
function planOf(target: ProbeTarget, args: ProbeArguments): ProbePlan {
  try {
    return buildProbePlan(target.resolved, { samples: args.samples, includeRefusal: args.includeRefusal });
  } catch (error) {
    if (error instanceof ProbePlanError) {
      throw new ProbeRefusal(`${SAMPLES_FLAG}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * The routes a dry run with no route named prints a plan for.
 *
 * @param table The table to read.
 * @returns Every route this package serves over HTTP.
 */
function probeableRoutes(table: DecisionRouteTable): DecisionRoute[] {
  return listDecisionRoutes().filter((route) => decisionRouteDeclaration(route, table).served_by === "utils");
}

/**
 * Make a run that sends.
 *
 * Every refusal is made before the first call, in the order an operator meets
 * them: the route, the plan, the count repeated back, the directory, the key.
 *
 * @param args What the arguments asked for.
 * @param deps What the command reaches outside itself through.
 * @returns The exit status.
 * @throws {ProbeRefusal} When the command is refused.
 */
async function execute(args: ProbeArguments, deps: ProbeCliDeps): Promise<number> {
  const table = deps.table ?? decisionRouteTable;
  if (args.route === null) {
    throw new ProbeRefusal(`${EXECUTE_FLAG} needs ${ROUTE_FLAG} <route>: a run names the route it spends calls on`);
  }
  const target = targetOf(args.route, utcDateOf(deps.clock.epochMs()), table);
  const planned = planOf(target, args).dispatches.length;
  if (args.acknowledgedCalls !== planned) {
    throw new ProbeRefusal(
      `this run would make ${planned} real, billed calls to ${target.resolved.providerName}; ` +
        `add ${ACKNOWLEDGE_FLAG} ${planned} to say so` +
        (args.acknowledgedCalls === null ? "" : ` (${args.acknowledgedCalls} was given)`),
    );
  }
  if (args.out === null) {
    throw new ProbeRefusal(`${EXECUTE_FLAG} needs ${OUT_FLAG} <dir>: the report is the point of the run`);
  }
  const key = keyOf(target);
  if (key === null) {
    throw new ProbeRefusal(`${target.resolved.apiKeyEnv} is unset, so there is no key to make the calls with`);
  }
  try {
    deps.prepareOut(args.out);
  } catch (error) {
    throw new ProbeRefusal(
      `${OUT_FLAG} ${args.out} cannot be created or written to${systemCodeOf(error)}; no call was made`,
    );
  }

  const report = await runDecisionProbe({
    route: args.route,
    samples: args.samples,
    includeRefusal: args.includeRefusal,
    fetchImpl: deps.fetchImpl,
    clock: deps.clock,
    table,
  });
  const text = `${JSON.stringify(report, null, REPORT_INDENT)}\n`;
  const lines = renderProbeSummary(report);
  if (probeTextCarriesKey(text, key) || lines.some((line) => probeTextCarriesKey(line, key))) {
    deps.warn(
      `a response repeated the credential held in ${target.resolved.apiKeyEnv}, and the report would have ` +
        "carried it; nothing was written and nothing is printed",
    );
    return PROBE_EXIT_NOT_CONFIRMED;
  }

  let written: string | null = null;
  try {
    written = deps.writeReport(args.out, probeReportFileName(report), text);
  } catch (error) {
    deps.warn(
      `the report could not be written to ${args.out}${systemCodeOf(error)}; ` +
        "it follows on standard output so the run is not lost",
    );
    deps.print(text);
  }
  lines.forEach((line) => deps.print(line));
  if (written === null) {
    return PROBE_EXIT_NOT_CONFIRMED;
  }
  deps.print(`report: ${written}`);
  return report.verdict === "confirmed" ? PROBE_EXIT_OK : PROBE_EXIT_NOT_CONFIRMED;
}

/**
 * Describe a failure the command did not foresee, without repeating a key.
 *
 * Such a failure is a defect of the probe or of the machine it runs on, and
 * its message is free text from wherever it was raised. It is printed, because
 * an operator needs it, unless it holds the key of any provider the table
 * names; then only the failure's class is.
 *
 * @param error Whatever was thrown.
 * @param table The table whose providers' key variables are read.
 * @returns The failure's class, and its message when the message holds no key.
 */
function describeUnexpected(error: unknown, table: DecisionRouteTable): string {
  if (!(error instanceof Error)) {
    return "a thrown value that is not an error";
  }
  const keys = Object.values(table.providers).flatMap((provider) => {
    const value = provider.api_style === "systemone" ? process.env[provider.api_key_env] : undefined;
    const key = value === undefined ? "" : value.trim();
    return key.length === 0 ? [] : [key];
  });
  const quotesKey = keys.some((key) => probeTextCarriesKey(error.message, key));
  return quotesKey ? error.name : `${error.name}: ${error.message}`;
}

/**
 * Run the command.
 *
 * @param argv The arguments, without the program and the script.
 * @param deps What the command reaches outside itself through.
 * @returns The exit status. A refusal and its reason go to standard error, as
 *   does a failure the command did not foresee.
 */
export async function runProbeCli(argv: readonly string[], deps: ProbeCliDeps): Promise<number> {
  try {
    const args = parseProbeArguments(argv);
    if (args.mode === "help") {
      USAGE.forEach((line) => deps.print(line));
      return PROBE_EXIT_OK;
    }
    if (args.mode === "execute") {
      return await execute(args, deps);
    }
    deps.print("decision contract probe: a dry run, nothing is sent");
    const routes = args.route === null ? probeableRoutes(deps.table ?? decisionRouteTable) : [args.route];
    routes.forEach((route) => printPlan(route, args, deps));
    return PROBE_EXIT_OK;
  } catch (error) {
    if (error instanceof ProbeRefusal) {
      deps.warn(`refused: ${error.message}`);
      return PROBE_EXIT_REFUSED;
    }
    deps.warn(`the probe failed: ${describeUnexpected(error, deps.table ?? decisionRouteTable)}`);
    return PROBE_EXIT_NOT_CONFIRMED;
  }
}

/**
 * What the command reaches outside itself through when an operator runs it.
 *
 * @returns The platform's HTTP call, the system's clocks, the process's
 *   streams, and a file system that never writes over an existing report.
 */
export function systemProbeCliDeps(): ProbeCliDeps {
  return {
    fetchImpl: (url, init) => fetch(url, init),
    clock: {
      monotonicMs: () => performance.now(),
      epochMs: () => Date.now(),
      wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    },
    print: (line) => {
      process.stdout.write(`${line}\n`);
    },
    warn: (line) => {
      process.stderr.write(`${line}\n`);
    },
    prepareOut: (dir) => {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
    },
    writeReport: (dir, fileName, text) => {
      const path = join(dir, fileName);
      writeFileSync(path, text, { flag: "wx" });
      return path;
    },
  };
}
