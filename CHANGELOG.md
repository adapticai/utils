# Changelog — `@adaptic/utils` (stable-release / 0.0.x lineage)

Notable behavioral contract changes for consumers of the published package.
Versions are stamped by CI on push to `stable-release`; entries reference the
first version carrying the change.

## Unreleased (next 0.0.x after 0.0.1007)

### Changed

- **`AlpacaTradingAPI` order paths recover derived `client_order_id` 422
  duplicates.** When the wrapper-derived idempotency key collides broker-side:
  a live/filled colliding order is returned as idempotent success; a
  terminally-dead colliding order (canceled/expired/rejected) triggers exactly
  one resubmit with a fresh salt; a failed status lookup fails closed. A
  caller-supplied `clientOrderId` is never recovered — its duplicate rejection
  now surfaces as a typed `DuplicateClientOrderIdError` (exported) instead of a
  generic `Error`, with `clientOrderId` and `wasDerived` fields.
- **`idempotencyNonce` parameter** added to `createTrailingStop`,
  `createMarketOrder`, `createLimitOrder`, `createOptionOrder`,
  `createMultiLegOptionOrder`, and `createEquitiesTrade` options: folds an
  attempt/signal discriminator into the derived id so an intentionally-repeated
  identical order inside one 300s derivation window receives a distinct id.
- **Market-data transient retry is budget-bounded.** The retry loop on
  `AlpacaMarketDataAPI` reads now enforces a cumulative deadline of 1.5x the
  per-attempt client timeout and retries a client-deadline expiry at most once;
  connection-phase faults (ECONNRESET class) keep their fast retries. New
  classifier `isClientDeadlineExpiry` exported from `utils/retry`.
- **`StampedeProtectedCache` validates `loadTimeoutMs` at construction**
  (RangeError on non-positive/non-finite values; exported
  `DEFAULT_LOAD_TIMEOUT_MS`), and a loader abandoned at the timeout ceiling no
  longer writes its late value over data cached by a fresher retry.
- **`calculateExpenseRatio` returns `"N/A"`** (never `"Infinity%"`/`"NaN%"`)
  when account equity is zero, negative, or unparseable.

## 0.0.1003 (2026-08 audit line)

### Changed — action required for unmigrated consumers

- **`cancelAllOrders()` and `closeAllPositions()` now THROW on partial
  failure.** Alpaca's bulk endpoints return 207 Multi-Status with a 2xx
  top-level status even when individual orders/positions fail; previous
  versions swallowed those failures (and transport errors) and recorded false
  success. Both methods now parse the per-item statuses and reject listing
  every item with status >= 300 (`"<symbol-or-id>:<status>"`), and transport
  errors propagate. Callers acting as live-stop failsafes must catch and treat
  rejection as a degraded activation. Survey at 2026-08-08: the engine's
  `failsafe-broker-actions.ts` (sole external call site of the class) already
  handles rejection; `app`/`platform` do not consume these methods (they ship
  their own REST routes / engine adapters).
- Every order-creation path applies a **derived deterministic
  `client_order_id`** (`adaptic-` + 32-hex, 5-minute window bucket) when the
  caller supplies none, so a client-timeout retry is de-duplicated broker-side.
  See the Unreleased entry for the 422-duplicate recovery added on top.
