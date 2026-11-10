/**
 * Memoised `Intl` formatters for the library's per-call formatting paths.
 *
 * Constructing an `Intl.DateTimeFormat` or `Intl.NumberFormat` instantiates an
 * ICU formatter: tens of microseconds of synchronous work. A call such as
 * `date.toLocaleString("en-US", { timeZone })` pays that price on EVERY call,
 * because V8 reuses a cached ICU formatter only when no options are passed.
 * Measured on Node 22: ~33 µs for a per-bar `toLocaleString` with a time zone
 * against ~1.4 µs for `format()` on a formatter built once, and ~25 µs for a
 * bare `Intl.DateTimeFormat(undefined, { timeZone })` validity probe. Inside a
 * per-bar `.map` over a vendor history, or a constructor that runs on every
 * market-status read, that is milliseconds of event-loop block per call.
 *
 * A formatter is immutable once constructed and `format()` is a pure function
 * of its input, so one shared instance per (locale, options) pair returns the
 * byte-identical string the per-call construction did. The `toLocale*String`
 * replacements below reproduce the ECMA-402 option defaulting each Date method
 * applies before it builds its formatter, and the `"Invalid Date"` result a
 * Date method returns for an invalid time value, where `format()` would throw.
 *
 * The cache is bounded: on overflow the oldest entry is evicted, so a caller
 * passing arbitrary locales or options never grows it without limit. A
 * constructor that throws (an unsupported locale, currency or time zone)
 * caches nothing and rethrows, so every caller's fallback runs unchanged.
 *
 * A formatter built without an explicit `timeZone` captures the process's
 * default zone at construction. Node re-resolves that default when
 * `process.env.TZ` is assigned, so the key for a zone-less request carries the
 * current `TZ` value and a changed default builds a new formatter rather than
 * rendering in the zone the first one captured.
 *
 * @module utils/intl-cache
 */

/** Upper bound on distinct cached formatters per formatter kind. */
export const INTL_FORMATTER_CACHE_LIMIT = 128;

/** Which Date method's option defaulting a formatter must reproduce. */
type DateMethod = "toLocaleString" | "toLocaleDateString" | "toLocaleTimeString";

/** A value the cache key can carry for one option. */
type OptionValue = string | number | boolean;

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

const DATE_COMPONENTS: readonly (keyof Intl.DateTimeFormatOptions)[] = [
  "weekday",
  "year",
  "month",
  "day",
];
const TIME_COMPONENTS: readonly (keyof Intl.DateTimeFormatOptions)[] = [
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
];

/** The string every Date `toLocale*String` method returns for an invalid time value. */
const INVALID_DATE = "Invalid Date";

/**
 * The process's configured default time zone, as the key for a request that
 * names no `timeZone`. Undefined outside Node or when `TZ` is unset.
 *
 * @returns The current `TZ` value, if any.
 */
function defaultZoneKey(): string | undefined {
  return typeof process === "undefined" ? undefined : process.env.TZ;
}

/**
 * Build a stable cache key from a locale and an options object. Entries are
 * sorted so two option objects with the same entries in a different order
 * share one formatter, and an explicitly-undefined option is dropped exactly
 * as the constructor ignores it.
 *
 * @param kind - Formatter kind, so the two caches never share a key space.
 * @param locale - BCP 47 locale tag, or undefined for the runtime default.
 * @param options - Formatter options.
 * @returns The cache key.
 */
function cacheKey(
  kind: "number" | "date",
  locale: string | undefined,
  options: Intl.NumberFormatOptions | Intl.DateTimeFormatOptions,
): string {
  const entries: [string, OptionValue][] = [];
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined) continue;
    entries.push([name, value as OptionValue]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const zone =
    kind === "date" && (options as Intl.DateTimeFormatOptions).timeZone === undefined
      ? `|tz=${defaultZoneKey() ?? ""}`
      : "";
  return `${kind}|${locale ?? ""}|${JSON.stringify(entries)}${zone}`;
}

/**
 * Return the cached formatter for `key`, constructing and caching it on a miss.
 *
 * @param cache - The per-kind cache.
 * @param key - Cache key for the locale and options.
 * @param construct - Builds the formatter; may throw, in which case nothing is
 *   cached and the error propagates.
 * @returns The shared formatter.
 */
function memoised<T>(cache: Map<string, T>, key: string, construct: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const formatter = construct();
  if (cache.size >= INTL_FORMATTER_CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done !== true) cache.delete(oldest.value);
  }
  cache.set(key, formatter);
  return formatter;
}

/**
 * Shared `Intl.NumberFormat` for a locale and options pair.
 *
 * @param locale - BCP 47 locale tag, or undefined for the runtime default.
 * @param options - Number format options.
 * @returns A formatter equivalent to `new Intl.NumberFormat(locale, options)`.
 * @throws {RangeError} When the locale or options are invalid, exactly as the
 *   constructor would.
 */
export function cachedNumberFormat(
  locale: string | undefined,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  return memoised(numberFormats, cacheKey("number", locale, options), () => {
    return new Intl.NumberFormat(locale, options);
  });
}

/**
 * Shared `Intl.DateTimeFormat` for a locale and options pair.
 *
 * @param locale - BCP 47 locale tag, or undefined for the runtime default.
 * @param options - Date-time format options.
 * @returns A formatter equivalent to `new Intl.DateTimeFormat(locale, options)`.
 * @throws {RangeError} When the locale, time zone or options are invalid,
 *   exactly as the constructor would.
 */
