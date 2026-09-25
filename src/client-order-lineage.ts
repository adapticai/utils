import { MAX_CLIENT_ORDER_ID_LENGTH } from "./alpaca/trading/orders";
import { ValidationError } from "./errors";
import type { ClientOrderLineage } from "./types/alpaca-types";

/**
 * Prefix marking a `client_order_id` as lineage-encoded.
 *
 * It sits inside the library's reserved `adaptic-` namespace (the derived
 * default is `adaptic-` + hex, which never contains `:`), so a lineage id can
 * never be confused with a derived one, and a caller-supplied id is only read
 * as lineage if it deliberately adopts this exact prefix.
 */
export const LINEAGE_CLIENT_ORDER_ID_PREFIX = "adaptic-lin:";

/** Separates the trade-intent id from the attempt number. */
const LINEAGE_SEPARATOR = ":";

/**
 * Characters permitted in a trade-intent id: Alpaca's accepted
 * `client_order_id` alphabet (`[A-Za-z0-9._:-]`, see
 * `src/alpaca/trading/orders.ts`) minus the `:` separator, which is what keeps
 * decoding unambiguous.
 */
const TRADE_INTENT_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Canonical non-negative decimal integer: no sign, no leading zeros. */
const ATTEMPT_PATTERN = /^(0|[1-9][0-9]*)$/;

/** Service label carried on validation errors raised here. */
const SERVICE = "alpaca";

/**
 * Encode a {@link ClientOrderLineage} as an Alpaca `client_order_id`.
 *
 * The broker echoes `client_order_id` on the order and on every fill event,
 * so an id that carries the trade intent makes each fill attributable to the
 * decision that caused it. A one-way hash cannot do that; this encoding is
 * reversible by {@link decodeLineageClientOrderId}.
 *
 * Format: `adaptic-lin:<tradeIntentId>` with `:<attempt>` appended when an
 * attempt is given.
 *
 * @param lineage - The intent id and optional attempt number.
 * @returns The encoded id, at most {@link MAX_CLIENT_ORDER_ID_LENGTH}
 *   characters.
 * @throws ValidationError when the intent id is blank or uses a character
 *   outside `[A-Za-z0-9._-]`, the attempt is not a non-negative safe integer,
 *   or the encoded id exceeds Alpaca's length limit. Validation happens before
 *   any order is sent, so an unencodable lineage never reaches the broker.
 */
export function encodeLineageClientOrderId(lineage: ClientOrderLineage): string {
  const { tradeIntentId, attempt } = lineage;
  if (!TRADE_INTENT_ID_PATTERN.test(tradeIntentId)) {
    throw new ValidationError(
      `Order lineage tradeIntentId "${tradeIntentId}" must be non-empty and use only [A-Za-z0-9._-] so it can be encoded into a client_order_id`,
      SERVICE,
      "lineage.tradeIntentId",
    );
  }
  if (
    attempt !== undefined &&
    (!Number.isSafeInteger(attempt) || attempt < 0)
  ) {
    throw new ValidationError(
      `Order lineage attempt must be a non-negative integer (got ${attempt})`,
      SERVICE,
      "lineage.attempt",
    );
  }
  const encoded =
    attempt === undefined
      ? `${LINEAGE_CLIENT_ORDER_ID_PREFIX}${tradeIntentId}`
      : `${LINEAGE_CLIENT_ORDER_ID_PREFIX}${tradeIntentId}${LINEAGE_SEPARATOR}${attempt}`;
  if (encoded.length > MAX_CLIENT_ORDER_ID_LENGTH) {
    throw new ValidationError(
      `Order lineage encodes to a ${encoded.length}-character client_order_id, over Alpaca's ${MAX_CLIENT_ORDER_ID_LENGTH}-character limit`,
      SERVICE,
      "lineage.tradeIntentId",
    );
  }
  return encoded;
}

/**
 * Decode a lineage-encoded `client_order_id` back to its
 * {@link ClientOrderLineage}.
 *
 * This is the read side of {@link encodeLineageClientOrderId}: given the id
 * the broker echoes on a fill, it recovers the trade intent and attempt. Any
 * id that is not exactly in the lineage format (a derived default, a
 * caller-supplied id, or a malformed lineage) decodes to `null` rather than a
 * guessed lineage, so a fill is never attributed to the wrong intent.
 *
 * @param clientOrderId - An Alpaca `client_order_id`.
 * @returns The lineage, with `attempt` present only when one was encoded; or
 *   `null` when the id is not a well-formed lineage id.
 */
export function decodeLineageClientOrderId(
  clientOrderId: string,
): ClientOrderLineage | null {
  if (!clientOrderId.startsWith(LINEAGE_CLIENT_ORDER_ID_PREFIX)) {
    return null;
  }
  const segments = clientOrderId
    .slice(LINEAGE_CLIENT_ORDER_ID_PREFIX.length)
    .split(LINEAGE_SEPARATOR);
  const [tradeIntentId, attemptText, ...rest] = segments;
  if (
    tradeIntentId === undefined ||
    rest.length > 0 ||
    !TRADE_INTENT_ID_PATTERN.test(tradeIntentId)
  ) {
    return null;
  }
  if (attemptText === undefined) {
    return { tradeIntentId };
  }
  if (!ATTEMPT_PATTERN.test(attemptText)) {
    return null;
  }
  const attempt = Number(attemptText);
  if (!Number.isSafeInteger(attempt)) {
    return null;
  }
  return { tradeIntentId, attempt };
}
