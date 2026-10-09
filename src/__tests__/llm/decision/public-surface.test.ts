/**
 * What the package exposes of the typed decision client, and what it does not.
 *
 * Three things are held here that no behavioural test can hold, because each
 * is about what is present in the tree and not about what a call does.
 *
 * The exported surface is exactly the reviewed one. A consumer reaches the
 * decision client through the same barrel as the generative client, and the
 * function that builds the hosted transport is not on it: exported, it would
 * let a call site reach the vendor on a route the table leaves closed.
 *
 * The decision sources name no vendor. Which model answers and where it is
 * reached are data in the route table, so that opening or re-pinning a route
 * is a reviewed change to one file; a host or a model id written into a source
 * would be a second place that decides, and one no table check reads.
 *
 * Adding the decision client changed nothing about the generative one: its
 * aliases, its tables and its exported names are what they were.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import * as llm from "../../../llm";
import { llmBreakers } from "../../../llm/alias-client";
import * as decision from "../../../llm/decision";
import { decisionRouteTable } from "../../../llm/decision/decision-route-table";
import { listAliases, routeTable } from "../../../llm/route-table";

/** The package root, which the build verifier resolves its inputs against. */
const UTILS_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The decision sources, relative to the package root. */
const DECISION_DIR = "src/llm/decision";

/** The LLM barrel and the package's entry, relative to the package root. */
const LLM_BARREL = "src/llm/index.ts";
const PACKAGE_ENTRY = "src/index.ts";

/** The line that hangs the decision client off the LLM barrel. */
const DECISION_BARREL_LINE = 'export * from "./decision";';

/** The build verifier, relative to the package root, and the mode that reads sources only. */
const VERIFIER = "scripts/verify-llm-client-build.mjs";
const REACHABILITY_MODE = "reachability";

/** What the verifier prints when the sources are sound. */
const REACHABILITY_OK = "LLM_CLIENT_REACHABILITY_OK";

/** Longest the verifier may run before the test gives up on it, in milliseconds. */
const VERIFIER_TIMEOUT_MS = 30_000;

/** The modules the verifier requires the barrel to reach. */
const REQUIRED_REACHABLE: readonly string[] = [
  "src/llm/decision/index.ts",
  "src/llm/decision/decision-client.ts",
  "src/llm/decision/codec.ts",
  "src/llm/decision/decision-route-table.ts",
  "src/llm/decision/transports/systemone.ts",
];

/** The hosted transport, relative to the package root. */
const HOSTED_TRANSPORT = "src/llm/decision/transports/systemone.ts";

/** Every name the decision barrel exports at runtime. Adding one is a deliberate edit of this list. */
const DECISION_RUNTIME_EXPORTS: readonly string[] = [
  "DECISION_CLIENT_FAULT_STAGES",
  "DECISION_FAULTS",
  "DECISION_ROUTES",
  "DECISION_UNAVAILABLE_CODES",
  "DecisionAdmissionError",
  "DecisionCallError",
  "DecisionClientFaultError",
  "DecisionCredentialError",
  "DecisionRequestInvalidError",
  "DecisionResponseFormatError",
  "DecisionRouteMismatchError",
  "DecisionRouteUnavailableError",
  "DecisionTimeoutError",
  "DecisionTransportError",
  "callDecisionModel",
  "configureDecisionClient",
  "decisionBreakerKey",
  "decisionBreakers",
  "decisionRouteAdmission",
  "decisionRouteDeclaration",
  "decisionRouteTable",
  "decisionRouteViolations",
  "decisionUsageOf",
  "decodeDecisionResponse",
  "encodeDecisionRequest",
  "listDecisionRoutes",
];

