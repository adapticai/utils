#!/usr/bin/env node
/**
 * Deterministic LLM call-site scanner (migration backlog W1-01).
 *
 * Emits the `llm-inventory.json` seed: every place code in engine, utils,
 * lumic-utils or backend-legacy can reach a language model, in the
 * authoritative Section-4 site schema.
 *
 * The scan is the audit's foundation, so it is built to be checkable rather
 * than merely runnable. Four self-verifying modes assert the properties the
 * W1-01 gate depends on — schema conformance, byte-level determinism, zero
 * false negatives against a hand-enumerated site list, and that every
 * adapter-forcing capability actually forces an adapter. Each prints its token
 * only after every assertion in that mode has passed.
 *
 * Output never carries a timestamp, an absolute path, or a hostname: an
 * artefact that changes when nothing changed cannot be diffed, and a diff is
 * how this inventory will be reviewed.
 *
 * Usage:
 *   node scripts/scan-llm-inventory.mjs                 # inventory JSON to stdout
 *   node scripts/scan-llm-inventory.mjs --out <path>    # inventory JSON to a file
 *   node scripts/scan-llm-inventory.mjs --validate-only
 *   node scripts/scan-llm-inventory.mjs --determinism-check
 *   node scripts/scan-llm-inventory.mjs --recall-check
 *   node scripts/scan-llm-inventory.mjs --capability-check
 *   node scripts/scan-llm-inventory.mjs --summary       # human-readable roll-up
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const UTILS_ROOT = path.resolve(SCRIPT_DIR, "..");
const MONO_ROOT = path.resolve(UTILS_ROOT, "..");
const CORE_DIR = path.join(SCRIPT_DIR, "inventory");

/** Repositories in migration scope, sorted so the emitted `repos` list is stable. */
const REPOS = ["backend-legacy", "engine", "lumic-utils", "utils"];

/** Top-level directories walked inside each repository. */
const SCAN_SUBDIRS = ["src", "scripts"];

/** Recorded in the artefact so a stale file is traceable to its producer. */
const GENERATOR = "utils/scripts/scan-llm-inventory.mjs";

/** Revision of the emitted document shape; must match the JSON Schema's const. */
const SCHEMA_VERSION = 1;

/** Exactly the Section-4 keys, sorted. Any site differing from this fails --validate-only. */
const REQUIRED_SITE_KEYS = [
  "alias",
  "criticality",
  "eval_gate",
  "features",
  "latency_class",
  "model_current",
  "monthly_tokens",
  "needs_adapter",
  "site_id",
  "status",
];

/**
 * Directory withheld by the recall positive control.
 *
 * A gate that has never been observed to fail is not evidence. The control
 * removes a directory known to contain several enumerated sites and asserts the
 * recall check then reports them missing, proving the check can distinguish a
 * complete scan from an incomplete one.
 */
const RECALL_CONTROL_DIR = "lumic-utils/src/functions";

const TOKENS = {
  written: "INVENTORY_WRITTEN",
  schema: "INVENTORY_SCHEMA_OK",
  determinism: "INVENTORY_DETERMINISTIC",
  recall: "INVENTORY_RECALL_OK",
  capabilities: "INVENTORY_CAPABILITIES_OK",
};

/**
 * Load the TypeScript detector core into this ESM script.
 *
 * The detector logic is TypeScript because it is unit-tested and type-checked
 * alongside the rest of `utils`; this script is `.mjs` because it must run
 * under a bare `node` with no loader flags. The two are bridged by transpiling
 * the core once into a content-addressed temp directory, so an unchanged core
 * is compiled once and the compiled form can never drift from the source.
 *
 * @returns {Promise<Record<string, unknown>>} The core module namespace.
 */
