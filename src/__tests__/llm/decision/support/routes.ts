/**
 * Route tables for the decision tests.
 *
 * Two tables are built here, from the shipped one, by setting exactly the
 * fields onboarding decides: one in which the hosted provider's account is open
 * and its contract confirmed, and one in which neither is. Every other number
 * in each (the pin, the budget, the caps, the price) is the number the package
 * ships with, so a test that passes on either says something about the shipped
 * table.
 *
 * Both are written out rather than read off the canonical table, because the
 * canonical table's own onboarding fields are the subject of a test and a
 * fixture that merely copied them would move with them. A test that needs an
 * admitted route and a test that needs a closed one each ask for the table it
 * needs, whichever way the shipped table currently stands.
 *
 * They live with the tests and are never bundled.
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

/** The route this package serves over HTTP, pinned to the vendor's stable release. */
export const HOSTED_ROUTE: DecisionRoute = "dm.hosted";

/** The route this package serves over HTTP, pinned to the vendor's newest release. */
export const PREVIEW_ROUTE: DecisionRoute = "dm.hosted.preview";

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
 * The preview route of a table: the one pinned to the vendor's newest release.
 *
 * @param table The table.
 * @returns Its `dm.hosted.preview` declaration, typed as editable; the
 *   canonical table itself stays frozen.
 * @throws When the table does not declare the route as served by this package.
 */
export function previewRouteOf(table: DecisionRouteTable): DeepMutable<DecisionUtilsServedRouteDeclaration> {
  const route = table.routes[PREVIEW_ROUTE];
  if (route === undefined || route.served_by !== "utils") {
    throw new Error(`the table does not declare ${PREVIEW_ROUTE} as a route this package serves`);
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
 * A table whose hosted routes are admitted.
 *
 * The canonical table with the onboarding fields set as an operator sets them
 * once an account exists and one authenticated call has confirmed the contract:
 * the provider account is live, and each route's contract evidence is an
 * authenticated call made on a stated date. Nothing else differs.
 *
 * @returns The admitted table, editable so a test can break one thing in it.
 */
export function admittedDecisionRouteTable(): DeepMutable<DecisionRouteTable> {
  const table = editableDecisionRouteTable();
  hostedProviderOf(table).account_status = "live";
  // Both hosted routes, because they share one provider account: an operator
  // who opens the account opens it for every route that names it, and a table
  // that admitted one of them would not be the table the package ships.
  for (const route of [hostedRouteOf(table), previewRouteOf(table)]) {
    route.contract_evidence = "authenticated-call";
    route.contract_verified = TEST_CONTRACT_VERIFIED;
  }
  return table;
}

/**
 * A table whose hosted routes are closed.
 *
 * The inverse of {@link admittedDecisionRouteTable}, and the same two fields:
 * the provider account is not open, and neither route's contract has been
 * confirmed by a call. It is what a test asking what the client does with a
 * route it may not call needs, and it stays that table whatever the shipped
 * one says, so the refusal a test exercises is the refusal the gate makes and
 * not a reading of today's canonical value.
 *
 * @returns The closed table, editable so a test can open one thing in it.
 */
export function closedDecisionRouteTable(): DeepMutable<DecisionRouteTable> {
  const table = editableDecisionRouteTable();
  hostedProviderOf(table).account_status = "pending-onboarding";
  for (const route of [hostedRouteOf(table), previewRouteOf(table)]) {
    route.contract_evidence = "documentation";
    route.contract_verified = null;
  }
  return table;
}
