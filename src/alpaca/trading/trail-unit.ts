/**
 * Trailing-stop replace-unit contract.
 *
 * Alpaca's order replace (`PATCH /v2/orders/{id}`) takes a single unitless
 * `trail` field. The broker reads it in the unit of the ORIGINAL order: a
 * `trail_percent` order reads `trail` as a percent, a `trail_price` order
 * reads it as dollars. A replace cannot change the unit. A caller that holds
 * a distance in one unit must therefore resolve it against the resting
 * order's unit before the replace, or the broker stores the number in the
 * other unit: a $22 dollar distance becomes a 22% trail.
 *
 * This module is the pure resolution step. It never guesses a unit, never
 * defaults a reference price, and refuses rather than send a value the broker
 * would reject or treat as effectively zero.
 */
import { AdapticUtilsError } from "../../errors";
import { AlpacaOrder } from "../../types/alpaca-types";
import { ALPACA_MAX_TRAIL_PERCENT } from "./trail-limits";

/**
 * Smallest `trail_percent` this module will send. Below it the trail is a
 * rounding artefact of the broker's tick grid rather than a protective
 * distance, so a conversion landing under it is refused.
 */
export const MIN_CONVERTED_TRAIL_PERCENT = 0.1;

/** Percent values are sent to the broker at hundredths of a percent. */
const PERCENT_DECIMALS_SCALE = 100;

/** A ratio expressed in percent. */
const PERCENT_PER_UNIT = 100;

/** The unit a resting trailing-stop order trails in. */
export type TrailUnit = "percent" | "price";

/** The unit-resolved `trail` value for a replace, with its provenance. */
export interface ResolvedTrail {
  /** The string sent as Alpaca's replace `trail` field. */
  readonly trail: string;
  /** The unit the broker will read `trail` in (the resting order's unit). */
  readonly unit: TrailUnit;
  /**
   * The reference price a dollar distance was converted against, or `null`
   * when no conversion took place.
   */
  readonly referencePrice: number | null;
}

/** Why a trail replace was refused before reaching the broker. */
export type TrailUnitRefusalReason =
  | "unit_unknown"
  | "reference_unavailable"
  | "converted_percent_out_of_range"
  | "percent_on_price_order";

/**
 * Thrown when a trail replace cannot be expressed in the resting order's unit
 * without guessing. No replace is sent; the resting stop keeps protecting.
 */
export class TrailUnitConversionRefusedError extends AdapticUtilsError {
  /** The order the replace targeted. */
  public readonly orderId: string;
  /** Why the replace was refused. */
  public readonly reason: TrailUnitRefusalReason;
  /** The converted percent, or `null` when no conversion was computed. */
  public readonly pct: number | null;
  /** The conversion reference price, or `null` when none was usable. */
  public readonly ref: number | null;

  constructor(params: {
    orderId: string;
    reason: TrailUnitRefusalReason;
    pct: number | null;
    ref: number | null;
    detail: string;
  }) {
    super(
      `Trailing stop replace refused for ${params.orderId} (${params.reason}): ${params.detail}`,
      "TRAIL_UNIT_REFUSED",
      "alpaca",
      false,
    );
    this.orderId = params.orderId;
    this.reason = params.reason;
    this.pct = params.pct;
    this.ref = params.ref;
  }
}

/** Parse a broker decimal string; `null` when absent, non-finite or not positive. */
function positiveOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Read the unit a resting trailing-stop order trails in.
 *
 * @param order - The resting order as returned by the broker.
 * @returns `"price"` for a dollar trail, `"percent"` for a percent trail, or
 *   `null` when neither (or both) unit fields carry a positive value.
 */
export function readTrailUnit(
  order: Pick<AlpacaOrder, "trail_price" | "trail_percent">,
): TrailUnit | null {
  const hasPrice = positiveOrNull(order.trail_price) !== null;
  const hasPercent = positiveOrNull(order.trail_percent) !== null;
  if (hasPrice === hasPercent) {
    return null;
  }
  return hasPrice ? "price" : "percent";
}

