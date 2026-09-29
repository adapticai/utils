/**
 * Alpaca's hard upper limit for `trail_percent` on trailing-stop orders.
 * Submissions exceeding this value are rejected with HTTP 422 / code 42210000
 * ("trail_percent must be <= 25"). See:
 * https://docs.alpaca.markets/reference/postorder
 */
export const ALPACA_MAX_TRAIL_PERCENT = 25;
