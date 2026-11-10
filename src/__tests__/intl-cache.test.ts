/**
 * The shared `Intl` formatter cache behind every per-call formatting path in
 * this library (`src/utils/intl-cache.ts`).
 *
 * Pinned:
 * - EQUIVALENCE: `formatLocaleString` / `formatLocaleDateString` /
 *   `formatLocaleTimeString` return exactly what the native Date method
 *   returns — over an option matrix that exercises every ECMA-402 defaulting
 *   branch, three locales, both 2026 America/New_York DST transitions, the
 *   repeated fall-back hour at 15-second grain, and a year-long instant sweep.
 *   Native errors (bad locale, bad zone, a style the method rejects) and the
 *   native "Invalid Date" for an invalid time value are reproduced too.
 * - DEFAULT ZONE: a request naming no `timeZone` follows a runtime change of
 *   `process.env.TZ` instead of rendering in the zone first captured.
 * - BOUNDS / FAILURE: the cache never exceeds its limit, and a constructor
 *   that throws caches nothing.
 * - COST: a cached render costs a fraction of the native per-call render,
 *   measured as a same-process ratio so the guard is host-independent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTL_FORMATTER_CACHE_LIMIT,
  cachedDateTimeFormat,
  cachedNumberFormat,
  formatLocaleDateString,
  formatLocaleString,
  formatLocaleTimeString,
  intlFormatterCacheSizesForTests,
  isSupportedTimeZone,
} from "../utils/intl-cache";

type Method = "toLocaleString" | "toLocaleDateString" | "toLocaleTimeString";

const CACHED: Record<
  Method,
  (date: Date, locale: string | undefined, options?: Intl.DateTimeFormatOptions) => string
> = {
  toLocaleString: formatLocaleString,
  toLocaleDateString: formatLocaleDateString,
  toLocaleTimeString: formatLocaleTimeString,
};

const METHODS: readonly Method[] = ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"];

const NY = "America/New_York";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** 2026-03-08 02:00 EST -> 03:00 EDT. */
const SPRING_FORWARD_UTC = Date.UTC(2026, 2, 8, 7, 0, 0);
/** 2026-11-01 02:00 EDT -> 01:00 EST; 01:00-01:59 local occurs twice. */
const FALL_BACK_UTC = Date.UTC(2026, 10, 1, 6, 0, 0);

/** A value or the error a call produced, so throwing and returning compare alike. */
type Outcome = { value: string } | { error: string; message: string };

function outcome(run: () => string): Outcome {
  try {
    return { value: run() };
  } catch (error) {
    const e = error as Error;
    return { error: e.constructor.name, message: e.message };
  }
}

/** Instants that matter: the transitions' edges, the epoch, ms precision and year edges. */
const CORE_INSTANTS: readonly number[] = [
  0,
  -1,
  Date.UTC(1969, 11, 31, 23, 59, 59, 999),
  SPRING_FORWARD_UTC - 1,
  SPRING_FORWARD_UTC,
  SPRING_FORWARD_UTC + 1,
  SPRING_FORWARD_UTC + 30 * MINUTE_MS,
  FALL_BACK_UTC - HOUR_MS - 1,
  FALL_BACK_UTC - HOUR_MS,
  FALL_BACK_UTC - 30 * MINUTE_MS,
  FALL_BACK_UTC - 1,
  FALL_BACK_UTC,
  FALL_BACK_UTC + 30 * MINUTE_MS,
  FALL_BACK_UTC + HOUR_MS,
  Date.UTC(2026, 2, 29, 1, 0, 0),
  Date.UTC(2026, 9, 25, 1, 0, 0),
  Date.UTC(2026, 3, 4, 16, 0, 0),
  Date.UTC(2026, 9, 3, 16, 0, 0),
  Date.UTC(2026, 0, 1, 0, 0, 0),
  Date.UTC(2026, 11, 31, 23, 59, 59, 999),
  Date.UTC(2026, 10, 10, 15, 27, 4, 123),
  Date.UTC(2100, 1, 28, 12, 0, 0, 7),
];