/**
 * Resolve the replace `trail` value for a requested trail against the resting
 * order's unit.
 *
 * - A dollar distance on a dollar order is sent unchanged.
 * - A dollar distance on a percent order is converted against
 *   `ref = max(hwm, stop_price)`. For a long the HWM is at or above the live
 *   price; for a short the stop is above it. So `ref` is at or above live on
 *   both sides, and `distance / ref` is at or below `distance / live`: the
 *   resulting stop is at or tighter than `live ∓ distance`. The percent is
 *   rounded down to hundredths, which only tightens it further.
 * - A percent on a percent order is sent unchanged.
 * - A percent on a dollar order is refused. There is no conversion that keeps
 *   the caller's intent without a live price this seam does not own.
 *
 * @param orderId - The order being replaced (for the refusal record).
 * @param order - The resting order as returned by the broker.
 * @param requested - Exactly one of a positive dollar distance or percent.
 * @returns The resolved `trail` value and its unit.
 * @throws {TrailUnitConversionRefusedError} When the unit is unknown, no
 *   finite reference exists, the converted percent falls outside
 *   [{@link MIN_CONVERTED_TRAIL_PERCENT}, {@link ALPACA_MAX_TRAIL_PERCENT}],
 *   or a percent targets a dollar order.
 */
export function resolveReplaceTrail(
  orderId: string,
  order: Pick<AlpacaOrder, "trail_price" | "trail_percent" | "hwm" | "stop_price">,
  requested: { trailPercent: number } | { trailPrice: number },
): ResolvedTrail {
  const unit = readTrailUnit(order);
  if (unit === null) {
    throw new TrailUnitConversionRefusedError({
      orderId,
      reason: "unit_unknown",
      pct: null,
      ref: null,
      detail: `order carries trail_price=${String(order.trail_price)} trail_percent=${String(order.trail_percent)}; the replace unit cannot be determined`,
    });
  }

  if ("trailPercent" in requested) {
    if (unit === "price") {
      throw new TrailUnitConversionRefusedError({
        orderId,
        reason: "percent_on_price_order",
        pct: requested.trailPercent,
        ref: null,
        detail: `a ${requested.trailPercent}% trail sent to a dollar-trail order would be stored as $${requested.trailPercent}`,
      });
    }
    return { trail: requested.trailPercent.toString(), unit, referencePrice: null };
  }

  if (unit === "price") {
    return { trail: requested.trailPrice.toString(), unit, referencePrice: null };
  }

  const candidates = [positiveOrNull(order.hwm), positiveOrNull(order.stop_price)].filter(
    (value): value is number => value !== null,
  );
  if (candidates.length === 0) {
    throw new TrailUnitConversionRefusedError({
      orderId,
      reason: "reference_unavailable",
      pct: null,
      ref: null,
      detail: `percent-trail order has no finite hwm (${String(order.hwm)}) or stop_price (${String(order.stop_price)}) to convert $${requested.trailPrice} against`,
    });
  }
  const ref = Math.max(...candidates);
  const pct =
    Math.floor((requested.trailPrice / ref) * PERCENT_PER_UNIT * PERCENT_DECIMALS_SCALE) /
    PERCENT_DECIMALS_SCALE;
  if (
    !Number.isFinite(pct) ||
    pct < MIN_CONVERTED_TRAIL_PERCENT ||
    pct > ALPACA_MAX_TRAIL_PERCENT
  ) {
    throw new TrailUnitConversionRefusedError({
      orderId,
      reason: "converted_percent_out_of_range",
      pct,
      ref,
      detail: `$${requested.trailPrice} against ref ${ref} is ${pct}%, outside [${MIN_CONVERTED_TRAIL_PERCENT}, ${ALPACA_MAX_TRAIL_PERCENT}]`,
    });
  }
  return { trail: pct.toFixed(2), unit, referencePrice: ref };
}