async function loadDetectorCore() {
  const names = fs
    .readdirSync(CORE_DIR)
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const sources = names.map((name) => ({
    name,
    text: fs.readFileSync(path.join(CORE_DIR, name), "utf8"),
  }));

  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex")
    .slice(0, 16);
  // Compiled beside the package's own dependencies rather than in the system
  // temp directory, so the emitted modules resolve `typescript` through normal
  // Node resolution instead of needing their specifiers rewritten.
  const outDir = path.join(
    UTILS_ROOT,
    "node_modules",
    ".cache",
    "adaptic-llm-inventory",
    digest,
  );
  const entry = path.join(outDir, "index.mjs");

  if (!fs.existsSync(entry)) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const source of sources) {
      const emitted = ts.transpileModule(source.text, {
        fileName: source.name,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          isolatedModules: true,
        },
      }).outputText;
      fs.writeFileSync(
        path.join(outDir, source.name.replace(/\.ts$/u, ".mjs")),
        addModuleExtensions(emitted),
        "utf8",
      );
    }
  }

  return import(pathToFileURL(entry).href);
}

/**
 * Give relative specifiers the `.mjs` extension Node's ESM resolver requires.
 *
 * @param {string} code - Transpiled module source.
 * @returns {string} The same source with relative specifiers made explicit.
 */
function addModuleExtensions(code) {
  return code.replace(
    /(\bfrom\s*["'])(\.\.?\/[^"']+)(["'])/gu,
    (match, prefix, specifier, suffix) =>
      /\.(mjs|json)$/u.test(specifier)
        ? match
        : `${prefix}${specifier}.mjs${suffix}`,
  );
}

/**
 * Read the alias route table, the authoring surface for providers and aliases.
 *
 * Key names and alias names come from the route table rather than being
 * duplicated in the scanner, so adding a provider extends the scan on its own.
 *
 * @returns {{ apiKeyEnvVars: string[], aliasNames: string[] }} Route-derived detector inputs.
 */
function readRouteTable() {
  const routePath = path.join(UTILS_ROOT, "src", "llm", "alias-routes.json");
  const table = JSON.parse(fs.readFileSync(routePath, "utf8"));
  const apiKeyEnvVars = Object.values(table.providers ?? {})
    .map((provider) => provider.api_key_env)
    .filter((name) => typeof name === "string" && name.length > 0);
  return {
    apiKeyEnvVars,
    aliasNames: Object.keys(table.aliases ?? {}),
  };
}

/**
 * Enumerate candidate files under one repository, in a stable order.
 *
 * Directory entries are sorted before descent so two runs over the same tree
 * visit files in the same sequence; ordering is what makes the emitted array
 * byte-identical rather than merely equivalent.
 *
 * @param {string} repo - Repository name.
 * @param {(repo: string, relativePath: string) => { kind: string, reason?: string }} classifyScope - Scope rule.
 * @param {string[]} withheldDirs - Repo-qualified directories to skip (recall control only).
 * @returns {{ scan: {relativePath: string, absolutePath: string}[], registries: {path: string, reason: string}[] }}
 */
