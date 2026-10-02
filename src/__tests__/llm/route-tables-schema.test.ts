/**
 * Both route tables satisfy their schemas.
 *
 * Each table is bundled data with a schema that says what shape it may take.
 * Nothing else in this package runs either table through its schema, so a
 * field misspelt in a table, or one the schema forbids, would otherwise ship
 * and be read as absent.
 *
 * A schema test passes vacuously in two ways: the validator skips what it does
 * not understand, or the schema admits everything. So the tests also show the
 * validator rejecting a table with a required field removed and one with an
 * undeclared field added, for both schemas, and refusing a schema keyword it
 * does not implement.
 */

import { describe, expect, it } from "vitest";

import aliasRoutes from "../../llm/alias-routes.json";
import aliasRoutesSchema from "../../llm/alias-routes.schema.json";
import decisionRoutes from "../../llm/decision/decision-routes.json";
import decisionRoutesSchema from "../../llm/decision/decision-routes.schema.json";

import {
  admittedDecisionRouteTable,
  editableDecisionRouteTable,
  hostedRouteOf,
  localRouteOf,
} from "./decision/support/routes";
import { isJsonObject, objectSchemaNodes, validateAgainstSchema } from "./support/json-schema-subset";
import type { JsonSchemaNode } from "./support/json-schema-subset";

/** A SHA-256 digest of the right form. */
const WELL_FORMED_DIGEST = "0123456789abcdef".repeat(4);

/**
 * An editable deep copy of a parsed JSON document.
 *
 * @param document The document.
 * @returns The copy, as a bag of fields a test can edit.
 */
function editableCopy(document: unknown): Record<string, Record<string, Record<string, unknown>>> {
  return structuredClone(document) as Record<string, Record<string, Record<string, unknown>>>;
}

describe("the route tables satisfy their schemas", () => {
  it("the decision table satisfies its schema", () => {
    expect(validateAgainstSchema(decisionRoutes, decisionRoutesSchema)).toEqual([]);
  });

  it("the alias table satisfies its schema", () => {
    expect(validateAgainstSchema(aliasRoutes, aliasRoutesSchema)).toEqual([]);
  });

  it("the admitted test table satisfies the decision schema, so tests run on a table that could ship", () => {
    expect(validateAgainstSchema(admittedDecisionRouteTable(), decisionRoutesSchema)).toEqual([]);
  });

  it("the validator rejects a missing required property and an unexpected one", () => {
    const withoutBudget = editableDecisionRouteTable();
    Reflect.deleteProperty(hostedRouteOf(withoutBudget), "budget_ms");
    expect(validateAgainstSchema(withoutBudget, decisionRoutesSchema)).toEqual([
      '$.routes.dm.hosted: missing required property "budget_ms"',
    ]);

    // The wire has no `options` field: a choice's options are the keys of its criteria.
    for (const route of ["dm.hosted", "dm.local"]) {
      const withOptions = editableCopy(decisionRoutes);
      withOptions.routes[route].options = ["a", "b"];
      expect(validateAgainstSchema(withOptions, decisionRoutesSchema)).toEqual([
        `$.routes.${route}: unexpected property "options"`,
      ]);
    }

    const aliasWithoutDefaults = editableCopy(aliasRoutes);
    Reflect.deleteProperty(aliasWithoutDefaults, "defaults");
    expect(validateAgainstSchema(aliasWithoutDefaults, aliasRoutesSchema)).toEqual([
      '$: missing required property "defaults"',
    ]);

    const aliasWithExtra = editableCopy(aliasRoutes);
    aliasWithExtra.providers.anthropic.options = ["a"];
    expect(validateAgainstSchema(aliasWithExtra, aliasRoutesSchema)).toEqual([
      '$.providers.anthropic: unexpected property "options"',
    ]);
  });

  it("the validator refuses a schema keyword it does not implement instead of skipping it", () => {
    const schema: JsonSchemaNode = { type: "string", oneOf: [{ const: "a" }, { const: "b" }] };
    expect(validateAgainstSchema("c", schema)).toEqual([
      '$: schema keyword "oneOf" is not implemented by this validator',
    ]);
    expect(validateAgainstSchema("2026-10-01", { type: "string", format: "date-time" })).toEqual([
      '$: schema format "date-time" is not implemented by this validator',
    ]);
    expect(validateAgainstSchema(5, { type: "integer", minimum: "1" })).toEqual([
      '$: schema keyword "minimum" must be a number',
    ]);
  });
});

