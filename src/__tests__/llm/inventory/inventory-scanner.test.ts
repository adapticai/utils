/**
 * Tests for the LLM call-site inventory detectors (backlog W1-01).
 *
 * The scan's acceptance gate is "zero false negatives", so the suite is built
 * around a detector-by-detector proof against synthetic sources rather than
 * around a snapshot of the real tree: a snapshot passes for the wrong reasons
 * the moment the tree changes, and proves nothing about what the detectors can
 * see. Each exclusion is asserted with the same discipline, because a silently
 * widened exclusion is how an inventory develops a blind spot.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ADAPTER_FORCING_SIGNALS,
  BASELINE_PROVIDER_KEY_ENV_VARS,
  buildDetectorConfig,
  buildSitesForFile,
  classifyPath,
  classifyScope,
  CONSERVATIVE_DEFAULT,
  detectAdapterSignals,
  detectFeatures,
  emptySourceMarkers,
  HEURISTICS_VERSION,
  isVendorModelLiteral,
  isVendorSdkModule,
  needsAdapter,
  REGISTRY_FILES,
  scanSource,
  sortSites,
  validateAgainstSchema,
} from "../../../../scripts/inventory";
import type {
  AdapterSignals,
  DetectorConfig,
  FileScanResult,
  InventorySite,
  JsonSchema,
  JsonValue,
} from "../../../../scripts/inventory";

/** Exactly the authoritative Section-4 keys, sorted. */
const SECTION_4_KEYS = [
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

function readDataFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function fixture(name: string): string {
  return readDataFile(`./fixtures/${name}`);
}

const CONFIG: DetectorConfig = buildDetectorConfig(
  ["ANTHROPIC_API_KEY", "DEEPINFRA_API_KEY"],
  ["llm.reason", "llm.fast"],
);

function scan(
  fixtureName: string,
  repoPath = "src/services/signals/probe.ts",
  repo = "engine",
): FileScanResult {
  return scanSource({
    repo,
    path: repoPath,
    source: fixture(fixtureName),
    config: CONFIG,
  });
}

function anchorKinds(result: FileScanResult): string[] {
  return [...new Set(result.anchors.map((anchor) => anchor.kind))].sort();
}

function anchorDetails(result: FileScanResult): string[] {
  return result.anchors.map((anchor) => anchor.detail);
}

describe("SDK-import detection", () => {
  it("flags root and subpath vendor SDK imports and direct client construction", () => {
    const result = scan("sdk-imports.fixture.txt");
    expect(anchorKinds(result)).toContain("sdk_import");
    expect(anchorKinds(result)).toContain("sdk_construction");
    expect(anchorDetails(result)).toEqual(
      expect.arrayContaining([
        "openai",
        "openai/resources/chat",
        "@anthropic-ai/sdk",
        "OpenAI",
        "Anthropic",
      ]),
    );
  });

  it("treats a subpath of a vendor SDK as the same coupling as its root", () => {
    expect(isVendorSdkModule("openai")).toBe(true);
    expect(isVendorSdkModule("openai/resources/responses/responses")).toBe(true);
    expect(isVendorSdkModule("@anthropic-ai/sdk")).toBe(true);
    expect(isVendorSdkModule("openai-adjacent-helper")).toBe(false);
    expect(isVendorSdkModule("@adaptic/utils")).toBe(false);
  });
});

describe("shared-client entry-point detection", () => {
  it("flags an LLM binding from the shared package and ignores a non-LLM one", () => {
    const result = scan("lumic-entry.fixture.txt");
    const lumicAnchors = result.anchors.filter(
      (anchor) => anchor.kind === "lumic_entry_import",
    );
    expect(lumicAnchors.length).toBeGreaterThan(0);
    expect(lumicAnchors.map((anchor) => anchor.detail).join("|")).toContain(
      "PROVIDER_DEFAULT_MODELS",
    );
    expect(lumicAnchors.map((anchor) => anchor.detail).join("|")).not.toContain(
      "formatDate",
    );
  });

  it("flags the direct dotted call surface", () => {
    const result = scan("lumic-entry.fixture.txt");
    expect(anchorDetails(result)).toContain("lumic.llm.call");
  });
});

describe("first-party wrapper detection", () => {
  it("flags a wrapper import and a wrapper call reached through a collaborator", () => {
    const result = scan("wrapper-and-di-call.fixture.txt");
    expect(anchorKinds(result)).toEqual(
      expect.arrayContaining(["wrapper_import", "llm_call"]),
    );
    expect(anchorDetails(result)).toEqual(
      expect.arrayContaining(["callLLMWithValidation", "callLLMWithTools"]),
    );
  });
});

describe("vendor model-literal detection", () => {
  it("recognises every vendor family named in the migration scope", () => {
    const result = scan("model-literals.fixture.txt");
    const literals = result.anchors
      .filter((anchor) => anchor.kind === "model_literal")
      .map((anchor) => anchor.detail)
      .sort();
    expect(literals).toEqual(
      [
        "claude-haiku-4-5",
        "deepseek-v4-flash",
        "gemini-3.1-pro-preview",
        "glm-5.3",
        "gpt-5.4-nano",
        "gpt-oss-120b",
        "grok-4",
        "kimi-k3",
        "o3-mini",
        "o4-mini",
        "qwen3-max",
      ].sort(),
    );
  });

  it("does not match strings that merely start like a model id", () => {
    for (const notAModel of ["gptlike", "claudette", "o5", "deepsea-blue", "portfolio"]) {
      expect(isVendorModelLiteral(notAModel)).toBe(false);
    }
  });

  it("does not mistake a hyphenated service or checklist id for a model", () => {
    for (const notAModel of [
      "gpt-analysis-service",
      "claude-compliance",
      "gpt-cost-manager",
      "deepseek-client",
    ]) {
      expect(isVendorModelLiteral(notAModel)).toBe(false);
    }
    for (const model of ["deepseek-chat", "deepseek-reasoner", "gpt-5.4-nano"]) {
      expect(isVendorModelLiteral(model)).toBe(true);
    }
  });
});

describe("provider-key and alias detection", () => {
  it("flags a key from the baseline list and a key contributed by the route table", () => {
    const result = scan("provider-keys-and-alias.fixture.txt");
    const keys = result.anchors
      .filter((anchor) => anchor.kind === "provider_key_env")
      .map((anchor) => anchor.detail);
    expect(keys).toContain("ANTHROPIC_API_KEY");
    expect(keys).toContain("DEEPINFRA_API_KEY");
  });

  it("flags an alias literal so a re-scan shows migration progress, not a regression", () => {
    const result = scan("provider-keys-and-alias.fixture.txt");
    const aliases = result.anchors
      .filter((anchor) => anchor.kind === "alias_usage")
      .map((anchor) => anchor.alias);
    expect(aliases).toEqual(["llm.reason"]);
  });

  it("merges route-table keys with the baseline list, deduplicated and sorted", () => {
    const config = buildDetectorConfig(
      ["ZAI_API_KEY", "OPENAI_API_KEY"],
      ["llm.judge", "llm.judge"],
    );
    expect(config.providerKeyEnvVars).toEqual([...config.providerKeyEnvVars].sort());
    expect(config.providerKeyEnvVars).toContain("ZAI_API_KEY");
    expect(config.aliasNames).toEqual(["llm.judge"]);
    for (const baseline of BASELINE_PROVIDER_KEY_ENV_VARS) {
      expect(config.providerKeyEnvVars).toContain(baseline);
    }
    expect(
      config.providerKeyEnvVars.filter((key) => key === "OPENAI_API_KEY"),
    ).toHaveLength(1);
  });
});

describe("a file with no LLM surface", () => {
  it("produces no anchors and therefore no sites", () => {
    const result = scan("no-llm.fixture.txt");
    expect(result.anchors).toEqual([]);
    expect(buildSitesForFile(result)).toEqual([]);
  });
});

describe("capability detection", () => {
  it("detects all five schema capability flags on a site that uses them", () => {
    const result = scan("capabilities-full.fixture.txt");
    expect([...result.features].sort()).toEqual([
      "cache_control",
      "json_schema",
      "streaming",
      "tool_use",
      "vision",
    ]);
  });

  it("does not treat a bare `stream` property as streaming unless it is enabled", () => {
    const markers = emptySourceMarkers();
    const withNamedProperty = {
      ...markers,
      propertyNames: new Set(["stream"]),
    };
    expect(detectFeatures(withNamedProperty)).not.toContain("streaming");

    const withEnabledProperty = {
      ...markers,
      propertyNames: new Set(["stream"]),
      trueValuedProperties: new Set(["stream"]),
    };
    expect(detectFeatures(withEnabledProperty)).toContain("streaming");
  });
});

describe("the adapter-necessity predicate", () => {
  const allFalse: AdapterSignals = {
    cache_control: false,
    strict_json_schema: false,
    vision: false,
    context_over_threshold: false,
    provider_specific_streaming: false,
  };

  it("is false when no Section-3 signal is present", () => {
    expect(needsAdapter(allFalse)).toBe(false);
  });

  it.each(ADAPTER_FORCING_SIGNALS)("is driven to true by %s alone", (signal) => {
    expect(needsAdapter({ ...allFalse, [signal]: true })).toBe(true);
  });

  it("enumerates exactly the five Section-3 signals", () => {
    expect([...ADAPTER_FORCING_SIGNALS].sort()).toEqual([
      "cache_control",
      "context_over_threshold",
      "provider_specific_streaming",
      "strict_json_schema",
      "vision",
    ]);
  });
});

describe("adapter-signal detection from synthetic sources", () => {
  const fixtures = JSON.parse(
    readDataFile("../../../../scripts/inventory/capability-fixtures.json"),
  ) as { baseline: string; signals: Record<string, string> };

  it.each(ADAPTER_FORCING_SIGNALS)(
    "raises %s and marks the resulting site needs_adapter",
    (signal) => {
      const result = scanSource({
        repo: "engine",
        path: "src/services/signals/probe.ts",
        source: fixtures.signals[signal],
        config: CONFIG,
      });
      const sites = buildSitesForFile(result);
      expect(sites.length).toBeGreaterThan(0);
      expect(result.adapterSignals[signal]).toBe(true);
      expect(sites.every((site) => site.needs_adapter)).toBe(true);
    },
  );

  it("leaves needs_adapter false for a call with none of the five signals", () => {
    const result = scanSource({
      repo: "engine",
      path: "src/services/signals/probe.ts",
      source: fixtures.baseline,
      config: CONFIG,
    });
    const sites = buildSitesForFile(result);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((site) => site.needs_adapter)).toBe(false);
  });

  it("requires an explicit strict flag before a JSON-schema site forces an adapter", () => {
    const loose = emptySourceMarkers();
    const looseMarkers = { ...loose, stringLiterals: new Set(["json_schema"]) };
    const looseFeatures = detectFeatures(looseMarkers);
    expect(looseFeatures).toContain("json_schema");
    expect(detectAdapterSignals(looseMarkers, looseFeatures).strict_json_schema).toBe(
      false,
    );

    const strictMarkers = {
      ...looseMarkers,
      trueValuedProperties: new Set(["strict"]),
    };
    expect(
      detectAdapterSignals(strictMarkers, detectFeatures(strictMarkers))
        .strict_json_schema,
    ).toBe(true);
  });

  it("flags a declared context window above the portability threshold and not below it", () => {
    const base = emptySourceMarkers();
    const under = {
      ...base,
      numericProperties: new Map([["max_input_tokens", 200000]]),
    };
    expect(detectAdapterSignals(under, []).context_over_threshold).toBe(false);

    const over = {
      ...base,
      numericProperties: new Map([["max_input_tokens", 400000]]),
    };
    expect(detectAdapterSignals(over, []).context_over_threshold).toBe(true);
  });
});

