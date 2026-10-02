/**
 * The continuous-integration workflow typechecks the test sources.
 *
 * Some tests make a claim only a type checker can settle: that a typed literal
 * is admitted by the contract it names. The test runner erases types before it
 * runs anything, and the build excludes test sources, so such a test is green
 * under both whatever the types say. The claim holds in CI only while three
 * links hold together: the workflow runs the typecheck script, the script reads
 * the typecheck project, and that project includes the tests. Each link is one
 * line in a different file, so each is pinned here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The repository root, two levels above this directory. */
const REPO_ROOT = new URL("../../", import.meta.url);

/** The script name the workflow step and the package manifest must agree on. */
const TYPECHECK_SCRIPT = "typecheck";

/** The project file the script must read. */
const TYPECHECK_PROJECT = "tsconfig.typecheck.json";

/**
 * Read a file of the repository as text.
 *
 * @param relativePath Path from the repository root.
 * @returns The file's text.
 */
function readRepoFile(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, REPO_ROOT)), "utf8");
}

/**
 * Read one field of a parsed JSON object.
 *
 * @param value The parsed value.
 * @param key The field to read.
 * @returns The field's value, or `undefined` when the value is not an object or has no such field.
 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const fields: Readonly<Record<string, unknown>> = { ...value };
  return fields[key];
}

/**
 * The commands the workflow's steps run, in order.
 *
 * @param workflow The workflow file's text.
 * @returns The text after each `run:` key, comment lines excluded.
 */
function runCommands(workflow: string): readonly string[] {
  return workflow
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .flatMap((line) => {
      const match = /^(?:- )?run:\s*(.+)$/.exec(line);
      return match === null ? [] : [match[1].trim()];
    });
}

describe("continuous integration", () => {
  it("typechecks the test sources on every run", () => {
    const commands = runCommands(readRepoFile(".github/workflows/ci.yml"));
    expect(commands).toContain(`npm run ${TYPECHECK_SCRIPT}`);
    // The step sits with the other validations, before the build.
    expect(commands.indexOf(`npm run ${TYPECHECK_SCRIPT}`)).toBeLessThan(commands.indexOf("npm run build"));

    const manifest: unknown = JSON.parse(readRepoFile("package.json"));
    const script = fieldOf(fieldOf(manifest, "scripts"), TYPECHECK_SCRIPT);
    expect(script).toBe(`tsc --noEmit -p ${TYPECHECK_PROJECT}`);

    const project: unknown = JSON.parse(readRepoFile(TYPECHECK_PROJECT));
    expect(fieldOf(project, "include")).toContain("src/**/*.ts");
    const excluded = fieldOf(project, "exclude");
    const exclusions: readonly unknown[] = Array.isArray(excluded) ? excluded : [];
    for (const pattern of exclusions) {
      expect(String(pattern)).not.toMatch(/test/);
    }
  });
});
