/**
 * Every per-call formatting site in the library renders through the shared
 * `Intl` formatter cache, byte-identically to the per-call construction it
 * replaced.
 *
 * Each site is driven through its public entry point and checked two ways:
 * - EQUIVALENCE against the original expression (written out here verbatim,
 *   with the native Date method or a fresh `Intl` constructor) across both
 *   2026 America/New_York DST transitions and the repeated fall-back hour;
 * - NO RECONSTRUCTION: after one warm-up call, repeated calls construct no
 *   `Intl.DateTimeFormat` / `Intl.NumberFormat` and call no native
 *   `toLocale*String`. Reverting any site to its per-call form turns its
 *   no-reconstruction assertion red.
 *
 * The sites: `MarketTimeUtil` construction (`validateTimezone`, run by
 * `getMarketStatus` and its siblings on every call), `getNYTimeZone`, the
 * Massive bar-date stamp on `fetchPrices` / `fetchGroupedDaily` and the
 * Massive price report, the `time-utils` and `format-tools` formatters, the
 * `DisplayManager` log timestamp, and the Alpaca historical-bars page log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loggerInfo, loggingLog } = vi.hoisted(() => ({
  loggerInfo: vi.fn<(message: string) => void>(),
  loggingLog: vi.fn<(message: string, options?: unknown) => void>(),
}));

vi.mock("../logger", () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: loggerInfo,
    debug: vi.fn(),
  }),
}));

vi.mock("../misc-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../misc-utils")>();
  return { ...actual, fetchWithRetry: vi.fn(), logIfDebug: vi.fn() };
});

vi.mock("../utils/auth-validator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/auth-validator")>();
  return { ...actual, validateMassiveApiKey: vi.fn() };
});

vi.mock("../logging", () => ({ log: loggingLog }));

vi.mock("../rate-limiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rate-limiter")>();
  return {
    ...actual,
    rateLimiters: { ...actual.rateLimiters, alpaca: { acquire: () => Promise.resolve() } },
  };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { marketDataAPI } from "../alpaca-market-data-api";
import { DisplayManager } from "../display-manager";
import {
  dateTimeForGS,
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "../format-tools";
import {
  MarketTimeUtil,
  getMarketOpenClose,
  getMarketStatus,
  getNYTimeZone,
} from "../market-time";
import { analyseMassivePriceData, fetchGroupedDaily, fetchPrices } from "../massive";
import { fetchWithRetry } from "../misc-utils";
import {
  formatDate,
  formatDateToString,
  formatToUSEastern,
  timeAgo,
  unixTimetoUSEastern,
} from "../time-utils";

const NY = "America/New_York";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const SPRING_FORWARD_UTC = Date.UTC(2026, 2, 8, 7, 0, 0);
const FALL_BACK_UTC = Date.UTC(2026, 10, 1, 6, 0, 0);

/** Every 5 minutes across 2 h either side of both transitions, plus every minute of the repeated hour. */
function transitionInstants(): number[] {
  const instants: number[] = [];
  for (const transition of [SPRING_FORWARD_UTC, FALL_BACK_UTC]) {
    for (let t = transition - 2 * HOUR_MS; t <= transition + 2 * HOUR_MS; t += 5 * MINUTE_MS) {
      instants.push(t);
    }
  }
  for (let t = FALL_BACK_UTC - HOUR_MS; t < FALL_BACK_UTC + HOUR_MS; t += MINUTE_MS) {
    instants.push(t);
  }
  return instants;
}

const INSTANTS = transitionInstants();

/** The bar-date options `formatMassiveBarDate` passed to `toLocaleString`. */
const MASSIVE_BAR_DATE: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: NY,
  timeZoneName: "short",
  hourCycle: "h23",
};

/** Spies that observe any per-call formatter construction. */
function constructionSpies(): { assertNone: () => void } {
  const spies = [
    vi.spyOn(Intl, "DateTimeFormat"),
    vi.spyOn(Intl, "NumberFormat"),
    vi.spyOn(Date.prototype, "toLocaleString"),
    vi.spyOn(Date.prototype, "toLocaleDateString"),
    vi.spyOn(Date.prototype, "toLocaleTimeString"),
  ];
  return {
    assertNone: () => {
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    },
  };
}