/** Every name the LLM barrel exported at runtime before the decision client hung off it. */
const GENERATIVE_RUNTIME_EXPORTS: readonly string[] = [
  "ChainExhaustedError",
  "CircuitBreakerRegistry",
  "DirectTransportRefusedError",
  "EQUIVALENT_SEPARATOR",
  "GatewayResponseError",
  "GatewayResponseUnreadableError",
  "GatewayUnreachableError",
  "LIVE_BREAKER_PATH",
  "LLM_ATTEMPT_FAILURE_CLASSES",
  "LegLatencyTracker",
  "LlmDeadlineExceededError",
  "LlmResponseFormatError",
  "NoServableRouteError",
  "RateGuardTimeoutError",
  "SERVED_MODEL_HEADER",
  "SERVED_PROVIDER_HEADER",
  "SchemaRetryExhaustedError",
  "StreamProviderError",
  "StreamTruncatedError",
  "ToolChoiceIgnoredError",
  "UnknownAliasError",
  "UnsupportedCapabilityError",
  "assertToolChoiceHonoured",
  "buildRetryPrompt",
  "callLLMByAlias",
  "callWithValidation",
  "closedIncumbentLeg",
  "collectStream",
  "configureLlmClient",
  "createDirectTransport",
  "createGatewayTransport",
  "estimatePromptTokens",
  "gatewayModelNameFor",
  "guardSnapshots",
  "hasDuplicateHeadroom",
  "isSameReportedModel",
  "legBudgetMs",
  "limitsFor",
  "limitsInventory",
  "listAliases",
  "llmAliases",
  "llmBreakers",
  "llmLatencyTracker",
  "modelClassOf",
  "modelClassRelationOf",
  "normaliseAnthropicStream",
  "normaliseOpenAiStream",
  "normaliseParams",
  "normaliseStream",
  "orderedRoutes",
  "resetProviderGuards",
  "resolveChain",
  "resolveDefaultDirectCaller",
  "routeKeyFor",
  "routeSupports",
  "routeTable",
  "servedModelOf",
  "sumUsage",
  "tailLatencyViolations",
  "withProviderGuards",
];

/** The generative aliases, which no decision route is one of. */
const GENERATIVE_ALIASES: readonly string[] = [
  "llm.agentic",
  "llm.decide",
  "llm.extract",
  "llm.fast",
  "llm.judge",
  "llm.reason",
];

/** What every decision route's name begins with. */
const DECISION_ROUTE_PREFIX = "dm.";

/** Temporary trees made by a test, removed after it. */
const temporaryTrees: string[] = [];

afterEach(() => {
  for (const tree of temporaryTrees.splice(0)) {
    rmSync(tree, { recursive: true, force: true });
  }
});

/**
 * Every TypeScript source under a directory, recursively.
 *
 * @param dir Absolute path of the directory.
 * @returns Absolute paths of the `.ts` files in it, sorted.
 */
function sourcesUnder(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return sourcesUnder(path);
      }
      return entry.name.endsWith(".ts") ? [path] : [];
    })
    .sort();
}

/** One decision source: where it is, and its text. */
interface DecisionSource {
  /** Path relative to the package root. */
  readonly path: string;
  readonly text: string;
}

/**
 * The decision sources as they are in the tree.
 *
 * @returns Every `.ts` file under the decision directory.
 */
function decisionSources(): readonly DecisionSource[] {
  return sourcesUnder(join(UTILS_ROOT, DECISION_DIR)).map((path) => ({
    path: relative(UTILS_ROOT, path),
    text: readFileSync(path, "utf8"),
  }));
}

/**
 * Visit every node of a source file's syntax tree.
 *
 * @param source The source text.
 * @param visit Called with each node.
 */
function eachNode(source: string, visit: (node: ts.Node) => void): void {
  const file = ts.createSourceFile("subject.ts", source, ts.ScriptTarget.Latest, true);
  const walk = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, walk);
  };
  walk(file);
}

/**
 * Every piece of literal text a source holds: string literals, the text of
 * templates between their substitutions, and regular expressions. Comments
 * are not literals and are not read.
 *
 * @param source The source text.
 * @returns The literal texts.
 */
function literalTextsOf(source: string): readonly string[] {
  const texts: string[] = [];
  eachNode(source, (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      texts.push(node.text);
    }
  });
  return texts;
}

/**
 * Every module a source names: in an import, in a re-export, and in a call
 * that loads one while the program runs.
 *
 * @param source The source text.
 * @returns The module specifiers.
 */
function moduleSpecifiersOf(source: string): readonly string[] {
  const specifiers: string[] = [];
  eachNode(source, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteralLike(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const loads =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require");
      const [first] = node.arguments;
      if (loads && first !== undefined && ts.isStringLiteralLike(first)) {
        specifiers.push(first.text);
      }
    }
  });
  return specifiers;
}

/**
 * The vendor names the route table holds: each hosted provider's host and the
 * domain it sits under, and the family every pinned model id belongs to.
 *
 * Read from the table, so a re-pinned model or a moved host is searched for
 * under its new name without an edit here.
 *
 * @returns The texts no decision source may hold as a literal, in lower case.
 */
