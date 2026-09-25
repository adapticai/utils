import { randomUUID } from "node:crypto";
import type { TradeUpdateReceipt } from "./types/alpaca-types";

/**
 * The two clocks a trade-update receipt is read from.
 *
 * A receipt needs both because they answer different questions: the wall
 * clock places the update on the calendar and joins it to other systems' logs,
 * but it can be stepped (NTP slew, leap handling, manual correction), so a
 * latency computed from two wall readings can be negative or inflated. The
 * monotonic clock never moves backwards within a process, so intervals between
 * two monotonic readings are trustworthy even when the wall clock is not.
 */
export interface TradeUpdateReceiptClock {
  /** Wall-clock epoch milliseconds. */
  wallMs(): number;
  /** Monotonic milliseconds on this process's clock (never decreases). */
  monoMs(): number;
}

/**
 * The process clocks: `Date.now()` for wall time and `performance.now()` for
 * the monotonic reading.
 */
export const SYSTEM_TRADE_UPDATE_RECEIPT_CLOCK: TradeUpdateReceiptClock = {
  wallMs: (): number => Date.now(),
  monoMs: (): number => performance.now(),
};

/**
 * Stamps parsed trade updates with a {@link TradeUpdateReceipt} at the moment
 * they come off the socket.
 *
 * The receipt has to be taken at the parse site, inside the library, because
 * every later reader sees the update after some unknown queueing delay and can
 * no longer recover when it actually arrived. A per-connection sequence makes
 * dropped or duplicated frames and reconnects observable rather than silent:
 * a gap in `seq` within one `connectionId` is loss, and a new `connectionId`
 * with `seq` restarting at 1 is a reconnect.
 *
 * One stamper serves one logical stream. Call {@link beginConnection} each
 * time a new socket is opened; call {@link stamp} on every parsed trade
 * update, before handing it to any consumer.
 */
export class TradeUpdateReceiptStamper {
  private connectionId: string | null = null;
  private seq = 0;

  /**
   * @param clock - Clock pair the receipt is read from; defaults to the
   *   process clocks. Injectable so replays and tests reproduce exact stamps.
   * @param mintConnectionId - Produces a fresh, unique connection id; defaults
   *   to a random UUID.
   */
  constructor(
    private readonly clock: TradeUpdateReceiptClock = SYSTEM_TRADE_UPDATE_RECEIPT_CLOCK,
    private readonly mintConnectionId: () => string = randomUUID,
  ) {}

  /**
   * Start a new socket connection: mints a new connection id and restarts the
   * per-connection sequence, so updates from different sockets are never
   * mistaken for one contiguous stream.
   *
   * @returns The id minted for the new connection.
   */
  beginConnection(): string {
    this.connectionId = this.mintConnectionId();
    this.seq = 0;
    return this.connectionId;
  }

  /**
   * Attach a receipt to a freshly parsed trade update, in place.
   *
   * The update is mutated rather than copied so the parse-to-consumer path
   * adds no allocation of the (possibly large, multi-leg) payload. If no
   * connection has been begun, one is minted on the spot: the update still
   * arrived on *some* connection, and a stamp without a connection id would
   * be unjoinable.
   *
   * @param update - The parsed trade-update object, owned by the caller.
   * @returns The same object, now carrying `_receipt`.
   */
  stamp<T extends object>(update: T): T & { _receipt: TradeUpdateReceipt } {
    const receivedAtMono = this.clock.monoMs();
    const receivedAtMs = this.clock.wallMs();
    const connectionId = this.connectionId ?? this.beginConnection();
    this.seq += 1;
    const receipt: TradeUpdateReceipt = {
      receivedAtMs,
      receivedAtMono,
      connectionId,
      seq: this.seq,
    };
    return Object.assign(update, { _receipt: receipt });
  }
}
