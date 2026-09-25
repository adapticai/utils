/**
 * Pins the library-stamped trade-update receipt: every trade update parsed off
 * an Alpaca trading socket carries `_receipt` with a wall-clock instant, a
 * monotonic-clock instant, the id of the socket connection it arrived on, and a
 * 1-based per-connection sequence — on both parse sites (the legacy
 * `AlpacaTradingAPI` socket and the modular `TradingStream`) and in the
 * exported stamper the engine uses at its own parse site.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Listener = (...args: unknown[]) => void;

const { MockSocket, sockets } = vi.hoisted(() => {
  const created: Array<{
    readyState: number;
    emit(event: string, ...args: unknown[]): void;
  }> = [];

  /** Minimal `ws` stand-in: records listeners so a test can deliver frames. */
  class HoistedMockSocket {
    static readonly OPEN = 1;
    readyState = 0;
    private readonly listeners = new Map<string, Listener[]>();

    constructor(public readonly url: string) {
      created.push(this);
    }

    on(event: string, listener: Listener): this {
      const existing = this.listeners.get(event) ?? [];
      existing.push(listener);
      this.listeners.set(event, existing);
      return this;
    }

    removeListener(event: string, listener: Listener): this {
      const existing = this.listeners.get(event) ?? [];
      this.listeners.set(
        event,
        existing.filter((candidate) => candidate !== listener),
      );
      return this;
    }

    removeAllListeners(): this {
      this.listeners.clear();
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) {
        listener(...args);
      }
    }

    send(): void {}
    close(): void {}
    terminate(): void {}
  }

  return { MockSocket: HoistedMockSocket, sockets: created };
});

vi.mock("ws", () => ({ default: MockSocket }));

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

vi.mock("../alpaca-market-data-api", () => ({
  marketDataAPI: {},
}));

import { AlpacaTradingAPI } from "../alpaca-trading-api";
import { TradingStream } from "../alpaca/streams/trading-stream";
import type { AlpacaClient } from "../alpaca/client";
import {
  TradeUpdateReceiptStamper,
  type TradeUpdateReceiptClock,
} from "../trade-update-receipt";
import type {
  AlpacaCredentials,
  TradeUpdate,
  TradeUpdateReceipt,
} from "../types/alpaca-types";

const testCredentials: AlpacaCredentials = {
  accountName: "test-account",
  apiKey: "test-api-key-123",
  apiSecret: "test-api-secret-123",
  type: "PAPER",
  orderType: "market",
  engine: "adaptic",
};

/** Builds a raw `trade_updates` frame as Alpaca delivers it on the socket. */
function tradeUpdateFrame(event: TradeUpdate["event"], orderId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      stream: "trade_updates",
      data: {
        event,
        execution_id: `exec-${orderId}-${event}`,
        timestamp: "2026-09-13T14:30:00.000Z",
        price: "101.25",
        qty: "5",
        position_qty: "5",
        order: {
          id: orderId,
          symbol: "AAPL",
          side: "buy",
          qty: "10",
          type: "market",
        },
      },
    }),
  );
}

/** A control-plane frame that must never consume a trade-update sequence slot. */
function listeningFrame(): Buffer {
  return Buffer.from(
    JSON.stringify({
      stream: "listening",
      data: { streams: ["trade_updates"] },
    }),
  );
}

function latestSocket(): (typeof sockets)[number] {
  const socket = sockets[sockets.length - 1];
  if (!socket) {
    throw new Error("no socket was opened");
  }
  return socket;
}

function receiptOf(update: TradeUpdate | undefined): TradeUpdateReceipt {
  if (!update?._receipt) {
    throw new Error("trade update carries no _receipt");
  }
  return update._receipt;
}

