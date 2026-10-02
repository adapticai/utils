/**
 * The contract fixtures and the evidence each one rests on.
 *
 * The hosted decision contract was read from documentation and never called
 * with a credential. A fixture built from it is therefore one of several quite
 * different things: text quoted from the vendor's reference, a body observed on
 * the wire, a body assembled from documented field tables, or a body invented
 * to stand for a response nobody has seen. A test that passes on the last kind
 * proves nothing about the vendor, and the only thing that keeps the kinds
 * apart is the label.
 *
 * So the label is enforced: every file is declared, the quoted and observed
 * files are pinned by digest, a fixture cannot be loaded as stronger evidence
 * than it is, and nothing may claim to have been observed on an authenticated
 * call until one has been made.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DecisionWireRequest, DecisionWireResponse } from "../../../llm/decision/types";
import {
  DECISION_EVIDENCE_CLASSES,
  DECISION_FIXTURE_DIR,
  DECISION_FIXTURE_MANIFEST,
  decisionFixtureDrift,
  loadDecisionFixture,
  readDecisionFixtureManifest,
} from "./support/fixtures";
import type { DecisionEvidenceClass } from "./support/fixtures";

/**
 * The evidence classes whose content is somebody else's words or bytes.
 *
 * A fixture in one of these claims to reproduce a source, so it is pinned: an
 * edit to it is an edit to the evidence.
 */
const PINNED_CLASSES: readonly DecisionEvidenceClass[] = [
  "documented-verbatim",
  "observed-unauthenticated",
  "observed-authenticated",
];

/**
 * SHA-256 of each pinned fixture's compact JSON.
 *
 * Derived from the recorded source text, not from the fixture files: the two
 * documented bodies from the request and response examples quoted in the
 * findings, the two observed ones from the probe results recorded there.
 */
const PINNED_DIGESTS: Readonly<Record<string, string>> = {
  "request.choice.documented.json": "d7716b422ce90fc9ae42c946df5ffe25d61ace2c5cba65657caa8d1f24334319",
  "response.choice.documented.json": "4abc90272451ff391ffd80254e33a7e4d2b04729f7238fe3e43936da1a4af792",
  "error.403-missing-key.observed.json": "0823ad860ba1cf4183c927318037a43e6425c2fce1a9a2e3f905ddad51b7dd93",
  "error.405-method-not-allowed.observed.json": "c0ae93d53815cf575eecccbb660b7aef0a97c3bd06c97aeb43f1f040d049098f",
};

/** The findings sections that hold the quoted and the observed evidence. */
const VERBATIM_FINDINGS_SECTION = /external-verification\.md §3A\b/;
const OBSERVED_FINDINGS_SECTION = /external-verification\.md §3C\b/;

/** Every fixture file the contract lanes build against. */
const EXPECTED_FIXTURES: Readonly<Record<string, DecisionEvidenceClass>> = {
  "request.choice.documented.json": "documented-verbatim",
  "response.choice.documented.json": "documented-verbatim",
  "error.403-missing-key.observed.json": "observed-unauthenticated",
  "error.405-method-not-allowed.observed.json": "observed-unauthenticated",
  "request.noul.constructed.json": "constructed-from-documented-fields",
  "request.score.constructed.json": "constructed-from-documented-fields",
  "response.noul.constructed.json": "constructed-from-documented-fields",
  "response.score.constructed.json": "constructed-from-documented-fields",
  "response.laya-serve-shape.constructed.json": "constructed-from-documented-fields",
  "error.401.unobserved.json": "synthetic-unobserved",
  "error.422.unobserved.json": "synthetic-unobserved",
  "error.429.unobserved.json": "synthetic-unobserved",
  "error.529.unobserved.json": "synthetic-unobserved",
  "error.500.unobserved.json": "synthetic-unobserved",
};

/** The state the documented example asks about, reused by the constructed requests. */
const DOCUMENTED_STATE = "Help! My payouts have been failing for 3 days.";