function vendorNames(): readonly string[] {
  const names = new Set<string>();
  for (const provider of Object.values(decisionRouteTable.providers)) {
    if (provider.api_style !== "systemone") {
      continue;
    }
    for (const url of [provider.base_url, provider.docs_url ?? null]) {
      if (url !== null) {
        const host = new URL(url).hostname;
        names.add(host);
        names.add(host.split(".").slice(-2).join("."));
      }
    }
  }
  for (const route of Object.values(decisionRouteTable.routes)) {
    if (route.served_by === "utils") {
      for (const modelId of [route.version_pin, route.expected_served_model]) {
        names.add(modelId);
        names.add(modelId.slice(0, modelId.indexOf("-") + 1));
      }
    }
  }
  return [...names].map((name) => name.toLowerCase());
}

/**
 * The literals of a source that hold a vendor name.
 *
 * @param source The source text.
 * @returns The offending literals.
 */
function vendorLiteralsIn(source: string): readonly string[] {
  const names = vendorNames();
  return literalTextsOf(source).filter((text) => names.some((name) => text.toLowerCase().includes(name)));
}

/**
 * The modules a source names that are not files beside it.
 *
 * @param source The source text.
 * @returns The specifiers that are not relative paths.
 */
function packageImportsIn(source: string): readonly string[] {
  return moduleSpecifiersOf(source).filter((specifier) => !specifier.startsWith("./") && !specifier.startsWith("../"));
}

/**
 * Run the build verifier's source checks in a package root.
 *
 * @param root The root holding the verifier and the sources.
 * @returns The exit status and what the verifier wrote.
 */
function runVerifier(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(root, VERIFIER), REACHABILITY_MODE], {
    cwd: root,
    encoding: "utf8",
    timeout: VERIFIER_TIMEOUT_MS,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Run the verifier's source checks on a copy of the tree with one file changed.
 *
 * The verifier resolves its inputs against its own location, so a copy of it
 * beside a copy of the sources reads the copy.
 *
 * @param file The file to change, relative to the package root.
 * @param edit Returns the file's new text from its old one.
 * @returns The exit status and what the verifier wrote.
 */
function runVerifierOnEditedCopy(
  file: string,
  edit: (text: string) => string,
): { status: number | null; stdout: string; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), "llm-public-surface-"));
  temporaryTrees.push(root);
  for (const path of [VERIFIER, PACKAGE_ENTRY]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(UTILS_ROOT, path), join(root, path));
  }
  cpSync(join(UTILS_ROOT, "src/llm"), join(root, "src/llm"), { recursive: true });
  const before = readFileSync(join(root, file), "utf8");
  const after = edit(before);
  if (after === before) {
    throw new Error(`the edit left ${file} unchanged, so the run would say nothing`);
  }
  writeFileSync(join(root, file), after);
  return runVerifier(root);
}