describe("trade-update-receipt-stamped", () => {
  beforeEach(() => {
    sockets.length = 0;
  });

  describe("AlpacaTradingAPI websocket", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("stamps every parsed trade update with a monotonic-clock receipt, wall time, connection id and per-connection seq", () => {
      const api = new AlpacaTradingAPI(testCredentials);
      const received: TradeUpdate[] = [];
      api.onTradeUpdate((update) => received.push(update));
      api.connectWebsocket();
      const socket = latestSocket();

      const monoBefore = performance.now();
      const wallBefore = Date.now();
      socket.emit("message", tradeUpdateFrame("partial_fill", "o-1"));
      socket.emit("message", listeningFrame());
      socket.emit("message", tradeUpdateFrame("fill", "o-1"));
      const monoAfter = performance.now();
      const wallAfter = Date.now();

      expect(received).toHaveLength(2);
      const first = receiptOf(received[0]);
      const second = receiptOf(received[1]);

      // Monotonic reading: on the performance.now() clock, not the epoch clock.
      expect(first.receivedAtMono).toBeGreaterThanOrEqual(monoBefore);
      expect(first.receivedAtMono).toBeLessThanOrEqual(monoAfter);
      expect(second.receivedAtMono).toBeGreaterThanOrEqual(
        first.receivedAtMono,
      );
      expect(second.receivedAtMono).toBeLessThanOrEqual(monoAfter);

      // Wall reading: epoch milliseconds.
      expect(first.receivedAtMs).toBeGreaterThanOrEqual(wallBefore);
      expect(first.receivedAtMs).toBeLessThanOrEqual(wallAfter);

      expect(first.connectionId).toEqual(expect.any(String));
      expect(first.connectionId.length).toBeGreaterThan(0);
      expect(second.connectionId).toBe(first.connectionId);
      // The listening frame between them does not consume a sequence slot.
      expect(first.seq).toBe(1);
      expect(second.seq).toBe(2);
      // The broker payload is delivered intact alongside the stamp.
      expect(received[1]?.execution_id).toBe("exec-o-1-fill");
    });

    it("stamps even when no trade-update callback is registered, so the sequence counts every received update", () => {
      const api = new AlpacaTradingAPI(testCredentials);
      api.connectWebsocket();
      const socket = latestSocket();
      socket.emit("message", tradeUpdateFrame("new", "o-2"));

      const received: TradeUpdate[] = [];
      api.onTradeUpdate((update) => received.push(update));
      socket.emit("message", tradeUpdateFrame("fill", "o-2"));

      expect(receiptOf(received[0]).seq).toBe(2);
    });

    it("mints a new connection id and restarts the sequence on reconnect", () => {
      vi.useFakeTimers();
      const api = new AlpacaTradingAPI(testCredentials);
      const received: TradeUpdate[] = [];
      api.onTradeUpdate((update) => received.push(update));

      api.connectWebsocket();
      const firstSocket = latestSocket();
      firstSocket.emit("message", tradeUpdateFrame("new", "o-3"));
      firstSocket.emit("message", tradeUpdateFrame("fill", "o-3"));

      firstSocket.emit("close");
      api.connectWebsocket();
      const secondSocket = latestSocket();
      expect(secondSocket).not.toBe(firstSocket);
      secondSocket.emit("message", tradeUpdateFrame("new", "o-4"));

      const beforeReconnect = receiptOf(received[1]);
      const afterReconnect = receiptOf(received[2]);
      expect(beforeReconnect.seq).toBe(2);
      expect(afterReconnect.seq).toBe(1);
      expect(afterReconnect.connectionId).not.toBe(
        beforeReconnect.connectionId,
      );
      vi.clearAllTimers();
    });
  });

  describe("TradingStream (modular client)", () => {
    function authenticatedStream(): {
      stream: TradingStream;
      socket: (typeof sockets)[number];
    } {
      const client = {
        isPaper: (): boolean => true,
        getConfig: (): { apiKey: string; apiSecret: string } => ({
          apiKey: "test-api-key-123",
          apiSecret: "test-api-secret-123",
        }),
      } as unknown as AlpacaClient;
      const stream = new TradingStream(client, { autoReconnect: false });
      void stream.connect();
      const socket = latestSocket();
      socket.readyState = MockSocket.OPEN;
      socket.emit("open");
      socket.emit(
        "message",
        Buffer.from(
          JSON.stringify({
            stream: "authorization",
            data: { status: "authorized", action: "authenticate" },
          }),
        ),
      );
      return { stream, socket };
    }

    it("stamps every parsed trade update with a monotonic-clock receipt and per-connection seq", () => {
      const { stream, socket } = authenticatedStream();
      const received: TradeUpdate[] = [];
      stream.onTradeUpdate((update) => received.push(update));

      const monoBefore = performance.now();
      socket.emit("message", tradeUpdateFrame("partial_fill", "o-5"));
      socket.emit("message", tradeUpdateFrame("fill", "o-5"));
      const monoAfter = performance.now();

      expect(received).toHaveLength(2);
      const first = receiptOf(received[0]);
      const second = receiptOf(received[1]);
      expect(first.receivedAtMono).toBeGreaterThanOrEqual(monoBefore);
      expect(second.receivedAtMono).toBeLessThanOrEqual(monoAfter);
      expect(first.seq).toBe(1);
      expect(second.seq).toBe(2);
      expect(second.connectionId).toBe(first.connectionId);
      stream.disconnect();
    });
  });

  describe("TradeUpdateReceiptStamper (engine-facing)", () => {
    function scriptedClock(): TradeUpdateReceiptClock & {
      advance(wallMs: number, monoMs: number): void;
    } {
      let wall = 1_757_770_000_000;
      let mono = 5_000.25;
      return {
        wallMs: (): number => wall,
        monoMs: (): number => mono,
        advance(wallDelta: number, monoDelta: number): void {
          wall += wallDelta;
          mono += monoDelta;
        },
      };
    }

    it("reads the monotonic reading from the monotonic clock and the wall reading from the wall clock", () => {
      const clock = scriptedClock();
      const ids = ["conn-a", "conn-b"];
      const stamper = new TradeUpdateReceiptStamper(clock, () => {
        const next = ids.shift();
        if (next === undefined) throw new Error("ran out of ids");
        return next;
      });

      stamper.beginConnection();
      const first = stamper.stamp({ event: "new" });
      // A wall-clock step backwards must not move the monotonic reading back.
      clock.advance(-60_000, 12.5);
      const second = stamper.stamp({ event: "fill" });

      expect(first._receipt).toEqual({
        receivedAtMs: 1_757_770_000_000,
        receivedAtMono: 5_000.25,
        connectionId: "conn-a",
        seq: 1,
      });
      expect(second._receipt).toEqual({
        receivedAtMs: 1_757_769_940_000,
        receivedAtMono: 5_012.75,
        connectionId: "conn-a",
        seq: 2,
      });

      expect(stamper.beginConnection()).toBe("conn-b");
      expect(stamper.stamp({ event: "new" })._receipt).toMatchObject({
        connectionId: "conn-b",
        seq: 1,
      });
    });

    it("the default clock stamps receivedAtMono from performance.now(), not Date.now()", () => {
      const stamper = new TradeUpdateReceiptStamper();
      stamper.beginConnection();
      const monoBefore = performance.now();
      const { _receipt } = stamper.stamp({ event: "fill" });
      const monoAfter = performance.now();
      expect(_receipt.receivedAtMono).toBeGreaterThanOrEqual(monoBefore);
      expect(_receipt.receivedAtMono).toBeLessThanOrEqual(monoAfter);
    });

    it("mints a connection lazily when an update arrives before beginConnection, rather than stamping without one", () => {
      const stamper = new TradeUpdateReceiptStamper(scriptedClock(), () => "lazy");
      expect(stamper.stamp({ event: "new" })._receipt).toMatchObject({
        connectionId: "lazy",
        seq: 1,
      });
    });

    it("returns the same object it stamped, so the parsed frame is not copied on the fill path", () => {
      const stamper = new TradeUpdateReceiptStamper();
      const update = { event: "fill" };
      expect(stamper.stamp(update)).toBe(update);
    });
  });
});