/** The documented request, written as a value of the wire type. */
const DOCUMENTED_CHOICE_REQUEST: DecisionWireRequest = {
  state: DOCUMENTED_STATE,
  model: "jev-latest",
  questions: {
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: {
        billing: "Payments, invoicing, refunds",
        technical: "Bugs, outages, integrations",
        sales: "Pricing, upgrades, new accounts",
      },
    },
  },
};

/** The documented response, written as a value of the wire type. */
const DOCUMENTED_CHOICE_RESPONSE: DecisionWireResponse = {
  model: "jev-1.13.0",
  answers: {
    department: {
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
      confidence: 0.81,
    },
  },
  usage: { input_tokens: 318, output_tokens: 34 },
};

/** The constructed yes/no request, written as a value of the wire type. */
const CONSTRUCTED_NOUL_REQUEST: DecisionWireRequest = {
  state: DOCUMENTED_STATE,
  model: "jev-1.13.0",
  questions: {
    payment_failure: {
      type: "noul",
      instructions: "Is the customer reporting a payment that failed?",
      criteria: {
        true: "The message describes a payment or payout that did not complete",
        false: "The message is about anything else",
      },
    },
  },
};

/** The constructed yes/no response, written as a value of the wire type. */
const CONSTRUCTED_NOUL_RESPONSE: DecisionWireResponse = {
  model: "jev-1.13.0",
  answers: { payment_failure: { type: "noul", noul: 0.95 } },
  usage: { input_tokens: 301, output_tokens: 18 },
};

/** The levels of the constructed score, lowest first. */
const SCORE_LEVELS = [
  "No action is needed",
  "Can wait for the normal queue",
  "Needs attention today",
  "Blocks the customer right now",
] as const;

/** The constructed score request, written as a value of the wire type. */
const CONSTRUCTED_SCORE_REQUEST: DecisionWireRequest = {
  state: DOCUMENTED_STATE,
  model: "jev-1.13.0",
  questions: {
    urgency: { type: "score", instructions: "How urgent is this request?", criteria: SCORE_LEVELS },
  },
};

/** The constructed score response, written as a value of the wire type. */
const CONSTRUCTED_SCORE_RESPONSE: DecisionWireResponse = {
  model: "jev-1.13.0",
  answers: {
    urgency: {
      type: "score",
      score: 2.5,
      legend: { "0": SCORE_LEVELS[0], "1": SCORE_LEVELS[1], "2": SCORE_LEVELS[2], "3": SCORE_LEVELS[3] },
      probabilities: { "0": 0, "1": 0.125, "2": 0.25, "3": 0.625 },
      confidence: 0.5,
    },
  },
  usage: { input_tokens: 329, output_tokens: 41 },
};

/** Every class, for a read that makes no claim about evidence strength. */
const ANY_CLASS = DECISION_EVIDENCE_CLASSES;

/** Scratch directories a test created, removed after it. */
const scratchDirs: string[] = [];

/**
 * Create a scratch fixture directory holding the given files.
 *
 * @param files File name to file text.
 * @returns The directory's path.
 */
function scratchFixtureDir(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "decision-fixtures-"));
  scratchDirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

/**
 * A manifest's text declaring the given fixtures.
 *
 * @param fixtures File name to the evidence label to declare, valid or not.
 * @returns The manifest as JSON text.
 */
function manifestText(fixtures: Readonly<Record<string, string>>): string {
  const canonical = readDecisionFixtureManifest();
  return JSON.stringify({
    ...canonical,
    fixtures: Object.fromEntries(
      Object.entries(fixtures).map(([name, evidence]) => [
        name,
        { evidence, source_url: null, findings: "scratch", retrieved: "2026-10-01" },
      ]),
    ),
  });
}

/**
 * SHA-256 of a fixture file's compact JSON.
 *
 * Compact, so the pin is to the content and survives a change of indentation.
 *
 * @param name The fixture's file name.
 * @returns The digest in hex.
 */