export function cachedDateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormat {
  return memoised(dateTimeFormats, cacheKey("date", locale, options), () => {
    return new Intl.DateTimeFormat(locale, options);
  });
}

/**
 * Whether `timeZone` is an IANA zone (or offset) the runtime accepts.
 *
 * The probe builds a formatter for the zone; a valid zone's formatter is kept
 * in the shared cache, so repeated checks of one zone construct nothing. An
 * invalid zone throws in the constructor, caches nothing, and reads false.
 *
 * @param timeZone - The zone to check.
 * @returns True when `Intl.DateTimeFormat` accepts the zone.
 */
export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    cachedDateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether any of `names` carries a value in `options`.
 *
 * @param options - The caller's options.
 * @param names - Option names to look for.
 * @returns True when at least one is present and not undefined.
 */
function hasAny(
  options: Intl.DateTimeFormatOptions,
  names: readonly (keyof Intl.DateTimeFormatOptions)[],
): boolean {
  return names.some((name) => options[name] !== undefined);
}

/**
 * The formatter options a Date `toLocale*String` method constructs from the
 * caller's options, per ECMA-402 `CreateDateTimeFormat(required, defaults)`:
 * `toLocaleString` requires ANY and defaults ALL, `toLocaleDateString`
 * requires and defaults DATE, `toLocaleTimeString` requires and defaults TIME.
 * When the caller names no component of the required kind and no style, the
 * defaulted components are added as `"numeric"`.
 *
 * Returns undefined for the one combination the method itself rejects (a
 * `timeStyle` passed to `toLocaleDateString`, a `dateStyle` passed to
 * `toLocaleTimeString`), so the caller defers to the native method and its
 * native error.
 *
 * @param method - The Date method being reproduced.
 * @param options - The caller's options.
 * @returns The equivalent constructor options, or undefined to defer.
 */
function methodOptions(
  method: DateMethod,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatOptions | undefined {
  const wantsDate = method !== "toLocaleTimeString";
  const wantsTime = method !== "toLocaleDateString";
  if (method === "toLocaleDateString" && options.timeStyle !== undefined) return undefined;
  if (method === "toLocaleTimeString" && options.dateStyle !== undefined) return undefined;

  const styled = options.dateStyle !== undefined || options.timeStyle !== undefined;
  const named =
    (wantsDate && hasAny(options, DATE_COMPONENTS)) ||
    (wantsTime && hasAny(options, TIME_COMPONENTS));
  if (styled || named) return options;

  const defaulted: Intl.DateTimeFormatOptions = { ...options };
  if (wantsDate) {
    defaulted.year = "numeric";
    defaulted.month = "numeric";
    defaulted.day = "numeric";
  }
  if (wantsTime) {
    defaulted.hour = "numeric";
    defaulted.minute = "numeric";
    defaulted.second = "numeric";
  }
  return defaulted;
}

/**
 * Render `date` exactly as the named Date method would, through a shared
 * formatter.
 *
 * @param method - The Date method being reproduced.
 * @param date - The instant to render.
 * @param locale - BCP 47 locale tag, or undefined for the runtime default.
 * @param options - The options the caller would pass to the method.
 * @returns The rendered string.
 */
function renderAs(
  method: DateMethod,
  date: Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (Number.isNaN(date.getTime())) return INVALID_DATE;
  const resolved = methodOptions(method, options);
  if (resolved === undefined) return date[method](locale, options);
  return cachedDateTimeFormat(locale, resolved).format(date);
}

/**
 * `date.toLocaleString(locale, options)` through a shared formatter.
 *
 * @param date - The instant to render.
 * @param locale - BCP 47 locale tag, or undefined for the runtime default.
 * @param options - The options `toLocaleString` would receive.
 * @returns The byte-identical string `toLocaleString` returns.
 * @throws {RangeError} When the locale or options are invalid, as the method would.
 */
export function formatLocaleString(
  date: Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return renderAs("toLocaleString", date, locale, options);
}

/**
 * `date.toLocaleDateString(locale, options)` through a shared formatter.
 *
 * @param date - The instant to render.
 * @param locale - BCP 47 locale tag, or undefined for the runtime default.
 * @param options - The options `toLocaleDateString` would receive.
 * @returns The byte-identical string `toLocaleDateString` returns.
 * @throws {RangeError|TypeError} When the locale or options are invalid, as the method would.
 */
export function formatLocaleDateString(
  date: Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return renderAs("toLocaleDateString", date, locale, options);
}

/**
 * `date.toLocaleTimeString(locale, options)` through a shared formatter.
 *
 * @param date - The instant to render.
 * @param locale - BCP 47 locale tag, or undefined for the runtime default.
 * @param options - The options `toLocaleTimeString` would receive.
 * @returns The byte-identical string `toLocaleTimeString` returns.
 * @throws {RangeError|TypeError} When the locale or options are invalid, as the method would.
 */
export function formatLocaleTimeString(
  date: Date,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return renderAs("toLocaleTimeString", date, locale, options);
}

/**
 * Test-only: number of cached formatters of each kind.
 *
 * @returns The current cache sizes.
 */
export function intlFormatterCacheSizesForTests(): {
  numberFormats: number;
  dateTimeFormats: number;
} {
  return { numberFormats: numberFormats.size, dateTimeFormats: dateTimeFormats.size };
}
