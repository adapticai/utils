/**
 * Alpaca asset payloads, normalised at the vendor boundary.
 *
 * Alpaca states a US equity's borrow availability on `borrow_status`, an enum
 * of `easy_to_borrow` and `hard_to_borrow`, and omits the field for every
 * other asset class. Borrow availability decides what a short costs, so the
 * only safe reading of an omitted or unrecognised value is "not stated": a
 * reader that filled the gap with either member would price an unknown borrow
 * as known. This module therefore passes a recognised value through, leaves
 * an absent one absent, and drops an unrecognised one (with a warning) rather
 * than letting a string the union does not name reach a consumer. It never
 * derives `borrow_status` from the legacy `easy_to_borrow` boolean or the
 * reverse; each is the vendor's own statement or nothing.
 *
 * Every other field is carried through unchanged, so a payload that already
 * matches the type comes back deep-equal to what the vendor sent.
 *
 * @module alpaca/asset-normalize
 */

import type { AlpacaAsset, AlpacaBorrowStatus } from "../types/alpaca-types";
import { getLogger } from "../logger";

/** Every `borrow_status` value Alpaca's asset schema defines. */
export const ALPACA_BORROW_STATUSES: readonly AlpacaBorrowStatus[] = [
  "easy_to_borrow",
  "hard_to_borrow",
];

/**
 * Whether a wire value is one of Alpaca's defined borrow statuses.
 *
 * @param value - The raw `borrow_status` value from a payload.
 * @returns True only for a member of {@link ALPACA_BORROW_STATUSES}.
 */
export function isAlpacaBorrowStatus(
  value: unknown,
): value is AlpacaBorrowStatus {
  return (
    typeof value === "string" &&
    (ALPACA_BORROW_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Normalise one Alpaca asset payload.
 *
 * @param raw - A parsed `GET /v2/assets/{symbol}` body or one element of a
 *   `GET /v2/assets` body.
 * @returns The asset with `borrow_status` present only when the vendor stated
 *   a recognised value, and `easy_to_borrow` present only when the vendor sent
 *   a boolean. Every other field is the vendor's own.
 * @throws Error when the payload is not an object, since no field of it can
 *   then be read.
 */
export function normalizeAlpacaAsset(raw: unknown): AlpacaAsset {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(
      `Alpaca asset payload is not an object (received ${raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw})`,
    );
  }
  const {
    borrow_status: borrowStatus,
    easy_to_borrow: easyToBorrow,
    ...rest
  } = raw as Record<string, unknown>;
  const asset = { ...rest } as unknown as AlpacaAsset;

  if (isAlpacaBorrowStatus(borrowStatus)) {
    asset.borrow_status = borrowStatus;
  } else if (borrowStatus !== undefined) {
    getLogger().warn(
      "Alpaca asset carries an unrecognised borrow_status; treating borrow as not stated",
      { symbol: rest.symbol, borrowStatus },
    );
  }

  if (typeof easyToBorrow === "boolean") {
    asset.easy_to_borrow = easyToBorrow;
  } else if (easyToBorrow !== undefined) {
    getLogger().warn(
      "Alpaca asset carries a non-boolean easy_to_borrow; treating it as not stated",
      { symbol: rest.symbol, easyToBorrow },
    );
  }

  return asset;
}

/**
 * Normalise a `GET /v2/assets` body.
 *
 * @param raw - The parsed response body.
 * @returns Each element normalised by {@link normalizeAlpacaAsset}.
 * @throws Error when the body is not an array or an element is not an object.
 */
export function normalizeAlpacaAssets(raw: unknown): AlpacaAsset[] {
  if (!Array.isArray(raw)) {
    throw new Error(
      `Alpaca assets payload is not an array (received ${raw === null ? "null" : typeof raw})`,
    );
  }
  return raw.map((element: unknown) => normalizeAlpacaAsset(element));
}
