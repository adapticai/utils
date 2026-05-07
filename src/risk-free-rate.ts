// risk-free-rate.ts
import { getLogger } from "./logger";
import { createTimeoutSignal, DEFAULT_TIMEOUTS } from "./http-timeout";

/**
 * Conservative fallback annual risk-free rate used when no live rate has been
 * fetched yet AND the remote source is unreachable. Chosen to roughly match the
 * longer-run (post-2000) average of the 3-month US Treasury bill yield.
 *
 * This is the rate of LAST resort. Callers that need a live number should
 * prefer {@link getRiskFreeRate} (async) and only rely on
 * {@link getCachedRiskFreeRateSync} for hot paths that cannot be made async.
 */
export const DEFAULT_RISK_FREE_RATE = 0.02;

/**
 * Provenance describing where a risk-free rate value came from.
 *
 * - `"live"`: Just fetched successfully from the Treasury Fiscal Data API.
 * - `"cached"`: Returned from the in-process cache. May be from an earlier
 *               successful fetch (the common case) OR from a stale cache that
 *               survived a failed refresh attempt — callers that want to
 *               distinguish these cases should compare `fetchedAt` against
 *               {@link RISK_FREE_RATE_TTL_MS}.
 * - `"default"`: The Treasury fetch failed AND no usable cached value was
 *               available, so {@link DEFAULT_RISK_FREE_RATE} was returned.
 *               Performance metrics computed against a `"default"` rate are
 *               using a fictional 2% baseline and should be flagged in
 *               downstream reporting.
 *
 * DE-029: previously the function returned only the numeric rate, so a fall
 * back to the 2% default propagated through Sharpe/alpha/Sortino computations
 * indistinguishable from a live observation. The provenance field closes that
 * loop.
 */
export type RiskFreeRateSource = "live" | "cached" | "default";

/**
 * Result shape returned by the provenance-aware accessors.
 *
 * @see RiskFreeRateSource
 */
export interface RiskFreeRateResult {
  /** Annualized decimal rate (e.g. 0.0452 for 4.52%). */
  rate: number;
  /** Where the rate value came from. See {@link RiskFreeRateSource}. */
  source: RiskFreeRateSource;
  /**
   * Wall-clock time the rate was last sourced. For `"live"` this is the
   * moment the fetch resolved. For `"cached"` this is the original fetch
   * time. For `"default"` this is the time the fallback was selected.
   */
  fetchedAt: Date;
}

/**
 * Cache TTL for the risk-free rate: 24 hours. Treasury yields update daily
 * (auction + close), so refreshing more aggressively provides no useful signal
 * and risks rate-limiting the public endpoint.
 */
export const RISK_FREE_RATE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * US Treasury Fiscal Data API — Daily Treasury Bill Rates. Free, no API key,
 * updated each business day. Returns the most recent 4-, 8-, 13-, 17-, 26-,
 * and 52-week T-Bill rates. We use the 13-week ("3-month") field for Sharpe /
 * alpha, which is the industry-standard short risk-free proxy.
 *
 * See https://fiscaldata.treasury.gov/datasets/daily-treasury-bill-rates/
 */
const TREASURY_BILL_RATES_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/daily_treasury_bill_rates" +
  "?sort=-record_date&page%5Bsize%5D=1" +
  "&fields=record_date,security_term_week_num,avg_inv_rate";

/**
 * Shape of the Treasury Fiscal Data daily_treasury_bill_rates response we
 * actually consume. We only model the fields we read to keep the dependency
 * surface small and typed.
 */
interface TreasuryBillRateRow {
  record_date: string;
  security_term_week_num: string;
  avg_inv_rate: string;
}

interface TreasuryBillRatesResponse {
  data?: TreasuryBillRateRow[];
}

/**
 * Internal cache state. We deliberately keep this module-local (rather than
 * per-process via LRU) because there is exactly one risk-free rate at any
 * point in time — global shared state is correct here.
 */
interface RiskFreeRateCacheEntry {
  /** Annualized decimal rate (e.g. 0.0452 for 4.52%). */
  rate: number;
  /** Unix ms when this rate was fetched. */
  fetchedAt: number;
}

let cache: RiskFreeRateCacheEntry | null = null;
let inflight: Promise<RiskFreeRateResult> | null = null;

/**
 * Clears the cached risk-free rate. Exported for tests and for callers that
 * want to force a re-fetch (e.g., at the start of a backtest run with a
 * different asOf date).
 */
export function resetRiskFreeRateCache(): void {
  cache = null;
  inflight = null;
}