describe("the decision schema", () => {
  it("leaves no object open to undeclared properties", () => {
    const nodes = objectSchemaNodes(decisionRoutesSchema);
    expect(nodes.length).toBeGreaterThan(8);
    for (const { path, node } of nodes) {
      const closed = node.additionalProperties === false || isJsonObject(node.additionalProperties);
      expect(closed, `${path} admits undeclared properties`).toBe(true);
    }
  });

  it("admits only the two routes, and a rule that is not a route is rejected by name", () => {
    const withBaseline = editableCopy(decisionRoutes);
    withBaseline.routes["dm.baseline"] = structuredClone(withBaseline.routes["dm.local"]);
    const errors = validateAgainstSchema(withBaseline, decisionRoutesSchema);
    expect(errors).toContain('$.routes: unexpected property "dm.baseline"');
    expect(errors).toContain('$.routes.<key:dm.baseline>: "dm.baseline" does not match /^dm\\.(hosted|local)$/');

    const withoutLocal = editableCopy(decisionRoutes);
    Reflect.deleteProperty(withoutLocal.routes, "dm.local");
    expect(validateAgainstSchema(withoutLocal, decisionRoutesSchema)).toEqual([
      '$.routes: missing required property "dm.local"',
    ]);
  });

  it("rejects a pin that follows the vendor's releases", () => {
    for (const movingName of ["jev-latest", "jev-preview"]) {
      for (const field of ["version_pin", "expected_served_model"] as const) {
        const table = editableDecisionRouteTable();
        hostedRouteOf(table)[field] = movingName;
        const errors = validateAgainstSchema(table, decisionRoutesSchema);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(`$.routes.dm.hosted.${field}: "${movingName}" does not match`);
      }
    }
  });

  it("bounds a budget to 50 through 10,000 ms", () => {
    for (const [budget, error] of [
      [49, "$.routes.dm.hosted.budget_ms: 49 < minimum 50"],
      [10_001, "$.routes.dm.hosted.budget_ms: 10001 > maximum 10000"],
      [300.5, "$.routes.dm.hosted.budget_ms: expected type integer, got number"],
    ] as const) {
      const table = editableDecisionRouteTable();
      hostedRouteOf(table).budget_ms = budget;
      expect(validateAgainstSchema(table, decisionRoutesSchema)).toEqual([error]);
    }
  });

  it("takes a revision only as a full commit hash, and a digest only as SHA-256", () => {
    const shortRevision = editableDecisionRouteTable();
    localRouteOf(shortRevision).revision = "55cf4c4e";
    expect(validateAgainstSchema(shortRevision, decisionRoutesSchema)).toHaveLength(1);

    const malformedDigest = editableDecisionRouteTable();
    localRouteOf(malformedDigest).artifact_sha256 = { "model.safetensors": "not-a-digest" };
    expect(validateAgainstSchema(malformedDigest, decisionRoutesSchema)).toEqual([
      expect.stringContaining("$.routes.dm.local.artifact_sha256.model.safetensors"),
    ]);

    const emptyDigests = editableDecisionRouteTable();
    localRouteOf(emptyDigests).artifact_sha256 = {};
    expect(validateAgainstSchema(emptyDigests, decisionRoutesSchema)).toEqual([
      "$.routes.dm.local.artifact_sha256: fewer than minProperties 1",
    ]);

    const wellFormed = editableDecisionRouteTable();
    localRouteOf(wellFormed).artifact_sha256 = { "model.safetensors": WELL_FORMED_DIGEST };
    expect(validateAgainstSchema(wellFormed, decisionRoutesSchema)).toEqual([]);
  });

  it("takes a key variable's name and never a key, and a declared base URL only over https", () => {
    const keyValue = editableCopy(decisionRoutes);
    keyValue.providers.typesafe.api_key_env = "sk-not-a-variable-name";
    expect(validateAgainstSchema(keyValue, decisionRoutesSchema)).toHaveLength(1);

    const cleartext = editableCopy(decisionRoutes);
    cleartext.providers.typesafe.base_url = "http://api.example.com";
    expect(validateAgainstSchema(cleartext, decisionRoutesSchema)).toHaveLength(1);
  });
});
