/**
 * Typed facade over the Alpaca SDK's untyped surface.
 *
 * `@alpacahq/alpaca-trade-api` ships declarations of the form
 * `export function get(): any` for every trading resource, so each SDK call
 * arrives with no type at all. Two consequences follow, and both are defects
 * this module exists to remove: consumers cannot read a field without the
 * compiler losing the type, and every call site was terminated by an
 * `as SomeType` cast — an unchecked assertion at the one boundary where the
 * data is genuinely external.
 *
 * This package owns the canonical broker/API types, so the SDK's return types
 * are declared here once, against those owned types, instead of being asserted
 * ad hoc at each call site. Parameters stay permissive: they are forwarded
 * verbatim to the SDK, and narrowing them here would claim a contract over the
 * vendor's input shapes that this package does not own.
 *
 * @module alpaca/sdk-types
 */

import type Alpaca from "@alpacahq/alpaca-trade-api";

import type { AlpacaPortfolioHistory } from "../types";
import type {
  AccountConfiguration,
  AlpacaAccountDetails,
  AlpacaOrder,
  PortfolioHistoryResponse,
} from "../types/alpaca-types";

import type { AlpacaCalendarDay, AlpacaClock } from "./trading/clock";

/**
 * The portfolio-history payload as the endpoint actually returns it.
 *
 * This package carries two partial models of `GET /v2/account/portfolio/history`
 * that predate each other: {@link PortfolioHistoryResponse} omits `timeframe`,
 * and {@link AlpacaPortfolioHistory} omits the profit/loss series. Neither is
 * wrong about the fields it does declare, and the endpoint returns the union of
 * them, so the SDK boundary is declared as that union. Consumers of either
 * partial type are satisfied by it, which is what lets each call site return the
 * response directly instead of asserting between two types that do not overlap
 * — an assertion the compiler rejects and which the vendor's `any` had hidden.
 */
export type SdkPortfolioHistoryResponse = PortfolioHistoryResponse &
  Pick<AlpacaPortfolioHistory, "timeframe">;

/** SDK methods whose return type this package supersedes. */
type SupersededSdkMethod =
  | "getAccount"
  | "getAccountConfigurations"
  | "getPortfolioHistory"
  | "getClock"
  | "getCalendar"
  | "getOrder"
  | "getOrderByClientId"
  | "getOrders"
  | "createOrder"
  | "replaceOrder";

/**
 * The Alpaca SDK as this package consumes it: the vendor surface, with the
 * methods above re-declared to return the owned domain types.
 */
export type AlpacaSdk = Omit<Alpaca, SupersededSdkMethod> & {
  getAccount(): Promise<AlpacaAccountDetails>;
  getAccountConfigurations(): Promise<AccountConfiguration>;
  getPortfolioHistory(
    params: unknown,
  ): Promise<SdkPortfolioHistoryResponse>;
  getClock(): Promise<AlpacaClock>;
  getCalendar(params?: unknown): Promise<AlpacaCalendarDay[]>;
  getOrder(orderId: string): Promise<AlpacaOrder>;
  getOrderByClientId(clientOrderId: string): Promise<AlpacaOrder>;
  getOrders(params?: unknown): Promise<AlpacaOrder[]>;
  createOrder(params: unknown): Promise<AlpacaOrder>;
  replaceOrder(orderId: string, params: unknown): Promise<AlpacaOrder>;
};
