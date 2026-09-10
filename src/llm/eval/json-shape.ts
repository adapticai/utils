/**
 * Structural comparison primitives the comparators are built from.
 *
 * These are separated from the comparators so that "did this answer parse" and
 * "was this answer right" stay distinct measurements. Conflating them hides the
 * most useful diagnostic in a model swap: a candidate can be perfectly
 * well-formed and consistently wrong, or consistently right and badly
 * formatted, and those two have opposite remedies.
 *
 * The validator honours a documented subset of JSON Schema and adds no
 * dependency. An unrecognised keyword is ignored rather than treated as
 * satisfied, so the subset can only ever be stricter than a caller expects,
 * never more permissive.
 *
 * @module llm/eval/json-shape
 */

import type { JsonShape } from "./types";

/** Points on the F1 scale, so a tolerance expressed "in points" has a fixed meaning. */
export const F1_SCALE_POINTS = 100;

/**
 * Whether a value satisfies a shape.
 *
 * @param value The value to check.
 * @param shape The shape it must satisfy.
 * @returns Whether the value satisfies the shape.
 */
export function satisfiesShape(value: unknown, shape: JsonShape): boolean {
  if (!hasJsonType(value, shape.type)) {
    return false;
  }
  if (shape.enum !== undefined && !shape.enum.some((option) => option === value)) {
    return false;
  }
  if (shape.type === "object") {
    const record = value as Record<string, unknown>;
    for (const key of shape.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        return false;
      }
    }
    for (const [key, childShape] of Object.entries(shape.properties ?? {})) {
      if (
        Object.prototype.hasOwnProperty.call(record, key) &&
        !satisfiesShape(record[key], childShape)
      ) {
        return false;
      }
    }
    return true;
  }
  if (shape.type === "array" && shape.items !== undefined) {
    const items = shape.items;
    return (value as readonly unknown[]).every((element) => satisfiesShape(element, items));
  }
  return true;
}

/**
 * Whether a value has the given JSON type.
 *
 * @param value The value.
 * @param type The required type.
 * @returns Whether the value has that type.
 */
function hasJsonType(value: unknown, type: JsonShape["type"]): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
}

/**
 * Structural equality over JSON values.
 *
 * Order-sensitive for arrays and order-insensitive for object keys, which is
 * what JSON itself means: two objects with the same entries are the same
 * answer, while a reordered list is a different one.
 *
 * @param left The first value.
 * @param right The second value.
 * @returns Whether the two are structurally equal.
 */
export function jsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((element, index) => jsonEquals(element, right[index]));
  }
  if (
    typeof left === "object" &&
    typeof right === "object" &&
    left !== null &&
    right !== null
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && jsonEquals(leftRecord[key], rightRecord[key]),
    );
  }
  return false;
}

/**
 * Flatten a JSON value into dotted leaf paths paired with their serialised values.
 *
 * Field-level F1 needs a set of comparable atoms, and a leaf path is the
 * natural one for extraction output: it credits a candidate for the fields it
 * got right instead of scoring the whole record all-or-nothing, which is the
 * difference between a metric that can move by one point and one that can only
 * move by whole cases.
 *
 * @param value The value to flatten.
 * @param prefix Path prefix used by the recursion.
 * @returns Leaf paths mapped to their serialised values.
 */
export function leafFields(value: unknown, prefix = ""): Map<string, string> {
  const leaves = new Map<string, string>();
  if (Array.isArray(value)) {
    value.forEach((element, index) => {
      for (const [path, leaf] of leafFields(element, `${prefix}[${index}]`)) {
        leaves.set(path, leaf);
      }
    });
    return leaves;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      for (const [childPath, leaf] of leafFields(child, path)) {
        leaves.set(childPath, leaf);
      }
    }
    return leaves;
  }
  leaves.set(prefix === "" ? "$" : prefix, JSON.stringify(value) ?? "null");
  return leaves;
}

/**
 * Field-level F1 between a produced value and the reference, in points.
 *
 * @param produced What the model returned.
 * @param expected The reference answer.
 * @returns F1 on a 0-100 point scale; 0 when nothing matched.
 */
export function fieldF1(produced: unknown, expected: unknown): number {
  const producedLeaves = leafFields(produced);
  const expectedLeaves = leafFields(expected);
  let truePositives = 0;
  for (const [path, leaf] of producedLeaves) {
    if (expectedLeaves.get(path) === leaf) {
      truePositives += 1;
    }
  }
  if (truePositives === 0) {
    return 0;
  }
  const precision = truePositives / producedLeaves.size;
  const recall = truePositives / expectedLeaves.size;
  return (F1_SCALE_POINTS * 2 * precision * recall) / (precision + recall);
}

/**
 * The p95 of a sample by nearest-rank.
 *
 * Nearest-rank rather than an interpolating estimator because a latency gate
 * must name a value the system actually produced; an interpolated p95 is a
 * number no request ever took, and a gate is easier to trust when its threshold
 * is an observation.
 *
 * @param values The sample.
 * @returns The p95 value, or `null` for an empty sample.
 */
export function p95(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const P95_FRACTION = 0.95;
  const rank = Math.ceil(P95_FRACTION * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}
