/**
 * Loader for the decision contract fixtures.
 *
 * Every fixture is an envelope of an optional status, optional response
 * headers and a body, and every fixture is declared in a manifest with the
 * class of evidence it rests on. A test names the classes it is prepared to
 * rely on when it loads a fixture, and the load fails when the fixture is of
 * another class. A test that claims to check the vendor's documented contract
 * therefore cannot be satisfied by a body somebody invented, and the claim a
 * test makes is readable at the call site.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What a fixture's content rests on, strongest claims first.
 *
 * - `documented-verbatim`: quoted from the vendor's published reference.
 * - `observed-unauthenticated`: recorded from a real response to a request
 *   that carried no credential.
 * - `observed-authenticated`: recorded from a real response to an
 *   authenticated call. Nothing is in this class until such a call is made.
 * - `constructed-from-documented-fields`: assembled from documented field
 *   tables where the reference quotes no example. The shape is documented; the
 *   values are not the vendor's.
 * - `synthetic-unobserved`: a body for a response nobody has seen. Only its
 *   status is documented. It says nothing about what the vendor returns.
 */
export const DECISION_EVIDENCE_CLASSES = [
  "documented-verbatim",
  "observed-unauthenticated",
  "observed-authenticated",
  "constructed-from-documented-fields",
  "synthetic-unobserved",
] as const;

/** One class of evidence. See {@link DECISION_EVIDENCE_CLASSES}. */
export type DecisionEvidenceClass = (typeof DECISION_EVIDENCE_CLASSES)[number];

/** The directory the fixtures and their manifest live in. */
export const DECISION_FIXTURE_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** File name of the manifest inside a fixture directory. */
export const DECISION_FIXTURE_MANIFEST = "manifest.json";

/** What the manifest says about one fixture. */
export interface DecisionFixtureDeclaration {
  readonly evidence: DecisionEvidenceClass;
  /** Where the content was read or observed, or `null` when it has no single source. */
  readonly source_url: string | null;
  /** The findings section that records the evidence. */
  readonly findings: string;
  /** The date the source was read or observed. */
  readonly retrieved: string;
  readonly notes?: string;
}

/** The manifest of a fixture directory. */
export interface DecisionFixtureManifest {
  readonly schema_version: number;
  readonly description: string;
  readonly findings_document: string;
  /** Each evidence class and what it means. */
  readonly evidence_classes: Readonly<Record<string, string>>;
  readonly fixtures: Readonly<Record<string, DecisionFixtureDeclaration>>;
}

/**
 * One fixture's content.
 *
 * `status` and `headers` are present only where a source records them: a
 * request has neither, and no status is quoted for the documented success.
 * Header names are lower case, as a fetch response reports them.
 */
