/**
 * Market Clock and Calendar Module
 * Provides access to market hours (clock) and trading calendar via the Alpaca API
 */
import { AlpacaClient } from "../client";
import { log as baseLog } from "../../logging";
import { LogOptions } from "../../types/logging-types";

const log = (message: string, options: LogOptions = { type: "info" }) => {
  baseLog(message, { ...options, source: "AlpacaClock" });
};

/**
 * Alpaca market clock representing the current market status and next session times.
 * Corresponds to the response from GET /v2/clock.
 */
export interface AlpacaClock {
  /** ISO 8601 timestamp of the current server time */
  timestamp: string;
  /** Whether the market is currently open for trading */
  is_open: boolean;
  /** ISO 8601 timestamp of the next market open */
  next_open: string;
  /** ISO 8601 timestamp of the next market close */
  next_close: string;
}

/**
 * A single trading day entry from the Alpaca market calendar.
 * Corresponds to one element in the response from GET /v2/calendar.
 */
export interface AlpacaCalendarDay {
  /** The date in YYYY-MM-DD format */
  date: string;
  /** The market open time in HH:MM format (US Eastern) */
  open: string;
  /** The market close time in HH:MM format (US Eastern) */
  close: string;
  /** The settlement date in YYYY-MM-DD format */
  settlement_date: string;
}

/**
 * Options for fetching the Alpaca market calendar.
 */
export interface GetAlpacaCalendarOptions {
  /** Start date for the calendar range (inclusive). Defaults to today if omitted. */
  start?: Date;
  /** End date for the calendar range (inclusive). Defaults to today if omitted. */
  end?: Date;
}

/**
 * Formats a Date to a YYYY-MM-DD string suitable for Alpaca calendar API requests.
 *
 * @param date - The date to format
 * @returns Date string in YYYY-MM-DD format
 */
function formatCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Fetches the current market clock from Alpaca (GET /v2/clock).
 *
 * Returns the current server time, whether the market is open, and the next
 * open/close timestamps. Useful for determining whether trading is currently
 * possible before placing orders.
 *
 * @param client - An initialized AlpacaClient instance
 * @returns Promise resolving to the current market clock status
 *
 * @example
 * ```ts
 * const clock = await getAlpacaClock(client);
 * if (clock.is_open) {
 *   console.log('Market is open, next close:', clock.next_close);
 * } else {
 *   console.log('Market closed, next open:', clock.next_open);
 * }
 * ```
 *
 * @throws {Error} If the Alpaca API request fails
 */
export async function getAlpacaClock(
  client: AlpacaClient,
): Promise<AlpacaClock> {
  log("Fetching market clock");
  try {
    const sdk = client.getSDK();
    const clock = await client.executeWithRateLimit(() => sdk.getClock(), "getClock");
    log(
      `Market clock fetched: is_open=${clock.is_open}, next_open=${clock.next_open}`,
    );
    return clock as AlpacaClock;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`Failed to fetch market clock: ${errorMessage}`, { type: "error" });
    throw error;
  }
}

/**
 * Fetches the market trading calendar from Alpaca (GET /v2/calendar).
 *
 * Returns the scheduled open and close times for each trading day within the
 * requested date range. The calendar accounts for market holidays and early
 * closures. Dates default to today when omitted.
 *
 * @param client - An initialized AlpacaClient instance
 * @param options - Optional start/end dates for the calendar range
 * @returns Promise resolving to an array of trading calendar days
 *
 * @example
 * ```ts
 * // Fetch the next 5 trading days
 * const today = new Date();
 * const nextWeek = new Date(today);
 * nextWeek.setDate(today.getDate() + 7);
 *
 * const calendar = await getAlpacaCalendar(client, {
 *   start: today,
 *   end: nextWeek,
 * });
 * console.log('Trading days this week:', calendar.length);
 * ```
 *
 * @throws {Error} If the Alpaca API request fails
 */
export async function getAlpacaCalendar(
  client: AlpacaClient,
  options?: GetAlpacaCalendarOptions,
): Promise<AlpacaCalendarDay[]> {
  const startStr = options?.start
    ? formatCalendarDate(options.start)
    : undefined;
  const endStr = options?.end ? formatCalendarDate(options.end) : undefined;

  log(
    `Fetching market calendar${startStr ? ` from ${startStr}` : ""}${endStr ? ` to ${endStr}` : ""}`,
  );

  try {
    const sdk = client.getSDK();
    const calendar = await client.executeWithRateLimit(
      () => sdk.getCalendar({
        start: startStr,
        end: endStr,
      }),
      "getCalendar",
    );
    log(`Market calendar fetched: ${calendar.length} trading days`);
    return calendar as AlpacaCalendarDay[];
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    log(`Failed to fetch market calendar: ${errorMessage}`, { type: "error" });
    throw error;
  }
}

export default {
  getAlpacaClock,
  getAlpacaCalendar,
};
