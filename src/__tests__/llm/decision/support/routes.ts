/**
 * Route tables for the decision tests.
 *
 * The canonical table declares a hosted route nobody may call yet: its provider
 * account is not open and its contract has never been confirmed by a real call.
 * A test of anything past admission therefore needs a table in which that work
 * has been done. The one built here is the canonical table with exactly the
 * fields an operator changes at onboarding changed, so every other number in it
 * (the pin, the budget, the caps, the price) is the number the package ships
 * with, and a test that passes on it says something about the shipped table.
 *
 * It lives with the tests and is never bundled. Nothing in the package can
 * reach an admitted hosted route without being handed a table like this one.
 */

import { decisionRouteTable } from "../../../../llm/decision/decision-route-table";
import type {
  DecisionEngineServedRouteDeclaration,
  DecisionHostedProviderDeclaration,
  DecisionRouteTable,
  DecisionUtilsServedRouteDeclaration,
} from "../../../../llm/decision/route-types";
import type { DecisionRoute } from "../../../../llm/decision/types";

/** A type with every `readonly` removed, at every depth, so a clone can be edited. */
export type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

/** The route this package serves over HTTP. */
export const HOSTED_ROUTE: DecisionRoute = "dm.hosted";

/** The route the consumer serves in its own process. */
export const LOCAL_ROUTE: DecisionRoute = "dm.local";

/** The date the test table says an authenticated call confirmed the contract. */
export const TEST_CONTRACT_VERIFIED = "2026-01-15";

/**
 * An editable copy of the canonical table.
 *
 * The canonical table is frozen, so a test that needs a table which breaks a
 * rule edits a copy and hands the copy to the function under test.
 *
 * @returns A deep copy of the canonical table, with nothing shared.
 */
export function editableDecisionRouteTable(): DeepMutable<DecisionRouteTable> {
  return structuredClone(decisionRouteTable) as DeepMutable<DecisionRouteTable>;
}

/**
 * The hosted route of a table.
 *
 * @param table The table.
 * @returns Its `dm.hosted` declaration, typed as editable. An edit made through it to the frozen canonical
 * table throws, so only a copy can actually be changed.
 * @throws When the table does not declare the route as served by this package.
 */
export function hostedRouteOf(table: DecisionRouteTable): DeepMutable<DecisionUtilsServedRouteDeclaration> {
  const route = table.routes[HOSTED_ROUTE];
  if (route === undefined || route.served_by !== "utils") {
    throw new Error(`the table does not declare ${HOSTED_ROUTE} as a route this package serves`);
  }
  return route;
}

/**
 * The local route of a table.
 *
 * @param table The table.
 * @returns Its `dm.local` declaration, typed as editable; the canonical table itself stays frozen.
 * @throws When the table does not declare the route as served by the consumer.
 */
export function localRouteOf(table: DecisionRouteTable): DeepMutable<DecisionEngineServedRouteDeclaration> {
  const route = table.routes[LOCAL_ROUTE];
  if (route === undefined || route.served_by !== "engine") {
    throw new Error(`the table does not declare ${LOCAL_ROUTE} as a route the consumer serves`);
  }
  return route;
}

/**
 * The hosted provider of a table.
 *
 * @param table The table.
 * @returns The provider its `dm.hosted` route names, typed as editable; the canonical table itself stays frozen.
 * @throws When that provider is absent or is not reached over HTTP.
 */
export function hostedProviderOf(table: DecisionRouteTable): DeepMutable<DecisionHostedProviderDeclaration> {
  const name = hostedRouteOf(table).provider;
  const provider = table.providers[name];
  if (provider === undefined || provider.api_style !== "systemone") {
    throw new Error(`the table does not declare ${name} as a hosted provider`);
  }
  return provider;
}

/**
 * A table whose hosted route is admitted.
 *
 * The canonical table with the onboarding fields set as an operator would set
 * them once an account exists and one authenticated call has confirmed the
 * contract: the provider account is live, and the route's contract evidence is
 * an authenticated call made on a stated date. Nothing else differs.
 *
 * @returns The admitted table, editable so a test can break one thing in it.
 */
export function admittedDecisionRouteTable(): DeepMutable<DecisionRouteTable> {
  const table = editableDecisionRouteTable();
  hostedProviderOf(table).account_status = "live";
  const hosted = hostedRouteOf(table);
  hosted.contract_evidence = "authenticated-call";
  hosted.contract_verified = TEST_CONTRACT_VERIFIED;
  return table;
}