/**
 * Explicitly sets the cached risk-free rate. Useful for deterministic tests,
 * backtests (where rf should be pinned to the asOf date), and environments
 * where an upstream service already provides the rate.
 *
 * @param rate - Annualized decimal rate (e.g. 0.0452 for 4.52%).
 */
export function setRiskFreeRate(rate: number): void {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(
      `Invalid risk-free rate: ${rate}. Must be a finite decimal in [0, 1].`,
    );
  }
  cache = { rate, fetchedAt: Date.now() };
}

/**
 * Returns true iff the cached entry is present and younger than the TTL.
 */
function isFresh(entry: RiskFreeRateCacheEntry | null): boolean {
  return entry !== null && Date.now() - entry.fetchedAt < RISK_FREE_RATE_TTL_MS;
}

/**
 * Fetches the latest 3-month (13-week) T-Bill annualized rate from the US
 * Treasury Fiscal Data API. Returns the rate as a decimal (e.g. 0.0452 for
 * 4.52%). Throws on any failure (network, parse, or missing field) — callers
 * are expected to handle fallback via {@link getRiskFreeRate}.
 */
async function fetchTreasuryBillRate(): Promise<number> {
  const signal = createTimeoutSignal(DEFAULT_TIMEOUTS.GENERAL);
  const res = await fetch(TREASURY_BILL_RATES_URL, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) {
    throw new Error(
      `Treasury Fiscal Data API returned HTTP ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as TreasuryBillRatesResponse;
  const rows = Array.isArray(body.data) ? body.data : [];
  if (rows.length === 0) {
    throw new Error("Treasury Fiscal Data API returned no rows");
  }
  // Prefer the 13-week (3-month) bill; fall back to the shortest term
  // available on that record date if 13-week is missing.
  const preferred =
    rows.find((row) => row.security_term_week_num === "13") ?? rows[0];
  const percent = Number.parseFloat(preferred.avg_inv_rate);
  if (!Number.isFinite(percent)) {
    throw new Error(
      `Treasury Fiscal Data API returned non-numeric rate: ${preferred.avg_inv_rate}`,
    );
  }
  // avg_inv_rate is quoted as a percentage (e.g. "4.52"); normalize to a
  // decimal for downstream math.
  return percent / 100;
}

/**
 * Provenance-aware variant of {@link getRiskFreeRate} that returns the rate
 * AND tells the caller where it came from. Use this in any code path that
 * publishes performance metrics (Sharpe, alpha, Sortino) so downstream
 * reports can flag computations made against a fictional fallback rate.
 *
 * Behavior is identical to {@link getRiskFreeRate} for the cache and
 * deduplication semantics; only the return shape differs:
 *
 * - Fresh cache hit: `{ source: "cached", fetchedAt: <original fetch time> }`
 * - Cold or stale cache + successful fetch: `{ source: "live", fetchedAt: <now> }`
 * - Cold or stale cache + failed fetch but cached value present:
 *   `{ source: "cached", fetchedAt: <original fetch time> }` — the stale
 *   value is reused so existing alpha calculations keep working through a
 *   transient outage. The provenance still says `cached`, not `live`.
 * - Cold cache + failed fetch + no cached value:
 *   `{ source: "default", fetchedAt: <now> }` — the 2% fallback is used. This
 *   is the case downstream reports MUST flag, because Sharpe / alpha computed
 *   against a 2% floor that was never observed in market data is a fiction.
 *
 * DE-029: closes the silent-failure loop where a first-fetch network failure
 * propagated `DEFAULT_RISK_FREE_RATE` indistinguishable from a live
 * observation.
 *
 * @returns The annualized risk-free rate plus its provenance.
 */
export async function getRiskFreeRateWithProvenance(): Promise<RiskFreeRateResult> {
  // Snapshot the cache reference before the freshness check so the type
  // narrows correctly without a non-null assertion (the check itself uses a
  // mutable module-level variable, which TypeScript will not narrow across).
  const snapshot = cache;
  if (snapshot !== null && isFresh(snapshot)) {
    return {
      rate: snapshot.rate,
      source: "cached",
      fetchedAt: new Date(snapshot.fetchedAt),
    };
  }

  if (inflight !== null) {
    return inflight;
  }

  inflight = (async (): Promise<RiskFreeRateResult> => {
    try {
      const rate = await fetchTreasuryBillRate();
      const fetchedAtMs = Date.now();
      cache = { rate, fetchedAt: fetchedAtMs };
      return {
        rate,
        source: "live",
        fetchedAt: new Date(fetchedAtMs),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (cache !== null) {
        getLogger().warn(
          "Failed to refresh risk-free rate; using last-known-good cached value",
          {
            error: message,
            cachedRate: cache.rate,
            cacheAgeMs: Date.now() - cache.fetchedAt,
          },
        );
        return {
          rate: cache.rate,
          source: "cached",
          fetchedAt: new Date(cache.fetchedAt),
        };
      }
      getLogger().warn(
        "Failed to fetch risk-free rate and no cached value available; falling back to DEFAULT_RISK_FREE_RATE",
        { error: message, fallback: DEFAULT_RISK_FREE_RATE },
      );
      return {
        rate: DEFAULT_RISK_FREE_RATE,
        source: "default",
        fetchedAt: new Date(),
      };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Returns the current annualized risk-free rate (decimal, e.g. 0.0452 for
 * 4.52%), fetching from the US Treasury Fiscal Data API and caching for 24h.
 *
 * Behavior:
 * - If a fresh cached value exists (<24h old), returns it without a network
 *   round-trip.
 * - If the cache is stale or empty, fetches the latest 13-week T-Bill rate,
 *   updates the cache, and returns it.
 * - If the fetch fails, returns the last-known-good cached value (even if
 *   expired) or {@link DEFAULT_RISK_FREE_RATE} as a last resort, logging a
 *   warning in both cases.
 * - Concurrent calls during a cold cache are deduplicated so only one network
 *   request is in flight at a time.
 *
 * For provenance-aware callers (performance reports, audit logging) prefer
 * {@link getRiskFreeRateWithProvenance}, which returns both the rate AND
 * whether it came from a live fetch, the cache, or the fallback default.
 *
 * @returns Annualized risk-free rate as a decimal.
 */
export async function getRiskFreeRate(): Promise<number> {
  const result = await getRiskFreeRateWithProvenance();
  return result.rate;
}

/**
 * Synchronous accessor that returns the most recent cached risk-free rate
 * without performing I/O. If the cache is stale, a background refresh is
 * kicked off (fire-and-forget) so the next synchronous call sees a fresh
 * value. Intended for hot paths (e.g., Sharpe/alpha calculation inside tight
 * loops) where the existing function signature cannot be made async.
 *
 * Callers that can tolerate an async boundary should prefer
 * {@link getRiskFreeRate}.
 *
 * @returns The cached annualized risk-free rate as a decimal, or
 *          {@link DEFAULT_RISK_FREE_RATE} if no value has been cached yet.
 */
export function getCachedRiskFreeRateSync(): number {
  return getCachedRiskFreeRateSyncWithProvenance().rate;
}

/**
 * Provenance-aware sibling of {@link getCachedRiskFreeRateSync}. Returns the
 * cached rate plus a flag indicating whether a real value has been cached
 * (`"cached"`) or whether the caller is being given the {@link DEFAULT_RISK_FREE_RATE}
 * fallback (`"default"`).
 *
 * Use this in synchronous hot paths that nonetheless need to flag computations
 * made against the fallback (e.g., real-time alpha streaming where async
 * round-trips are not viable but downstream reports must still distinguish
 * live from fictional rates).
 *
 * As with the original sync accessor, a stale cache triggers a fire-and-forget
 * background refresh so the next synchronous call sees fresh data; the call
 * itself remains synchronous and returns the last-known-good value.
 *
 * DE-029: closes the silent-failure loop where the synchronous fallback was
 * indistinguishable from a real cache hit.
 *
 * @returns A {@link RiskFreeRateResult} carrying the rate and its provenance.
 */
export function getCachedRiskFreeRateSyncWithProvenance(): RiskFreeRateResult {
  if (cache === null) {
    // Kick off a background fetch so the next sync caller has a real number.
    void getRiskFreeRateWithProvenance().catch(() => {
      // Errors are already logged inside getRiskFreeRateWithProvenance;
      // swallow here to keep this truly fire-and-forget.
    });
    return {
      rate: DEFAULT_RISK_FREE_RATE,
      source: "default",
      fetchedAt: new Date(),
    };
  }
  if (!isFresh(cache)) {
    // Stale: trigger background refresh but still return the last-known-good
    // value so the call remains synchronous.
    void getRiskFreeRateWithProvenance().catch(() => {
      // Errors are already logged inside getRiskFreeRateWithProvenance.
    });
  }
  return {
    rate: cache.rate,
    source: "cached",
    fetchedAt: new Date(cache.fetchedAt),
  };
}
