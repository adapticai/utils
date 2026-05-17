import { describe, it, expect, beforeEach, vi } from "vitest";
import { log } from "../logging";
import { setLogger, resetLogger } from "../logger";
import type { Logger } from "../logger";

/**
 * Tests covering the routing strategy in `logging.ts`:
 * - When a host application has injected a structured logger via
 *   {@link setLogger}, calls to `log()` MUST be routed through that logger
 *   so messages join the centralised logging pipeline.
 * - When no logger has been injected, `log()` MUST fall back to the
 *   `DisplayManager` widget for standalone CLI usage.
 *
 * This routing fixes a long-running observability gap where 28 Alpaca
 * client modules were silently bypassing the host's Pino pipeline.
 */
describe("logging.log() routing", () => {
  beforeEach(() => {
    resetLogger();
  });

  it("routes info-level messages through injected logger", () => {
    const mockLogger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setLogger(mockLogger);

    log("hello world", { type: "info", source: "TestSource" });

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      "hello world",
      expect.objectContaining({ source: "TestSource", logType: "info" }),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it("routes error-level messages through injected logger", () => {
    const mockLogger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setLogger(mockLogger);

    log("boom", { type: "error", source: "AlpacaClient" });

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      "boom",
      expect.objectContaining({ source: "AlpacaClient" }),
    );
  });

  it("routes warn-level messages through injected logger", () => {
    const mockLogger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setLogger(mockLogger);

    log("careful", { type: "warn" });

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
  });

  it("routes debug-level messages through injected logger", () => {
    const mockLogger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setLogger(mockLogger);

    log("trace", { type: "debug" });

    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
  });

  it("collapses major/table/system/cost types to info", () => {
    const mockLogger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setLogger(mockLogger);

    log("major event", { type: "major" });
    log("table data", { type: "table" });
    log("system msg", { type: "system" });
    log("cost report", { type: "cost" });

    expect(mockLogger.info).toHaveBeenCalledTimes(4);
    // The original LogType is preserved in context for downstream filtering
    expect(mockLogger.info).toHaveBeenNthCalledWith(
      1,
      "major event",
      expect.objectContaining({ logType: "major" }),
    );
  });

  it("includes account, symbol, and metadata in context", () => {
    const mockLogger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    setLogger(mockLogger);

    log("trade placed", {
      type: "info",
      source: "Orders",
      account: "acct-123",
      symbol: "AAPL",
      metadata: { orderId: "ord-456", qty: 10 },
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      "trade placed",
      expect.objectContaining({
        source: "Orders",
        account: "acct-123",
        symbol: "AAPL",
        logType: "info",
        orderId: "ord-456",
        qty: 10,
      }),
    );
  });

  it("falls back to DisplayManager when no logger injected", () => {
    const mockLogger: Logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    // Intentionally do NOT call setLogger.

    // Should not call the mock at all (falls back to DisplayManager).
    log("standalone cli", { type: "info" });

    expect(mockLogger.info).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });
});