describe("the public surface of the decision client", () => {
  it("the llm barrel exports the decision client and not the transport", () => {
    const exported: Readonly<Record<string, unknown>> = llm;
    const fromTheDecisionBarrel: Readonly<Record<string, unknown>> = decision;

    expect(Object.keys(fromTheDecisionBarrel).sort()).toEqual([...DECISION_RUNTIME_EXPORTS].sort());
    for (const name of DECISION_RUNTIME_EXPORTS) {
      expect(exported[name], name).toBeDefined();
      expect(exported[name], name).toBe(fromTheDecisionBarrel[name]);
    }
    expect(typeof exported.callDecisionModel).toBe("function");
    expect(typeof exported.configureDecisionClient).toBe("function");

    expect("createSystemOneTransport" in exported).toBe(false);
    expect(Object.keys(exported).filter((name) => /systemone/i.test(name))).toEqual([]);
  });

  it("reaches the package root through one line of the llm barrel", () => {
    const barrel = readFileSync(join(UTILS_ROOT, LLM_BARREL), "utf8");
    const entry = readFileSync(join(UTILS_ROOT, PACKAGE_ENTRY), "utf8");

    expect(barrel.split("\n").filter((line) => line.trim() === DECISION_BARREL_LINE)).toHaveLength(1);
    expect(entry).toContain('export * from "./llm";');
  });

  it("no decision source holds a vendor model id or host as a literal", () => {
    const sources = decisionSources();
    expect(sources.map(({ path }) => path)).toEqual(expect.arrayContaining([...REQUIRED_REACHABLE]));
    expect(vendorNames()).toEqual(expect.arrayContaining(["api.typesafe.ai", "typesafe.ai", "jev-1.13.0", "jev-"]));

    for (const { path, text } of sources) {
      expect(vendorLiteralsIn(text), path).toEqual([]);
    }

    // The search finds what it looks for, in each form a literal takes.
    expect(vendorLiteralsIn('const baseUrl = "https://API.typesafe.ai";')).toHaveLength(1);
    expect(vendorLiteralsIn("const url = `https://api.typesafe.ai/${path}`;")).toHaveLength(1);
    expect(vendorLiteralsIn("const model = 'jev-latest';")).toHaveLength(1);
    expect(vendorLiteralsIn("const pinned = /^jev-\\d/;")).toHaveLength(1);
    expect(vendorLiteralsIn("// a comment may say api.typesafe.ai and jev-1.13.0\nconst n = 1;")).toEqual([]);
  });

  it("the decision sources import no package", () => {
    const sources = decisionSources();
    expect(sources.length).toBeGreaterThanOrEqual(REQUIRED_REACHABLE.length);

    for (const { path, text } of sources) {
      expect(packageImportsIn(text), path).toEqual([]);
    }
    expect(sources.flatMap(({ text }) => moduleSpecifiersOf(text)).length).toBeGreaterThan(sources.length);

    // The search finds each way a source can name a package.
    expect(packageImportsIn('import TypeSafe from "typesafe";')).toEqual(["typesafe"]);
    expect(packageImportsIn('import type { SystemOne } from "typesafe/resources";')).toEqual(["typesafe/resources"]);
    expect(packageImportsIn('export { TypeSafe } from "typesafe";')).toEqual(["typesafe"]);
    expect(packageImportsIn('const sdk = await import("typesafe");')).toEqual(["typesafe"]);
    expect(packageImportsIn('const sdk = require("typesafe");')).toEqual(["typesafe"]);
    expect(packageImportsIn('import { readFileSync } from "node:fs";')).toEqual(["node:fs"]);
    expect(packageImportsIn('import { limitsFor } from "../rate-guard";')).toEqual([]);
  });

  it("the generative client is untouched", () => {
    expect(listAliases()).toEqual(GENERATIVE_ALIASES);
    const decisionProviders = Object.keys(decisionRouteTable.providers);
    expect(decisionProviders).toEqual(expect.arrayContaining(["typesafe"]));

    for (const name of [...Object.keys(routeTable.aliases), ...Object.keys(routeTable.providers)]) {
      expect(name.startsWith(DECISION_ROUTE_PREFIX), name).toBe(false);
      expect(decisionProviders, name).not.toContain(name);
    }
    for (const route of Object.keys(decisionRouteTable.routes)) {
      expect(route.startsWith(DECISION_ROUTE_PREFIX), route).toBe(true);
      expect(GENERATIVE_ALIASES).not.toContain(route);
    }

    const exported: Readonly<Record<string, unknown>> = llm;
    const generative = Object.keys(exported).filter((name) => !DECISION_RUNTIME_EXPORTS.includes(name));
    expect(generative.sort()).toEqual([...GENERATIVE_RUNTIME_EXPORTS].sort());
    expect(decision.decisionBreakers()).not.toBe(llmBreakers());
  });
});

describe("the build verifier's source checks", () => {
  it("the build verifier accepts the tree", () => {
    const result = runVerifier(UTILS_ROOT);

    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(REACHABILITY_OK);
    expect(result.status).toBe(0);
  });

  it("fails when the barrel does not reach the decision client, naming each module left unchecked", () => {
    const result = runVerifierOnEditedCopy(LLM_BARREL, (text) => text.replace(DECISION_BARREL_LINE, ""));

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(REACHABILITY_OK);
    for (const required of REQUIRED_REACHABLE) {
      expect(result.stderr).toContain(`${required} is not reachable from ${LLM_BARREL}`);
    }
  });

  it("fails when the hosted transport statically imports a package", () => {
    const result = runVerifierOnEditedCopy(HOSTED_TRANSPORT, (text) =>
      text.replace('import type { BreakerFailureKind }', 'import TypeSafe from "typesafe";\nimport type { BreakerFailureKind }'),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${HOSTED_TRANSPORT} statically imports "typesafe"`);
  });
});