function collectFiles(repo, classifyScope, withheldDirs) {
  const scan = [];
  const registries = [];
  const repoRoot = path.join(MONO_ROOT, repo);

  const descend = (absoluteDir) => {
    const entries = fs
      .readdirSync(absoluteDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = path
        .relative(repoRoot, absolutePath)
        .split(path.sep)
        .join("/");
      const qualified = `${repo}/${relativePath}`;
      if (withheldDirs.includes(qualified)) {
        continue;
      }
      if (entry.isDirectory()) {
        if (classifyScope(repo, `${relativePath}/probe.ts`).kind === "excluded") {
          continue;
        }
        descend(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const decision = classifyScope(repo, relativePath);
      if (decision.kind === "registry") {
        registries.push({ path: qualified, reason: decision.reason });
      } else if (decision.kind === "scan") {
        scan.push({ relativePath, absolutePath });
      }
    }
  };

  for (const subdir of SCAN_SUBDIRS) {
    const root = path.join(repoRoot, subdir);
    if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
      descend(root);
    }
  }

  return { scan, registries };
}

/**
 * Run a full scan and build the inventory document.
 *
 * @param {Record<string, any>} core - The detector core module namespace.
 * @param {{ withheldDirs?: string[] }} [options] - Scan options.
 * @returns {{ document: object, filesScanned: number }} The document and a file count for reporting.
 */
function runScan(core, options = {}) {
  const withheldDirs = options.withheldDirs ?? [];
  const route = readRouteTable();
  const config = core.buildDetectorConfig(route.apiKeyEnvVars, route.aliasNames);

  const sites = [];
  const registries = [];
  let filesScanned = 0;

  for (const repo of REPOS) {
    const repoRoot = path.join(MONO_ROOT, repo);
    if (!fs.existsSync(repoRoot)) {
      throw new Error(`repository not found at ${repo}; scan scope is incomplete`);
    }
    const collected = collectFiles(repo, core.classifyScope, withheldDirs);
    registries.push(...collected.registries);
    for (const file of collected.scan) {
      filesScanned += 1;
      const source = fs.readFileSync(file.absolutePath, "utf8");
      const result = core.scanSource({
        repo,
        path: file.relativePath,
        source,
        config,
      });
      sites.push(...core.buildSitesForFile(result));
    }
  }

  // The declared registry list is authoritative even for files that are not on
  // disk in a scanned subtree (the route table itself sits outside `src`), so
  // any declared registry not reached by the walk is still recorded.
  for (const declared of core.REGISTRY_FILES) {
    if (!registries.some((entry) => entry.path === declared.path)) {
      registries.push({ path: declared.path, reason: declared.reason });
    }
  }
  registries.sort((left, right) => left.path.localeCompare(right.path));

  const document = {
    schema_version: SCHEMA_VERSION,
    heuristics_version: core.HEURISTICS_VERSION,
    generator: GENERATOR,
    repos: [...REPOS].sort(),
    sites: core.sortSites(sites),
    registries,
  };

  return { document, filesScanned };
}

/** Serialize the document the one way every mode compares it. */
function serialize(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Assert schema conformance and exact key parity for every site.
 *
 * The JSON Schema already forbids extra keys, but the key-set equality check is
 * asserted independently: a schema and the code that produced it can both be
 * wrong in the same direction, and the Section-4 key list is the contract this
 * artefact exists to satisfy.
 *
 * @param {Record<string, any>} core - Detector core namespace.
 * @param {object} document - The inventory document.
 * @returns {string[]} Every violation found.
 */
function assertSchema(core, document) {
  const schema = JSON.parse(
    fs.readFileSync(path.join(CORE_DIR, "llm-inventory.schema.json"), "utf8"),
  );
  const errors = [...core.validateAgainstSchema(document, schema)];

  document.sites.forEach((site, index) => {
    const keys = Object.keys(site).sort();
    if (JSON.stringify(keys) !== JSON.stringify(REQUIRED_SITE_KEYS)) {
      errors.push(
        `sites[${index}] (${site.site_id}): key set ${JSON.stringify(keys)} is not the Section-4 key set`,
      );
    }
  });

  return errors;
}

/**
 * Check every hand-enumerated site was found.
 *
 * Recall is asserted at file granularity: the claim under test is "this file
 * reaches a model and the scan knows it". Line numbers move with unrelated
 * edits, so pinning them would make the gate fail for reasons that are not
 * recall failures.
 *
 * @param {object} document - The inventory document.
 * @param {{ sites: { repo: string, path: string }[] }} known - The hand-enumerated list.
 * @returns {string[]} Enumerated sites that the scan did not find.
 */
function findMissingKnownSites(document, known) {
  const found = new Set(
    document.sites.map((site) => site.site_id.slice(0, site.site_id.lastIndexOf("#L"))),
  );
  return known.sites
    .map((entry) => `${entry.repo}/${entry.path}`)
    .filter((qualified) => !found.has(qualified))
    .sort();
}

/** Read the hand-enumerated known-site list. */
function readKnownSites() {
  return JSON.parse(fs.readFileSync(path.join(CORE_DIR, "known-sites.json"), "utf8"));
}

/**
 * Prove every Section-3 signal, and only those, drives `needs_adapter`.
 *
 * Two independent proofs run. The predicate proof sets one signal at a time on
 * a synthetic signal record — this is the claim gate G5 needs. The fixture
 * proof parses a synthetic source per signal and asserts the detector both
 * raises that signal and marks the resulting site `needs_adapter`, which is the
 * claim that detection and the predicate are actually connected.
 *
 * @param {Record<string, any>} core - Detector core namespace.
 * @returns {string[]} Every violation found.
 */
function assertCapabilities(core) {
  const errors = [];
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(CORE_DIR, "capability-fixtures.json"), "utf8"),
  );
  const route = readRouteTable();
  const config = core.buildDetectorConfig(route.apiKeyEnvVars, route.aliasNames);

  const allFalse = Object.fromEntries(
    core.ADAPTER_FORCING_SIGNALS.map((signal) => [signal, false]),
  );
  if (core.needsAdapter(allFalse)) {
    errors.push("needsAdapter returned true with every signal false");
  }
  for (const signal of core.ADAPTER_FORCING_SIGNALS) {
    if (!core.needsAdapter({ ...allFalse, [signal]: true })) {
      errors.push(`signal "${signal}" alone does not drive needs_adapter`);
    }
  }

  const scanFixture = (name, source) => {
    const result = core.scanSource({
      repo: "engine",
      path: `src/services/signals/${name}.ts`,
      source,
      config,
    });
    const sites = core.buildSitesForFile(result);
    if (sites.length === 0) {
      errors.push(`fixture "${name}" produced no site, so it proves nothing`);
    }
    return { result, sites };
  };

  for (const signal of core.ADAPTER_FORCING_SIGNALS) {
    const source = fixtures.signals[signal];
    if (typeof source !== "string") {
      errors.push(`no fixture defined for signal "${signal}"`);
      continue;
    }
    const { result, sites } = scanFixture(signal, source);
    if (result.adapterSignals[signal] !== true) {
      errors.push(`fixture for "${signal}" did not raise that signal`);
    }
    if (sites.some((site) => site.needs_adapter !== true)) {
      errors.push(`fixture for "${signal}" produced a site with needs_adapter false`);
    }
  }

  const baseline = scanFixture("baseline", fixtures.baseline);
  if (baseline.sites.some((site) => site.needs_adapter !== false)) {
    errors.push("baseline fixture with no Section-3 signal was marked needs_adapter");
  }

  return errors;
}

