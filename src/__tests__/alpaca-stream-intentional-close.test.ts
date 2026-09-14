/**
 * The close CODE is the only thing that suppresses the reconnect chain.
 *
 * @fileoverview `disconnectStockStream()` historically called `ws.close()` with
 * no arguments. A bare close sends no status, so the close event reports 1005
 * ("no status received"), and the stream's own close handler reconnects on any
 * code other than 1000 — so a bare close is a request for a FRESH socket, never
 * a way to put a stream down and keep it down.
 *
 * That distinction is load-bearing outside this package. A caller handing a
 * single-writer vendor entitlement to another process has to know the socket
 * stays shut: a resurrection after the handover puts two connections on one
 * vendor key, which is the exact state such a handover exists to avoid. These
 * tests pin the code, because the code IS the behaviour — a test that only
 * asserted "close was called" would pass on the defect.
 *
 * @module __tests__/alpaca-stream-intentional-close
 */
import { describe, expect, it, vi } from "vitest";

// `ws` is an external of this package and is not installed here. These tests
// never open a socket — they assert how an EXISTING one is closed — so a stub
// constructor is sufficient and keeps the suite free of a network dependency.
vi.mock("ws", () => {
  class StubWebSocket {
    public close(): void {}
    public on(): void {}
    public send(): void {}
  }
  return { default: StubWebSocket, WebSocket: StubWebSocket };
});

import { AlpacaMarketDataAPI } from "../alpaca-market-data-api";

/** A socket that records how it was closed and nothing else. */
function fakeSocket(): { close: ReturnType<typeof vi.fn> } {
  return { close: vi.fn() };
}

/** Install a fake socket on a private stream field without widening its type. */
function withStockSocket(
  api: AlpacaMarketDataAPI,
  socket: { close: ReturnType<typeof vi.fn> },
): void {
  (api as unknown as { stockWs: unknown }).stockWs = socket;
}

describe("intentional stream disconnect", () => {
  it("closes with 1000 so the reconnect chain does not resurrect the stream", () => {
    const api = AlpacaMarketDataAPI.getInstance();
    const socket = fakeSocket();
    withStockSocket(api, socket);

    api.disconnectStockStream({ intentional: true });

    expect(socket.close).toHaveBeenCalledTimes(1);
    // 1000 exactly: the close handler's rule is `code !== 1000 -> reconnect`,
    // so any other value — including a bare close's 1005 — reconnects.
    expect(socket.close.mock.calls[0][0]).toBe(1000);
  });

  it("leaves the default close alone, because forced cycles rely on the redial", () => {
    // The stale-feed detector disconnects PRECISELY to get a fresh socket and
    // depends on the automatic reconnect to re-establish it. Making every close
    // final would strand that path on its slower backstop.
    const api = AlpacaMarketDataAPI.getInstance();
    const socket = fakeSocket();
    withStockSocket(api, socket);

    api.disconnectStockStream();

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.close.mock.calls[0].length).toBe(0);
  });

  it("treats an explicitly non-intentional close as the default", () => {
    const api = AlpacaMarketDataAPI.getInstance();
    const socket = fakeSocket();
    withStockSocket(api, socket);

    api.disconnectStockStream({ intentional: false });

    expect(socket.close.mock.calls[0].length).toBe(0);
  });

  it("applies the same rule to the crypto stream", () => {
    const api = AlpacaMarketDataAPI.getInstance();
    const socket = fakeSocket();
    (api as unknown as { cryptoWs: unknown }).cryptoWs = socket;

    api.disconnectCryptoStream({ intentional: true });

    expect(socket.close.mock.calls[0][0]).toBe(1000);
  });
});