function massiveBar(t: number): Record<string, unknown> {
  return { T: "AAPL", o: 1, h: 2, l: 0.5, c: 1.5, v: 100, vw: 1.2, n: 10, t };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("market-time", () => {
  it("MarketTimeUtil construction, getMarketStatus and getMarketOpenClose build no formatter per call", () => {
    getMarketStatus({ date: new Date(FALL_BACK_UTC) });
    getMarketOpenClose({ date: new Date(FALL_BACK_UTC) });
    const spies = constructionSpies();
    for (const ts of INSTANTS) {
      new MarketTimeUtil();
      getMarketStatus({ date: new Date(ts) });
      getMarketOpenClose({ date: new Date(ts) });
    }
    spies.assertNone();
  });

  it("MarketTimeUtil still rejects an invalid zone with the same error", () => {
    expect(() => new MarketTimeUtil("Not/AZone")).toThrow("Invalid timezone: Not/AZone");
    expect(() => new MarketTimeUtil("Europe/Paris")).not.toThrow();
  });

  it("getNYTimeZone returns the offset and logs the same full date, without reconstruction", () => {
    getNYTimeZone(new Date(FALL_BACK_UTC));
    const spies = constructionSpies();
    const rendered: [number, string][] = [];
    for (const ts of INSTANTS) {
      loggerInfo.mockClear();
      const offset = getNYTimeZone(new Date(ts));
      rendered.push([ts, `${offset} ${loggerInfo.mock.calls[0]?.[0] ?? "NO LOG"}`]);
    }
    spies.assertNone();
    vi.restoreAllMocks();
    for (const [ts, line] of rendered) {
      const date = new Date(ts);
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: NY,
        timeZoneName: "shortOffset",
      }).formatToParts(date);
      const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
      const offset = tz === "GMT-4" ? "-04:00" : "-05:00";
      const label = offset === "-04:00" ? "EDT" : "EST";
      const full = date.toLocaleString("en-US", { timeZone: NY });
      expect(line).toBe(
        `${offset} New York is on ${label}; using ${offset}. Full date: ${full}, time zone part: ${tz}`,
      );
    }
  });
});

describe("massive", () => {
  const mockFetchWithRetry = vi.mocked(fetchWithRetry);

  beforeEach(() => {
    mockFetchWithRetry.mockReset();
  });

  it("fetchPrices stamps every bar's date byte-identically with no per-bar construction", async () => {
    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve({ status: "OK", results: [massiveBar(FALL_BACK_UTC)] }),
    } as Response);
    await fetchPrices(
      { ticker: "AAPL", start: 0, end: 1, multiplier: 1, timespan: "minute" },
      { apiKey: "test-key" },
    );

    mockFetchWithRetry.mockResolvedValue({
      json: () => Promise.resolve({ status: "OK", results: INSTANTS.map(massiveBar) }),
    } as Response);
    const spies = constructionSpies();
    const bars = await fetchPrices(
      { ticker: "AAPL", start: 0, end: 1, multiplier: 1, timespan: "minute" },
      { apiKey: "test-key" },
    );
    spies.assertNone();
    vi.restoreAllMocks();

    expect(bars).toHaveLength(INSTANTS.length);
    bars.forEach((bar, i) => {
      expect(bar.date).toBe(new Date(INSTANTS[i]).toLocaleString("en-US", MASSIVE_BAR_DATE));
    });
    expect(bars[0].date).toBe("Mar 08, 2026, 00:00:00 EST");
  });

  it("fetchGroupedDaily stamps every result's date byte-identically with no per-result construction", async () => {
    const respond = (instants: number[]): void => {
      mockFetchWithRetry.mockResolvedValue({
        json: () =>
          Promise.resolve({
            status: "OK",
            adjusted: true,
            queryCount: instants.length,
            request_id: "r",
            resultsCount: instants.length,
            results: instants.map(massiveBar),
          }),
      } as Response);
    };
    respond([FALL_BACK_UTC]);
    await fetchGroupedDaily("2026-11-02", { apiKey: "test-key" });

    respond(INSTANTS);
    const spies = constructionSpies();
    const grouped = await fetchGroupedDaily("2026-11-02", { apiKey: "test-key" });
    spies.assertNone();
    vi.restoreAllMocks();

    grouped.results.forEach((result, i) => {
      expect(result.date).toBe(new Date(INSTANTS[i]).toLocaleString("en-US", MASSIVE_BAR_DATE));
    });
  });

  it("analyseMassivePriceData renders the same US-Eastern start and end", () => {
    const data = [FALL_BACK_UTC - 30 * MINUTE_MS, FALL_BACK_UTC + 30 * MINUTE_MS].map((t) => ({
      symbol: "AAPL",
      date: new Date(t).toISOString(),
      timeStamp: t,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      vol: 1,
      vwap: 1,
      trades: 1,
    }));
    analyseMassivePriceData(data);
    const spies = constructionSpies();
    const report = analyseMassivePriceData(data);
    spies.assertNone();
    vi.restoreAllMocks();
    const start = new Date(data[0].timeStamp).toLocaleString("en-US", { timeZone: NY });
    const end = new Date(data[1].timeStamp).toLocaleString("en-US", { timeZone: NY });
    expect(start).toBe("11/1/2026, 1:30:00 AM");
    expect(report).toContain(`Start time of data (US Eastern): ${start}`);
    expect(report).toContain(`End time of data (US Eastern): ${end}`);
  });
});