function compactDigest(name: string): string {
  const parsed: unknown = JSON.parse(readFileSync(join(DECISION_FIXTURE_DIR, name), "utf8"));
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("decision contract fixtures", () => {
  it("every fixture is declared and every declaration has a file", () => {
    expect(decisionFixtureDrift()).toEqual({ undeclared: [], missing: [] });

    const manifest = readDecisionFixtureManifest();
    const declared = Object.fromEntries(
      Object.entries(manifest.fixtures).map(([name, declaration]) => [name, declaration.evidence]),
    );
    expect(declared).toEqual(EXPECTED_FIXTURES);

    // The comparison can fail: a directory with a stray file and a declaration
    // with no file are both reported, so the empty result above is a finding.
    const drifted = scratchFixtureDir({
      [DECISION_FIXTURE_MANIFEST]: manifestText({
        "declared.json": "synthetic-unobserved",
        "absent.json": "synthetic-unobserved",
      }),
      "declared.json": '{"body":{}}',
      "stray.json": '{"body":{}}',
    });
    expect(decisionFixtureDrift(drifted)).toEqual({ undeclared: ["stray.json"], missing: ["absent.json"] });
  });

  it("verbatim and observed fixtures match their pinned digests", () => {
    const manifest = readDecisionFixtureManifest();
    const pinnable = Object.entries(manifest.fixtures)
      .filter(([, declaration]) => PINNED_CLASSES.includes(declaration.evidence))
      .map(([name]) => name)
      .sort();

    // Every fixture that claims to reproduce a source has a pin, so a label
    // cannot be strengthened without a digest somebody derived from the source.
    expect(pinnable).toEqual(Object.keys(PINNED_DIGESTS).sort());

    for (const [name, digest] of Object.entries(PINNED_DIGESTS)) {
      expect(compactDigest(name), name).toBe(digest);
    }

    for (const name of pinnable) {
      const declaration = manifest.fixtures[name];
      const section =
        declaration.evidence === "documented-verbatim" ? VERBATIM_FINDINGS_SECTION : OBSERVED_FINDINGS_SECTION;
      expect(declaration.findings, name).toMatch(section);
      expect(declaration.source_url, name).toMatch(/^https:\/\//);
      expect(declaration.retrieved, name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("a fixture cannot be loaded under a stronger evidence class than it has", () => {
    expect(() => loadDecisionFixture("error.422.unobserved.json", { allow: ["documented-verbatim"] })).toThrow(
      /synthetic-unobserved/,
    );
    expect(() =>
      loadDecisionFixture("response.noul.constructed.json", {
        allow: ["documented-verbatim", "observed-unauthenticated", "observed-authenticated"],
      }),
    ).toThrow(/constructed-from-documented-fields/);
    expect(() => loadDecisionFixture("error.403-missing-key.observed.json", { allow: [] })).toThrow(
      /observed-unauthenticated/,
    );

    // The same file loads when its own class is allowed, and says what it is.
    const unobserved = loadDecisionFixture("error.422.unobserved.json", { allow: ["synthetic-unobserved"] });
    expect(unobserved.evidence).toBe("synthetic-unobserved");
    expect(unobserved.envelope.status).toBe(422);

    const observed = loadDecisionFixture("error.403-missing-key.observed.json", {
      allow: ["observed-unauthenticated"],
    });
    expect(observed.envelope.status).toBe(403);
    expect(observed.envelope.headers).toEqual({
      "content-type": "application/json",
      "x-typesafe-request-id": "req_01a0f845558d7b29bb19a4723e315da0",
    });
    expect(observed.envelope.body).toEqual({
      detail: {
        error_type: "authentication_error",
        message: "Must supply an API key! Check your request and try again.",
      },
    });

    // A file nobody declared has no evidence class and so cannot be loaded.
    expect(() => loadDecisionFixture("not-a-fixture.json", { allow: ANY_CLASS })).toThrow(/not declared/);
  });

  it("only the closed evidence classes are used, and no fixture claims observed-authenticated", () => {
    expect([...DECISION_EVIDENCE_CLASSES]).toEqual([
      "documented-verbatim",
      "observed-unauthenticated",
      "observed-authenticated",
      "constructed-from-documented-fields",
      "synthetic-unobserved",
    ]);

    const manifest = readDecisionFixtureManifest();
    expect(Object.keys(manifest.evidence_classes).sort()).toEqual([...DECISION_EVIDENCE_CLASSES].sort());

    const used = Object.values(manifest.fixtures).map((declaration) => declaration.evidence);
    for (const evidence of used) {
      expect(DECISION_EVIDENCE_CLASSES).toContain(evidence);
    }
    expect(used).not.toContain("observed-authenticated");

    // A label outside the closed list is refused when the manifest is read,
    // so a new kind of evidence cannot appear by being typed into the JSON.
    const mislabelled = scratchFixtureDir({
      [DECISION_FIXTURE_MANIFEST]: manifestText({ "one.json": "observed-in-a-dream" }),
      "one.json": '{"body":{}}',
    });
    expect(() => readDecisionFixtureManifest(mislabelled)).toThrow(/observed-in-a-dream/);
  });

  it("every envelope holds a body and nothing but a status, headers and a body", () => {
    for (const name of Object.keys(EXPECTED_FIXTURES)) {
      const { envelope } = loadDecisionFixture(name, { allow: ANY_CLASS });
      expect(envelope.body, name).toBeDefined();
      if (name.startsWith("error.")) {
        expect(envelope.status, name).toBe(Number(name.split(".")[1].slice(0, 3)));
      } else {
        // A request has no status, and no status is quoted for a success.
        expect(envelope.status, name).toBeUndefined();
      }
    }

    const malformed = scratchFixtureDir({
      [DECISION_FIXTURE_MANIFEST]: manifestText({
        "extra.json": "synthetic-unobserved",
        "bodiless.json": "synthetic-unobserved",
        "shouting.json": "synthetic-unobserved",
      }),
      "extra.json": '{"status":500,"body":{},"request":{"authorization":"x"}}',
      "bodiless.json": '{"status":500}',
      "shouting.json": '{"status":500,"headers":{"Retry-After":"1"},"body":{}}',
    });
    expect(() => loadDecisionFixture("extra.json", { allow: ANY_CLASS, dir: malformed })).toThrow(/request/);
    expect(() => loadDecisionFixture("bodiless.json", { allow: ANY_CLASS, dir: malformed })).toThrow(/body/);
    expect(() => loadDecisionFixture("shouting.json", { allow: ANY_CLASS, dir: malformed })).toThrow(/lower case/);
  });

  it("the wire types admit every request and response the fixtures hold", () => {
    const bodyOf = (name: string): unknown => loadDecisionFixture(name, { allow: ANY_CLASS }).envelope.body;

    expect(bodyOf("request.choice.documented.json")).toEqual(DOCUMENTED_CHOICE_REQUEST);
    expect(bodyOf("response.choice.documented.json")).toEqual(DOCUMENTED_CHOICE_RESPONSE);
    expect(bodyOf("request.noul.constructed.json")).toEqual(CONSTRUCTED_NOUL_REQUEST);
    expect(bodyOf("response.noul.constructed.json")).toEqual(CONSTRUCTED_NOUL_RESPONSE);
    expect(bodyOf("request.score.constructed.json")).toEqual(CONSTRUCTED_SCORE_REQUEST);
    expect(bodyOf("response.score.constructed.json")).toEqual(CONSTRUCTED_SCORE_RESPONSE);

    // Field order is part of the request contract: state, model, questions.
    expect(Object.keys(DOCUMENTED_CHOICE_REQUEST)).toEqual(["state", "model", "questions"]);
    expect(JSON.stringify(bodyOf("request.choice.documented.json"))).toBe(
      JSON.stringify(DOCUMENTED_CHOICE_REQUEST),
    );

    // A yes/no answer is one number. It has no confidence, and none is added.
    const noul = CONSTRUCTED_NOUL_RESPONSE.answers.payment_failure;
    expect(Object.keys(noul).sort()).toEqual(["noul", "type"]);

    // The compatible server's answer has the same distribution as the
    // documented one and a different confidence, under a model name that is a
    // checkpoint rather than a pinned id.
    const compatible = bodyOf("response.laya-serve-shape.constructed.json");
    expect(compatible).toMatchObject({
      model: "english",
      routing: { model: "english" },
      answers: {
        department: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.88, technical: 0.12, sales: 0 },
        },
      },
    });
    expect(compatible).not.toMatchObject({ answers: { department: { confidence: 0.81 } } });
  });
});