export interface DecisionFixtureEnvelope {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** A loaded fixture, with the evidence class it was loaded under. */
export interface DecisionFixture {
  readonly name: string;
  readonly evidence: DecisionEvidenceClass;
  readonly envelope: DecisionFixtureEnvelope;
}

/** How a fixture is loaded. */
export interface LoadDecisionFixtureOptions {
  /** The evidence classes the caller is prepared to rely on. */
  readonly allow: readonly DecisionEvidenceClass[];
  /** The fixture directory. Defaults to the package's own. */
  readonly dir?: string;
}

/** The keys an envelope may hold. */
const ENVELOPE_KEYS: readonly string[] = ["status", "headers", "body"];

/**
 * Whether a value is a plain JSON object.
 *
 * @param value The value to test.
 * @returns True when it is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a label is one of the closed evidence classes.
 *
 * @param label The label to test.
 * @returns True when it is a member of {@link DECISION_EVIDENCE_CLASSES}.
 */
function isEvidenceClass(label: unknown): label is DecisionEvidenceClass {
  return DECISION_EVIDENCE_CLASSES.some((evidence) => evidence === label);
}

/**
 * Read and parse one JSON file of a fixture directory.
 *
 * @param dir The fixture directory.
 * @param name The file's name.
 * @returns The parsed value.
 */
function readJson(dir: string, name: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
  return parsed;
}

/**
 * Read a required string field.
 *
 * @param record The object to read from.
 * @param field The field's name.
 * @param where What is being read, for the error.
 * @returns The string.
 * @throws When the field is absent, empty or not a string.
 */
function requiredString(record: Record<string, unknown>, field: string, where: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where}: "${field}" must be a non-empty string`);
  }
  return value;
}

/**
 * Validate one declaration of the manifest.
 *
 * @param name The fixture's file name.
 * @param raw The declaration as parsed.
 * @returns The declaration, typed.
 * @throws When a field is missing or the evidence label is outside the closed list.
 */
function declarationOf(name: string, raw: unknown): DecisionFixtureDeclaration {
  if (!isRecord(raw)) {
    throw new Error(`fixture manifest: the declaration of ${name} is not an object`);
  }
  const evidence = raw.evidence;
  if (!isEvidenceClass(evidence)) {
    throw new Error(
      `fixture manifest: ${name} is labelled ${JSON.stringify(evidence)}, which is not one of the evidence classes ` +
        `(${DECISION_EVIDENCE_CLASSES.join(", ")})`,
    );
  }
  const sourceUrl = raw.source_url;
  if (sourceUrl !== null && typeof sourceUrl !== "string") {
    throw new Error(`fixture manifest: ${name}: "source_url" must be a string or null`);
  }
  const notes = raw.notes;
  if (notes !== undefined && typeof notes !== "string") {
    throw new Error(`fixture manifest: ${name}: "notes" must be a string when present`);
  }
  return {
    evidence,
    source_url: sourceUrl,
    findings: requiredString(raw, "findings", `fixture manifest: ${name}`),
    retrieved: requiredString(raw, "retrieved", `fixture manifest: ${name}`),
    ...(notes === undefined ? {} : { notes }),
  };
}

/**
 * Read and validate a fixture directory's manifest.
 *
 * @param dir The fixture directory. Defaults to the package's own.
 * @returns The manifest.
 * @throws When the manifest is malformed or uses a label outside the closed list.
 */
export function readDecisionFixtureManifest(dir: string = DECISION_FIXTURE_DIR): DecisionFixtureManifest {
  const raw = readJson(dir, DECISION_FIXTURE_MANIFEST);
  if (!isRecord(raw)) {
    throw new Error("fixture manifest: the manifest is not an object");
  }
  const schemaVersion = raw.schema_version;
  if (typeof schemaVersion !== "number") {
    throw new Error('fixture manifest: "schema_version" must be a number');
  }
  const classes = raw.evidence_classes;
  if (!isRecord(classes)) {
    throw new Error('fixture manifest: "evidence_classes" must be an object');
  }
  const fixtures = raw.fixtures;
  if (!isRecord(fixtures)) {
    throw new Error('fixture manifest: "fixtures" must be an object');
  }
  return {
    schema_version: schemaVersion,
    description: requiredString(raw, "description", "fixture manifest"),
    findings_document: requiredString(raw, "findings_document", "fixture manifest"),
    evidence_classes: Object.fromEntries(
      Object.keys(classes).map((label) => [
        label,
        requiredString(classes, label, "fixture manifest: evidence_classes"),
      ]),
    ),
    fixtures: Object.fromEntries(
      Object.entries(fixtures).map(([name, declaration]) => [name, declarationOf(name, declaration)]),
    ),
  };
}

/**
 * Compare a fixture directory with its manifest.
 *
 * @param dir The fixture directory. Defaults to the package's own.
 * @returns Files the manifest does not declare, and declarations with no file, each sorted.
 */
export function decisionFixtureDrift(dir: string = DECISION_FIXTURE_DIR): {
  readonly undeclared: readonly string[];
  readonly missing: readonly string[];
} {
  const declared = Object.keys(readDecisionFixtureManifest(dir).fixtures);
  const files = readdirSync(dir).filter((name) => name !== DECISION_FIXTURE_MANIFEST);
  return {
    undeclared: files.filter((name) => !declared.includes(name)).sort(),
    missing: declared.filter((name) => !files.includes(name)).sort(),
  };
}

/**
 * Validate a parsed fixture file as an envelope.
 *
 * @param name The fixture's file name.
 * @param raw The file as parsed.
 * @returns The envelope, typed.
 * @throws When the file holds anything but a status, headers and a body, or no body.
 */
function envelopeOf(name: string, raw: unknown): DecisionFixtureEnvelope {
  if (!isRecord(raw)) {
    throw new Error(`fixture ${name}: the envelope is not an object`);
  }
  const unexpected = Object.keys(raw).filter((key) => !ENVELOPE_KEYS.includes(key));
  if (unexpected.length > 0) {
    throw new Error(
      `fixture ${name}: an envelope holds only ${ENVELOPE_KEYS.join(", ")}; found ${unexpected.join(", ")}`,
    );
  }
  if (!("body" in raw)) {
    throw new Error(`fixture ${name}: the envelope has no body`);
  }
  const status = raw.status;
  if (status !== undefined && (typeof status !== "number" || !Number.isInteger(status))) {
    throw new Error(`fixture ${name}: "status" must be an integer when present`);
  }
  const headers = raw.headers;
  if (headers !== undefined && !isRecord(headers)) {
    throw new Error(`fixture ${name}: "headers" must be an object when present`);
  }
  const typedHeaders: Record<string, string> = {};
  for (const [header, value] of Object.entries(headers ?? {})) {
    if (typeof value !== "string") {
      throw new Error(`fixture ${name}: header ${header} must be a string`);
    }
    if (header !== header.toLowerCase()) {
      throw new Error(`fixture ${name}: header ${header} must be lower case, as a response reports it`);
    }
    typedHeaders[header] = value;
  }
  return {
    ...(status === undefined ? {} : { status }),
    ...(headers === undefined ? {} : { headers: typedHeaders }),
    body: raw.body,
  };
}

/**
 * Load one fixture, refusing it when its evidence class is not allowed.
 *
 * @param name The fixture's file name.
 * @param options The evidence classes the caller relies on, and the directory.
 * @returns The fixture and the class it was loaded under.
 * @throws When the fixture is undeclared, is of a class the caller did not
 *   allow, or is not a well-formed envelope.
 */
export function loadDecisionFixture(name: string, options: LoadDecisionFixtureOptions): DecisionFixture {
  const dir = options.dir ?? DECISION_FIXTURE_DIR;
  const manifest = readDecisionFixtureManifest(dir);
  if (!Object.hasOwn(manifest.fixtures, name)) {
    throw new Error(`fixture ${name} is not declared in ${DECISION_FIXTURE_MANIFEST}, so it has no evidence class`);
  }
  const { evidence } = manifest.fixtures[name];
  if (!options.allow.includes(evidence)) {
    throw new Error(
      `fixture ${name} is ${evidence}; the caller allows only ` +
        `${options.allow.length === 0 ? "nothing" : options.allow.join(", ")}`,
    );
  }
  return { name, evidence, envelope: envelopeOf(name, readJson(dir, name)) };
}
