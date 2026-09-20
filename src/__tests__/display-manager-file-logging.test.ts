/**
 * DisplayManager file logging actually reaches disk.
 *
 * The Node builtins this class needs were previously loaded with a bare
 * `require` inside a try/catch that discarded the failure. In an ESM context
 * `require` is not defined, so the catch swallowed a `ReferenceError`, `fs`
 * stayed undefined, and every `writeSymbolLog`/`writeGenericLog` call returned
 * at its `if (!fs || !path) return` guard — logs the caller believed were on
 * disk were never written, with no error anywhere.
 *
 * These tests assert the observable outcome (a file exists, containing the
 * message) rather than the loading mechanism, so they fail for any regression
 * that leaves the module handles unbound, whatever the cause.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DisplayManager } from "../display-manager";

const originalCwd = process.cwd();
let workDir: string;

beforeAll(() => {
  // The writers resolve "logs" relative to the process cwd, so run them inside
  // a scratch directory rather than polluting the repository.
  workDir = mkdtempSync(join(tmpdir(), "adaptic-display-manager-"));
  process.chdir(workDir);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("DisplayManager file logging", () => {
  it("writes a symbol log to disk", () => {
    DisplayManager.getInstance().log("symbol-scoped entry", { symbol: "AAPL" });

    expect(existsSync("logs")).toBe(true);
    const written = readdirSync("logs").filter((f) => f.startsWith("AAPL-"));
    expect(written.length).toBeGreaterThan(0);
    const body = readFileSync(join("logs", written[0] as string), "utf8");
    expect(body).toContain("symbol-scoped entry");
  });

  it("writes a generic log to disk when logToFile is requested", () => {
    DisplayManager.getInstance().log("generic entry", { logToFile: true });

    expect(existsSync("logs")).toBe(true);
    const written = readdirSync("logs").filter((f) => !f.startsWith("AAPL-"));
    expect(written.length).toBeGreaterThan(0);
    const body = written
      .map((f) => readFileSync(join("logs", f), "utf8"))
      .join("\n");
    expect(body).toContain("generic entry");
  });
});
