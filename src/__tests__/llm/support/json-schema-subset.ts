/**
 * A validator for the subset of JSON Schema draft-07 the route-table schemas
 * are written in.
 *
 * The two route tables are bundled data, and each has a schema that says what
 * shape it may take. A schema nobody runs is documentation, so the tests run
 * both tables through this validator. It is a typed port of the validator the
 * gateway's own schema check uses, kept to the same keywords, so a table that
 * passes here passes there for the same reasons.
 *
 * It differs from that validator in one way. A schema keyword it does not
 * implement is reported as a violation rather than ignored. A subset validator
 * that skipped an unknown keyword would accept every value the keyword was
 * written to reject, and the schema test would keep passing while checking
 * less than the schema says.
 */

/** One node of a schema: a keyword mapped to its operand. */
export type JsonSchemaNode = Readonly<Record<string, unknown>>;

/** Keywords that describe a schema and constrain nothing. */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set(["$schema", "$id", "title", "description"]);

/** Keywords this validator enforces. */
const ENFORCED_KEYWORDS: ReadonlySet<string> = new Set([
  "const",
  "enum",
  "type",
  "minimum",
  "exclusiveMinimum",
  "maximum",
  "minLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "items",
  "minProperties",
  "required",
  "propertyNames",
  "properties",
  "additionalProperties",
]);

/** The one string format the schemas use: a calendar date. */
const DATE_FORMAT = "date";

/** A calendar date as the schemas write one. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a value is a JSON object, as opposed to an array or `null`.
 *
 * @param value The value.
 * @returns Whether it is a plain object.
 */
export function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The JSON Schema type name of a value.
 *
 * @param value The value.
 * @returns Its type name. A whole number is `integer`.
 */
function jsonTypeOf(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  return typeof value;
}

/**
 * Whether a value is of a JSON Schema type.
 *
 * @param value The value.
 * @param type The type name from the schema.
 * @returns Whether it matches. An integer is also a `number`.
 */
function matchesJsonType(value: unknown, type: unknown): boolean {
  const actual = jsonTypeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

/**
 * Read a numeric keyword.
 *
 * @param schema The schema node.
 * @param keyword The keyword.
 * @param path Where the node applies, for the message.
 * @param errors Collects a violation when the operand is not a number.
 * @returns The operand, or `undefined` when the keyword is absent or malformed.
 */
function numericKeyword(schema: JsonSchemaNode, keyword: string, path: string, errors: string[]): number | undefined {
  const operand = schema[keyword];
  if (operand === undefined) {
    return undefined;
  }
  if (typeof operand !== "number") {
    errors.push(`${path}: schema keyword "${keyword}" must be a number`);
    return undefined;
  }
  return operand;
}

/**
 * Validate a value against a schema node.
 *
 * @param value The value to validate.
 * @param schema The schema node to validate it against.
 * @param path Where the value sits in the document, for messages.
 * @returns One message per violation; empty when the value is valid.
 */
export function validateAgainstSchema(value: unknown, schema: JsonSchemaNode, path = "$"): string[] {
  const errors: string[] = [];

  for (const keyword of Object.keys(schema)) {
    if (!ANNOTATION_KEYWORDS.has(keyword) && !ENFORCED_KEYWORDS.has(keyword)) {
      errors.push(`${path}: schema keyword "${keyword}" is not implemented by this validator`);
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    return errors;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    return errors;
  }

  if (schema.type !== undefined) {
    const allowed: readonly unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => matchesJsonType(value, type))) {
      errors.push(`${path}: expected type ${allowed.join("|")}, got ${jsonTypeOf(value)}`);
      return errors;
    }
  }

  if (typeof value === "number") {
    const minimum = numericKeyword(schema, "minimum", path, errors);
    if (minimum !== undefined && value < minimum) {
      errors.push(`${path}: ${value} < minimum ${minimum}`);
    }
    const exclusiveMinimum = numericKeyword(schema, "exclusiveMinimum", path, errors);
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
      errors.push(`${path}: ${value} <= exclusiveMinimum ${exclusiveMinimum}`);
    }
    const maximum = numericKeyword(schema, "maximum", path, errors);
    if (maximum !== undefined && value > maximum) {
      errors.push(`${path}: ${value} > maximum ${maximum}`);
    }
  }

  if (typeof value === "string") {
    const minLength = numericKeyword(schema, "minLength", path, errors);
    if (minLength !== undefined && value.length < minLength) {
      errors.push(`${path}: string shorter than minLength ${minLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
    }
    if (schema.format !== undefined && schema.format !== DATE_FORMAT) {
      errors.push(`${path}: schema format ${JSON.stringify(schema.format)} is not implemented by this validator`);
    }
    if (schema.format === DATE_FORMAT && !ISO_DATE.test(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} is not an ISO date`);
    }
  }

  if (Array.isArray(value)) {
    const entries: readonly unknown[] = value;
    const minItems = numericKeyword(schema, "minItems", path, errors);
    if (minItems !== undefined && entries.length < minItems) {
      errors.push(`${path}: fewer than minItems ${minItems}`);
    }
    const maxItems = numericKeyword(schema, "maxItems", path, errors);
    if (maxItems !== undefined && entries.length > maxItems) {
      errors.push(`${path}: more than maxItems ${maxItems}`);
    }
    const items = schema.items;
    if (isJsonObject(items)) {
      entries.forEach((entry, index) => {
        errors.push(...validateAgainstSchema(entry, items, `${path}[${index}]`));
      });
    }
  }

  if (isJsonObject(value)) {
    const keys = Object.keys(value);

    const minProperties = numericKeyword(schema, "minProperties", path, errors);
    if (minProperties !== undefined && keys.length < minProperties) {
      errors.push(`${path}: fewer than minProperties ${minProperties}`);
    }

    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !Object.hasOwn(value, key)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
    }

    const propertyNames = schema.propertyNames;
    if (isJsonObject(propertyNames)) {
      for (const key of keys) {
        errors.push(...validateAgainstSchema(key, propertyNames, `${path}.<key:${key}>`));
      }
    }

    const declared = isJsonObject(schema.properties) ? schema.properties : {};
    const additional = schema.additionalProperties;
    for (const key of keys) {
      const declaredSchema = Object.hasOwn(declared, key) ? declared[key] : undefined;
      if (isJsonObject(declaredSchema)) {
        errors.push(...validateAgainstSchema(value[key], declaredSchema, `${path}.${key}`));
      } else if (isJsonObject(additional)) {
        errors.push(...validateAgainstSchema(value[key], additional, `${path}.${key}`));
      } else if (additional === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  return errors;
}

/**
 * Every object-typed node of a schema, with where it sits.
 *
 * Used to assert a property of the schema itself, such as that no object in it
 * is left open to undeclared properties.
 *
 * @param schema The schema node to walk.
 * @param path Where the node sits in the schema, for messages.
 * @returns The object-typed nodes, the given one included when it is one.
 */
export function objectSchemaNodes(schema: JsonSchemaNode, path = "$"): { path: string; node: JsonSchemaNode }[] {
  const found: { path: string; node: JsonSchemaNode }[] = [];
  const types: readonly unknown[] = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) {
    found.push({ path, node: schema });
  }
  if (isJsonObject(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      if (isJsonObject(child)) {
        found.push(...objectSchemaNodes(child, `${path}.${key}`));
      }
    }
  }
  if (isJsonObject(schema.additionalProperties)) {
    found.push(...objectSchemaNodes(schema.additionalProperties, `${path}.*`));
  }
  if (isJsonObject(schema.items)) {
    found.push(...objectSchemaNodes(schema.items, `${path}[]`));
  }
  return found;
}