/** Every option shape that selects a different ECMA-402 defaulting branch. */
const OPTION_MATRIX: readonly Intl.DateTimeFormatOptions[] = [
  {},
  { timeZone: NY },
  { timeZone: "UTC" },
  { timeZone: NY, timeZoneName: "short" },
  { timeZone: NY, hour12: false },
  { timeZone: NY, hourCycle: "h23", timeZoneName: "short" },
  { timeZone: NY, weekday: "long" },
  { timeZone: NY, year: "numeric" },
  { timeZone: NY, hour: "2-digit" },
  { timeZone: NY, minute: "2-digit" },
  { timeZone: NY, dayPeriod: "short" },
  { timeZone: NY, fractionalSecondDigits: 3 },
  { timeZone: NY, year: undefined, month: "long" },
  { timeZone: NY, year: undefined, hour: undefined },
  { timeZone: NY, dateStyle: "medium" },
  { timeZone: NY, timeStyle: "short" },
  { timeZone: NY, dateStyle: "full", timeStyle: "long" },
  { timeZone: "Europe/London", month: "short", day: "numeric", hour: "numeric" },
  { timeZone: "Australia/Sydney", timeZoneName: "shortOffset" },
  { timeZone: "+05:30" },
];

/** The option sets the library's call sites pass, with the method each uses. */
const SITE_OPTIONS: readonly [Method, string, Intl.DateTimeFormatOptions][] = [
  [
    "toLocaleString",
    "en-US",
    {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: NY,
      timeZoneName: "short",
      hourCycle: "h23",
    },
  ],
  ["toLocaleString", "en-US", { timeZone: NY }],
  ["toLocaleDateString", "en-US", { timeZone: NY }],
  ["toLocaleString", "en-US", { timeZone: NY, month: "short", day: "numeric", year: "numeric" }],
  [
    "toLocaleString",
    "en-US",
    {
      timeZone: NY,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    },
  ],
  ["toLocaleDateString", "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }],
  [
    "toLocaleString",
    "en-AU",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    },
  ],
  [
    "toLocaleTimeString",
    "en-US",
    { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" },
  ],
];

/** Every minute across 3 h either side of both transitions, every 15 s across the repeated hour, and a year-long stride. */
function sweepInstants(): number[] {
  const instants: number[] = [];
  for (const transition of [SPRING_FORWARD_UTC, FALL_BACK_UTC]) {
    for (let t = transition - 3 * HOUR_MS; t <= transition + 3 * HOUR_MS; t += MINUTE_MS) {
      instants.push(t);
    }
  }
  for (let t = FALL_BACK_UTC - HOUR_MS; t < FALL_BACK_UTC + HOUR_MS; t += 15_000) {
    instants.push(t);
  }
  const stride = 6 * HOUR_MS + 7 * MINUTE_MS + 13_000;
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += stride) {
    instants.push(t);
  }
  return instants;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatLocale*String reproduce the native Date methods", () => {
  it("matches every method, locale and defaulting branch at the transition edges", () => {
    let compared = 0;
    for (const method of METHODS) {
      for (const locale of ["en-US", "en-AU", undefined]) {
        for (const options of OPTION_MATRIX) {
          for (const ts of CORE_INSTANTS) {
            const date = new Date(ts);
            expect(outcome(() => CACHED[method](date, locale, options))).toEqual(
              outcome(() => date[method](locale, options)),
            );
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(METHODS.length * 3 * OPTION_MATRIX.length * CORE_INSTANTS.length);
  });

  it("matches every call-site option set across the DST transitions, the repeated hour and a 2026 sweep", () => {
    const instants = sweepInstants();
    for (const [method, locale, options] of SITE_OPTIONS) {
      for (const ts of instants) {
        const date = new Date(ts);
        const cached = CACHED[method](date, locale, options);
        const native = date[method](locale, options);
        if (cached !== native) {
          throw new Error(`${method} ${locale} ${JSON.stringify(options)} @${ts}: ${cached} !== ${native}`);
        }
      }
    }
    expect(instants.length).toBeGreaterThan(2000);
  });

  it("renders both occurrences of the repeated 01:30 fall-back hour distinctly, as the native method does", () => {
    const options: Intl.DateTimeFormatOptions = { timeZone: NY, timeZoneName: "short" };
    const first = new Date(FALL_BACK_UTC - 30 * MINUTE_MS);
    const second = new Date(FALL_BACK_UTC + 30 * MINUTE_MS);
    expect(formatLocaleString(first, "en-US", options)).toBe("11/1/2026, 1:30:00 AM EDT");
    expect(formatLocaleString(second, "en-US", options)).toBe("11/1/2026, 1:30:00 AM EST");
  });

  it("returns 'Invalid Date' for an invalid time value, where format() would throw", () => {
    const invalid = new Date(Number.NaN);
    for (const method of METHODS) {
      for (const options of OPTION_MATRIX) {
        expect(outcome(() => CACHED[method](invalid, "en-US", options))).toEqual(
          outcome(() => invalid[method]("en-US", options)),
        );
      }
      expect(CACHED[method](invalid, "en-US", { timeZone: NY })).toBe("Invalid Date");
    }
  });

  it("throws the native error for an invalid locale or zone and caches nothing for it", () => {
    const date = new Date(FALL_BACK_UTC);
    const before = intlFormatterCacheSizesForTests().dateTimeFormats;
    const badLocale = outcome(() => formatLocaleString(date, "!!invalid!!", { timeZone: NY }));
    expect(badLocale).toEqual(outcome(() => date.toLocaleString("!!invalid!!", { timeZone: NY })));
    expect("error" in badLocale).toBe(true);
    const badZone = outcome(() => formatLocaleDateString(date, "en-US", { timeZone: "Not/AZone" }));
    expect(badZone).toEqual(
      outcome(() => date.toLocaleDateString("en-US", { timeZone: "Not/AZone" })),
    );
    expect("error" in badZone).toBe(true);
    expect(intlFormatterCacheSizesForTests().dateTimeFormats).toBe(before);
  });
});

describe("a request naming no timeZone follows the process default zone", () => {
  it("renders in the zone process.env.TZ names at call time", () => {
    const original = process.env.TZ;
    const date = new Date(Date.UTC(2026, 6, 1, 12, 0, 0));
    try {
      process.env.TZ = "Asia/Tokyo";
      const tokyoNative = date.toLocaleString("en-US");
      expect(formatLocaleString(date, "en-US")).toBe(tokyoNative);
      process.env.TZ = "America/Los_Angeles";
      const laNative = date.toLocaleString("en-US");
      // Precondition: the runtime honours the TZ change, so this test can fail.
      expect(laNative).not.toBe(tokyoNative);
      expect(formatLocaleString(date, "en-US")).toBe(laNative);
      expect(formatLocaleTimeString(date, "en-US", { hour12: false })).toBe(
        date.toLocaleTimeString("en-US", { hour12: false }),
      );
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("cache contract", () => {
  it("constructs one formatter per (locale, options) pair regardless of option order", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    const first = cachedDateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "numeric" });
    for (let i = 0; i < 50; i += 1) {
      expect(cachedDateTimeFormat("en-GB", { hour: "numeric", timeZone: "Asia/Dubai" })).toBe(first);
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("formatLocaleString constructs nothing after the first call for one option set", () => {
    const options: Intl.DateTimeFormatOptions = { timeZone: "America/Chicago", timeZoneName: "short" };
    formatLocaleString(new Date(0), "en-US", options);
    const ctor = vi.spyOn(Intl, "DateTimeFormat");
    const native = vi.spyOn(Date.prototype, "toLocaleString");
    for (let i = 0; i < 100; i += 1) formatLocaleString(new Date(i * HOUR_MS), "en-US", options);
    expect(ctor).not.toHaveBeenCalled();
    expect(native).not.toHaveBeenCalled();
  });

  it("stays bounded under unbounded distinct keys", () => {
    for (let integer = 1; integer <= 21; integer += 1) {
      for (let fraction = 0; fraction <= 20; fraction += 1) {
        cachedNumberFormat("en-US", {
          minimumIntegerDigits: integer,
          minimumFractionDigits: fraction,
        }).format(1);
      }
    }
    expect(intlFormatterCacheSizesForTests().numberFormats).toBeLessThanOrEqual(
      INTL_FORMATTER_CACHE_LIMIT,
    );
  });

  it("isSupportedTimeZone accepts a zone once and probes it without reconstruction", () => {
    expect(isSupportedTimeZone("America/Denver")).toBe(true);
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    for (let i = 0; i < 20; i += 1) expect(isSupportedTimeZone("America/Denver")).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    const before = intlFormatterCacheSizesForTests().dateTimeFormats;
    expect(isSupportedTimeZone("Not/AZone")).toBe(false);
    expect(intlFormatterCacheSizesForTests().dateTimeFormats).toBe(before);
  });
});

describe("cost", () => {
  it("a cached render costs under half a native per-call render", () => {
    const options = SITE_OPTIONS[0][2];
    const iterations = 3000;
    const dates = Array.from({ length: iterations }, (_, i) => new Date(FALL_BACK_UTC + i * MINUTE_MS));
    for (let i = 0; i < 200; i += 1) {
      formatLocaleString(dates[i], "en-US", options);
      dates[i].toLocaleString("en-US", options);
    }
    let start = performance.now();
    for (const date of dates) date.toLocaleString("en-US", options);
    const nativeMs = performance.now() - start;
    start = performance.now();
    for (const date of dates) formatLocaleString(date, "en-US", options);
    const cachedMs = performance.now() - start;
    expect(cachedMs).toBeLessThan(nativeMs * 0.5);
  });
});