describe("time-utils and format-tools", () => {
  it("render byte-identically to their per-call originals", () => {
    const values = [0, -0, 1, -1, 0.5, 0.098, 12.3456, -12.3456, 1_234_567.891, 1e12, Number.NaN];
    for (const value of values) {
      expect(formatCurrency(value)).toBe(
        Number.isNaN(value)
          ? "$0.00"
          : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value),
      );
      expect(formatNumber(value)).toBe(
        Number.isNaN(value) ? "0" : new Intl.NumberFormat("en-US").format(value),
      );
      for (const decimals of [0, 1, 2, 4]) {
        expect(formatPercentage(value, decimals)).toBe(
          Number.isNaN(value)
            ? "0%"
            : new Intl.NumberFormat("en-US", {
                style: "percent",
                minimumFractionDigits: decimals,
              }).format(value),
        );
      }
    }

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 15, 0, 0)));
    for (const ts of INSTANTS) {
      const date = new Date(ts);
      expect(dateTimeForGS(date)).toBe(
        date
          .toLocaleString("en-AU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
          .replace(/\./g, "/"),
      );
      expect(formatToUSEastern(date)).toBe(
        date.toLocaleString("en-US", {
          timeZone: NY,
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }),
      );
      expect(formatToUSEastern(date, true)).toBe(
        date.toLocaleString("en-US", { timeZone: NY, month: "short", day: "numeric", year: "numeric" }),
      );
      expect(unixTimetoUSEastern(ts).timeString).toBe(formatToUSEastern(date));
      expect(formatDateToString(date)).toBe(
        date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        }) +
          ", at " +
          date.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
      );
      const iso = date.toISOString();
      for (const updateDate of [undefined, true]) {
        expect(formatDate(iso, updateDate)).toBe(
          new Date(iso).toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: updateDate && new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
            timeZone: "UTC",
          }),
        );
      }
      expect(timeAgo(date)).toBe(
        new Date(date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: new Date(date).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
        }),
      );
    }
    expect(formatDate("not a date")).toBe("Invalid Date");
    expect(timeAgo(new Date(Date.UTC(2025, 0, 2)))).toBe(
      new Date(Date.UTC(2025, 0, 2)).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    );
  });

  it("construct no formatter per call after the first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 10, 15, 0, 0)));
    const exercise = (ts: number): void => {
      const date = new Date(ts);
      formatCurrency(ts / 1000);
      formatNumber(ts / 1000);
      formatPercentage(ts / 1e15, 2);
      dateTimeForGS(date);
      formatToUSEastern(date);
      formatToUSEastern(date, true);
      unixTimetoUSEastern(ts);
      formatDateToString(date);
      formatDate(date.toISOString());
      formatDate(date.toISOString(), true);
      timeAgo(date);
    };
    exercise(FALL_BACK_UTC);
    const spies = constructionSpies();
    for (const ts of INSTANTS) exercise(ts);
    spies.assertNone();
  });
});

describe("DisplayManager", () => {
  it("stamps each log line with the same US-Eastern timestamp, without reconstruction", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    vi.useFakeTimers();
    const display = DisplayManager.getInstance();
    vi.setSystemTime(new Date(FALL_BACK_UTC));
    display.log("warm-up");
    const spies = constructionSpies();
    const stamps: [number, number][] = [];
    for (const ts of [FALL_BACK_UTC - 30 * MINUTE_MS, FALL_BACK_UTC + 30 * MINUTE_MS, SPRING_FORWARD_UTC]) {
      vi.setSystemTime(new Date(ts));
      stamps.push([ts, writes.length]);
      display.log(`line ${ts}`);
    }
    spies.assertNone();
    vi.restoreAllMocks();
    for (const [ts, index] of stamps) {
      const expected = new Date(ts).toLocaleString("en-US", { timeZone: NY });
      expect(writes.slice(index).join("")).toContain(`[${expected}]line ${ts}`);
    }
  });
});

describe("Alpaca historical bars page log", () => {
  it("renders the page's US-Eastern date range byte-identically, without reconstruction", async () => {
    const respond = (instants: number[]): void => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: () =>
          Promise.resolve({
            bars: {
              AAPL: instants.map((t) => ({
                t: new Date(t).toISOString(),
                o: 1,
                h: 1,
                l: 1,
                c: 1,
                v: 1,
                n: 1,
                vw: 1,
              })),
            },
            next_page_token: null,
            currency: "USD",
          }),
      });
    };
    respond([FALL_BACK_UTC]);
    await marketDataAPI.getHistoricalBars({ symbols: ["AAPL"], timeframe: "1Min" });

    const first = FALL_BACK_UTC - 4 * HOUR_MS - 30 * MINUTE_MS;
    const last = FALL_BACK_UTC + 30 * MINUTE_MS;
    respond([first, FALL_BACK_UTC, last]);
    loggingLog.mockClear();
    const spies = constructionSpies();
    await marketDataAPI.getHistoricalBars({ symbols: ["AAPL"], timeframe: "1Min" });
    spies.assertNone();
    vi.restoreAllMocks();

    const range = `${new Date(first).toLocaleDateString("en-US", { timeZone: NY })} to ${new Date(last).toLocaleDateString("en-US", { timeZone: NY })}`;
    expect(range).toBe("10/31/2026 to 11/1/2026");
    const pageLine = loggingLog.mock.calls.map(([message]) => message).find((m) => m.startsWith("Page 1:"));
    expect(pageLine).toContain(`date range: ${range}, complete`);
  });
});