describe("scope rules", () => {
  it.each([
    ["src/services/foo.test.ts", "file suffix"],
    ["src/services/foo.spec.ts", "file suffix"],
    ["src/types/foo.d.ts", "file suffix"],
    ["src/__tests__/foo.ts", "path segment"],
    ["src/services/__mocks__/foo.ts", "path segment"],
    ["src/services/fixtures/foo.ts", "path segment"],
    ["node_modules/openai/index.ts", "path segment"],
    ["dist/index.ts", "path segment"],
    ["coverage/report.ts", "path segment"],
    ["src/tests/foo.ts", "path prefix"],
    ["src/services/notes.md", "unparsed file extension"],
  ])("excludes %s", (candidate, expectedReason) => {
    const decision = classifyScope("engine", candidate);
    expect(decision.kind).toBe("excluded");
    if (decision.kind === "excluded") {
      expect(decision.reason).toContain(expectedReason);
    }
  });

  it("excludes the scanner's own sources so the instrument is not measured", () => {
    for (const own of [
      "scripts/inventory/detector-config.ts",
      "scripts/inventory/detectors.ts",
      "scripts/scan-llm-inventory.mjs",
    ]) {
      const decision = classifyScope("utils", own);
      expect(decision.kind).toBe("excluded");
      if (decision.kind === "excluded") {
        expect(decision.reason).toContain("scanner");
      }
    }
  });

  it("keeps the self-exclusion confined to the scanner, not to utils scripts at large", () => {
    expect(classifyScope("utils", "scripts/other-audit.mjs").kind).toBe("scan");
    expect(classifyScope("engine", "scripts/inventory/report.ts").kind).toBe("scan");
  });

  it("records a registry with a reason rather than dropping it silently", () => {
    for (const registry of REGISTRY_FILES) {
      const slash = registry.path.indexOf("/");
      const decision = classifyScope(
        registry.path.slice(0, slash),
        registry.path.slice(slash + 1),
      );
      expect(decision.kind).toBe("registry");
      if (decision.kind === "registry") {
        expect(decision.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("scans ordinary production sources", () => {
    expect(classifyScope("engine", "src/services/signals/analyzer.ts").kind).toBe("scan");
    expect(classifyScope("engine", "scripts/audit.mjs").kind).toBe("scan");
  });
});

describe("path heuristics", () => {
  it.each([
    ["engine", "src/backtest/simulators/llm/llm-cache.ts", "batch", "internal"],
    ["engine", "src/cli/run-shadow-replay.ts", "batch", "internal"],
    ["engine", "src/monitoring/llm-cost-metrics.ts", "background", "ops"],
    ["engine", "src/services/cost-governance/llm-cost-governor.ts", "background", "ops"],
    [
      "engine",
      "src/services/signal-monitoring/gpt-analysis-service.ts",
      "hot-path",
      "trading-adjacent",
    ],
    [
      "lumic-utils",
      "src/functions/llm-call.ts",
      "hot-path",
      "trading-adjacent",
    ],
  ])("classifies %s/%s as %s/%s", (repo, candidate, latency, criticality) => {
    const classification = classifyPath(repo, candidate);
    expect(classification.latencyClass).toBe(latency);
    expect(classification.criticality).toBe(criticality);
  });

  it("falls back to the strictest classification when no rule matches", () => {
    const classification = classifyPath("engine", "src/functions/unmapped-area.ts");
    expect(classification).toEqual(CONSERVATIVE_DEFAULT);
    expect(classification.latencyClass).toBe("hot-path");
    expect(classification.criticality).toBe("trading-adjacent");
  });

  it("publishes a heuristics version so a later pass can state what it overrode", () => {
    expect(HEURISTICS_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
  });
});

describe("site assembly", () => {
  const result = scan("lumic-entry.fixture.txt");
  const sites = buildSitesForFile(result);

  it("emits exactly the Section-4 key set and nothing else", () => {
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(Object.keys(site).sort()).toEqual(SECTION_4_KEYS);
    }
  });

  it("emits scanner-unknowable fields as unknown rather than as fabricated values", () => {
    for (const site of sites) {
      expect(site.monthly_tokens).toEqual({ in: 0, out: 0 });
      expect(site.eval_gate).toBeNull();
      expect(site.status).toBe("discovered");
    }
  });

  it("builds a site id of repo, path and line", () => {
    for (const site of sites) {
      expect(site.site_id).toMatch(/^engine\/src\/services\/signals\/probe\.ts#L[1-9]\d*$/u);
    }
  });

  it("emits one site per anchored line, not one per anchor", () => {
    const lines = new Set(result.anchors.map((anchor) => anchor.line));
    expect(sites).toHaveLength(lines.size);
  });

  it("carries the model literal only when the site's own line names one", () => {
    const literalResult = scan("model-literals.fixture.txt");
    const literalSites = buildSitesForFile(literalResult);
    expect(literalSites.every((site) => site.model_current !== null)).toBe(true);
    expect(sites.every((site) => site.model_current === null)).toBe(true);
  });

  it("orders sites by file then by line as a number", () => {
    const unordered: InventorySite[] = [10, 2, 1].map((line) => ({
      site_id: `engine/src/a.ts#L${line}`,
      model_current: null,
      features: [],
      latency_class: "hot-path",
      criticality: "trading-adjacent",
      monthly_tokens: { in: 0, out: 0 },
      alias: null,
      needs_adapter: false,
      eval_gate: null,
      status: "discovered",
    }));
    expect(sortSites(unordered).map((site) => site.site_id)).toEqual([
      "engine/src/a.ts#L1",
      "engine/src/a.ts#L2",
      "engine/src/a.ts#L10",
    ]);
  });
});

describe("the inventory JSON Schema and its validator", () => {
  const schema = JSON.parse(
    readDataFile("../../../../scripts/inventory/llm-inventory.schema.json"),
  ) as JsonSchema;

  const site: JsonValue = {
    site_id: "engine/src/services/signals/probe.ts#L12",
    model_current: "claude-haiku-4-5",
    features: ["json_schema"],
    latency_class: "hot-path",
    criticality: "trading-adjacent",
    monthly_tokens: { in: 0, out: 0 },
    alias: null,
    needs_adapter: false,
    eval_gate: null,
    status: "discovered",
  };

  const document = (override: Record<string, JsonValue>): JsonValue => ({
    schema_version: 1,
    heuristics_version: HEURISTICS_VERSION,
    generator: "utils/scripts/scan-llm-inventory.mjs",
    repos: ["engine"],
    sites: [site],
    registries: [{ path: "engine/src/config/model-token-limits.ts", reason: "table" }],
    ...override,
  });

  it("accepts a well-formed document", () => {
    expect(validateAgainstSchema(document({}), schema)).toEqual([]);
  });

  it("rejects a site carrying a key outside the Section-4 set", () => {
    const errors = validateAgainstSchema(
      document({ sites: [{ ...(site as Record<string, JsonValue>), owner: "team" }] }),
      schema,
    );
    expect(errors.join("\n")).toContain('unexpected key "owner"');
  });

  it("rejects a site missing a Section-4 key", () => {
    const { alias: _removed, ...withoutAlias } = site as Record<string, JsonValue>;
    const errors = validateAgainstSchema(document({ sites: [withoutAlias] }), schema);
    expect(errors.join("\n")).toContain('missing required key "alias"');
  });

  it("rejects a value outside an enum and a non-null eval_gate", () => {
    const badEnum = validateAgainstSchema(
      document({
        sites: [{ ...(site as Record<string, JsonValue>), criticality: "critical" }],
      }),
      schema,
    );
    expect(badEnum.join("\n")).toContain("is not one of");

    const seededGate = validateAgainstSchema(
      document({
        sites: [{ ...(site as Record<string, JsonValue>), eval_gate: "schema-valid" }],
      }),
      schema,
    );
    expect(seededGate.join("\n")).toContain("expected type null");
  });

  it("reports an unsupported schema keyword instead of ignoring it", () => {
    const errors = validateAgainstSchema("anything", { multipleOf: 2 });
    expect(errors.join("\n")).toContain("not supported by this validator");
  });
});

describe("the hand-enumerated known-site list", () => {
  const known = JSON.parse(readDataFile("../../../../scripts/inventory/known-sites.json")) as {
    sites: { repo: string; path: string; evidence: string }[];
  };

  it("names a repo, a path and the evidence for every entry", () => {
    expect(known.sites.length).toBeGreaterThan(0);
    for (const entry of known.sites) {
      expect(entry.repo.length).toBeGreaterThan(0);
      expect(entry.path.startsWith("src/")).toBe(true);
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
  });

  it("includes every entry point the migration backlog names by hand", () => {
    const qualified = known.sites.map((entry) => `${entry.repo}/${entry.path}`);
    for (const required of [
      "engine/src/utils/llm-validated-dispatch.ts",
      "engine/src/utils/llm-validated-call.ts",
      "engine/src/services/llm/cached-llm-client.ts",
      "engine/src/services/account-pipeline/model-router.ts",
      "engine/src/utils/llm-provider.ts",
      "lumic-utils/src/functions/llm-call.ts",
      "lumic-utils/src/functions/llm-openai.ts",
      "lumic-utils/src/functions/llm-anthropic.ts",
      "lumic-utils/src/functions/llm-openai-compatible.ts",
      "lumic-utils/src/functions/llm-deepseek.ts",
      "lumic-utils/src/functions/llm-images.ts",
    ]) {
      expect(qualified).toContain(required);
    }
  });

  it("has no duplicate entries, which would weaken the recall count", () => {
    const qualified = known.sites.map((entry) => `${entry.repo}/${entry.path}`);
    expect(new Set(qualified).size).toBe(qualified.length);
  });
});
