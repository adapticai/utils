/**
 * A self-contained JSON Schema validator for the inventory artefact.
 *
 * Deliberately small and dependency-free: `@adaptic/utils` is a published
 * library and the migration must not add a validator dependency to it for the
 * sake of one audit script. The supported keyword subset is exactly what
 * `llm-inventory.schema.json` uses; an unrecognised keyword is reported as an
 * error rather than ignored, so a schema that outgrows this validator fails
 * loudly instead of silently passing everything.
 *
 * @module scripts/inventory/schema-validator
 */

/** A JSON value, as parsed from the artefact. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON Schema document, in the keyword subset this validator supports. */
export type JsonSchema = { readonly [key: string]: JsonValue };

/** Keywords this validator understands. Anything else is a validator gap, not a pass. */
const SUPPORTED_KEYWORDS: readonly string[] = [
  "$schema",
  "$id",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "uniqueItems",
  "minLength",
  "minimum",
  "maximum",
  "pattern",
  "anyOf",
];

function isPlainObject(
  value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeMatches(value: JsonValue, expected: string): boolean {
  switch (expected) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    default:
      return false;
  }
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Validate a value against a schema.
 *
 * @param value - The parsed JSON value under test.
 * @param schema - The schema to apply.
 * @param path - JSON pointer-ish path used in error messages.
 * @returns Every violation found, in traversal order. Empty means valid.
 */
export function validateAgainstSchema(
  value: JsonValue,
  schema: JsonSchema,
  path = "$",
): readonly string[] {
  const errors: string[] = [];

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.includes(keyword)) {
      errors.push(`${path}: schema keyword "${keyword}" is not supported by this validator`);
    }
  }

  const declaredType = schema.type;
  if (typeof declaredType === "string" && !typeMatches(value, declaredType)) {
    errors.push(`${path}: expected type ${declaredType}`);
    return errors;
  }

  if (schema.const !== undefined && !sameJson(value, schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => sameJson(value, candidate))) {
    errors.push(`${path}: value ${JSON.stringify(value)} is not one of ${JSON.stringify(enumValues)}`);
  }

  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const branchMatched = anyOf.some((branch) => {
      if (!isPlainObject(branch)) {
        return false;
      }
      return validateAgainstSchema(value, branch, path).length === 0;
    });
    if (!branchMatched) {
      errors.push(`${path}: value ${JSON.stringify(value)} matches no anyOf branch`);
    }
  }

  if (typeof value === "string") {
    const minLength = schema.minLength;
    if (typeof minLength === "number" && value.length < minLength) {
      errors.push(`${path}: string shorter than minLength ${minLength}`);
    }
    const pattern = schema.pattern;
    if (typeof pattern === "string" && !new RegExp(pattern).test(value)) {
      errors.push(`${path}: string does not match pattern ${pattern}`);
    }
  }

  if (typeof value === "number") {
    const minimum = schema.minimum;
    if (typeof minimum === "number" && value < minimum) {
      errors.push(`${path}: number below minimum ${minimum}`);
    }
    const maximum = schema.maximum;
    if (typeof maximum === "number" && value > maximum) {
      errors.push(`${path}: number above maximum ${maximum}`);
    }
  }

  if (Array.isArray(value)) {
    const minItems = schema.minItems;
    if (typeof minItems === "number" && value.length < minItems) {
      errors.push(`${path}: array shorter than minItems ${minItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (const entry of value) {
        const key = JSON.stringify(entry);
        if (seen.has(key)) {
          errors.push(`${path}: array has duplicate item ${key}`);
        }
        seen.add(key);
      }
    }
    const items = schema.items;
    if (isPlainObject(items)) {
      value.forEach((entry, index) => {
        errors.push(...validateAgainstSchema(entry, items, `${path}[${index}]`));
      });
    }
  }

  if (isPlainObject(value)) {
    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in value)) {
          errors.push(`${path}: missing required key "${key}"`);
        }
      }
    }
    const properties = schema.properties;
    const propertySchemas = isPlainObject(properties) ? properties : {};
    for (const [key, entry] of Object.entries(value)) {
      const propertySchema = propertySchemas[key];
      if (isPlainObject(propertySchema)) {
        errors.push(...validateAgainstSchema(entry, propertySchema, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected key "${key}"`);
      }
    }
  }

  return errors;
}