/** Parse argv into a mode plus its options. */
function parseArgs(argv) {
  const options = { mode: "emit", out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      index += 1;
      options.out = argv[index];
      if (options.out === undefined) {
        throw new Error("--out requires a path");
      }
    } else if (arg === "--validate-only") {
      options.mode = "validate";
    } else if (arg === "--determinism-check") {
      options.mode = "determinism";
    } else if (arg === "--recall-check") {
      options.mode = "recall";
    } else if (arg === "--capability-check") {
      options.mode = "capabilities";
    } else if (arg === "--summary") {
      options.mode = "summary";
    } else if (arg === "--help" || arg === "-h") {
      options.mode = "help";
    } else {
      throw new Error(`unrecognised argument "${arg}"`);
    }
  }
  return options;
}

/** Fail loudly: print every violation, then exit non-zero without a token. */
function fail(label, errors) {
  console.error(`${label} FAILED with ${errors.length} violation(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exitCode = 1;
}

/** Human-readable roll-up used to report the real scan. */
function printSummary(document, filesScanned) {
  const perRepo = new Map();
  for (const site of document.sites) {
    const repo = site.site_id.slice(0, site.site_id.indexOf("/"));
    perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
  }
  const files = new Set(
    document.sites.map((site) => site.site_id.slice(0, site.site_id.lastIndexOf("#L"))),
  );
  const adapters = document.sites.filter((site) => site.needs_adapter);

  console.error(`files parsed:       ${filesScanned}`);
  console.error(`sites:              ${document.sites.length}`);
  console.error(`distinct files:     ${files.size}`);
  console.error(`needs_adapter:      ${adapters.length}`);
  console.error(`registries:         ${document.registries.length}`);
  console.error("per-repo sites:");
  for (const repo of [...perRepo.keys()].sort()) {
    console.error(`  ${repo}: ${perRepo.get(repo)}`);
  }

  const rank = { "trading-adjacent": 0, ops: 1, internal: 2 };
  const latencyRank = { "hot-path": 0, background: 1, batch: 2 };
  // One entry per file: a ranked list that spends all ten rows on the import
  // lines of a single module tells the reader nothing they could not get from
  // the file count.
  const ranked = [...document.sites].sort(
    (left, right) =>
      rank[left.criticality] - rank[right.criticality] ||
      latencyRank[left.latency_class] - latencyRank[right.latency_class] ||
      Number(right.needs_adapter) - Number(left.needs_adapter) ||
      right.features.length - left.features.length ||
      left.site_id.localeCompare(right.site_id),
  );
  const seenFiles = new Set();
  const top = [];
  for (const site of ranked) {
    const file = site.site_id.slice(0, site.site_id.lastIndexOf("#L"));
    if (seenFiles.has(file)) {
      continue;
    }
    seenFiles.add(file);
    top.push(site);
    if (top.length === 10) {
      break;
    }
  }
  console.error("top 10 files by criticality:");
  for (const site of top) {
    console.error(
      `  ${site.site_id} [${site.criticality}/${site.latency_class}] adapter=${site.needs_adapter} features=${site.features.join("+") || "none"}`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "help") {
    console.log(
      [
        "scan-llm-inventory - deterministic LLM call-site scan (W1-01)",
        "",
        "  --out <path>          write the inventory JSON to a file",
        "  --validate-only       assert Section-4 schema conformance",
        "  --determinism-check   assert two scans are byte-identical",
        "  --recall-check        assert zero false negatives, with a positive control",
        "  --capability-check    assert each Section-3 signal forces needs_adapter",
        "  --summary             human-readable roll-up on stderr",
      ].join("\n"),
    );
    return;
  }

  const core = await loadDetectorCore();

  if (options.mode === "capabilities") {
    const errors = assertCapabilities(core);
    if (errors.length > 0) {
      fail("--capability-check", errors);
      return;
    }
    console.log(TOKENS.capabilities);
    return;
  }

  if (options.mode === "determinism") {
    const first = serialize(runScan(core).document);
    const second = serialize(runScan(core).document);
    if (first !== second) {
      fail("--determinism-check", ["two scans of an unchanged tree differed"]);
      return;
    }
    console.error(`bytes: ${first.length} (identical across two runs)`);
    console.log(TOKENS.determinism);
    return;
  }

  if (options.mode === "recall") {
    const known = readKnownSites();
    const full = runScan(core);
    const missing = findMissingKnownSites(full.document, known);
    if (missing.length > 0) {
      fail(
        "--recall-check",
        missing.map((entry) => `enumerated site not found by the scan: ${entry}`),
      );
      return;
    }

    const control = runScan(core, { withheldDirs: [RECALL_CONTROL_DIR] });
    const controlMissing = findMissingKnownSites(control.document, known);
    console.error(
      `positive control: withheld ${RECALL_CONTROL_DIR}; recall check reported ${controlMissing.length} missing site(s):`,
    );
    for (const entry of controlMissing) {
      console.error(`  - ${entry}`);
    }
    if (controlMissing.length === 0) {
      fail("--recall-check", [
        `positive control did not fail: withholding ${RECALL_CONTROL_DIR} left the check green, so the check cannot detect a gap`,
      ]);
      return;
    }

    console.error(`checked ${known.sites.length} enumerated site(s) against the full scan`);
    console.log(TOKENS.recall);
    return;
  }

  const { document, filesScanned } = runScan(core);

  if (options.mode === "validate") {
    const errors = assertSchema(core, document);
    if (errors.length > 0) {
      fail("--validate-only", errors.slice(0, 50));
      return;
    }
    console.error(`validated ${document.sites.length} site(s) against llm-inventory.schema.json`);
    console.log(TOKENS.schema);
    return;
  }

  if (options.mode === "summary") {
    printSummary(document, filesScanned);
    return;
  }

  const payload = serialize(document);
  if (options.out === null) {
    process.stdout.write(payload);
    return;
  }
  fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  fs.writeFileSync(path.resolve(options.out), payload, "utf8");
  printSummary(document, filesScanned);
  console.log(TOKENS.written);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
