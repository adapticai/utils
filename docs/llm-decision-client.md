# The typed decision client

`src/llm/decision/` asks a typed decision model a bounded question about a piece of state and returns a probability distribution over the question's own options. It is exported from the package root beside the generative client and shares nothing with it except the provider rate guard and the breaker class.

Design of record: `docs/superpowers/specs/2026-10-01-typed-decision-models-design.md` in the meta repo (D1, D2, D6, D7, D12, section 3.2).

## What the published package does today

It refuses both routes. `dm.hosted` is declared `pending-onboarding` with documentation-only contract evidence, and `dm.local` is answered by the consumer's own process. `callDecisionModel` on either rejects with fault `unavailable` before the request is read, a guard is charged or a socket is opened. Opening the hosted route is a change to `decision-routes.json` and a release of this package; no running process can do it.

## Surface

```ts
import { callDecisionModel } from "@adaptic/utils";

const result = await callDecisionModel(
  "dm.hosted",
  {
    state: "Help! My payouts have been failing for 3 days.",
    questions: {
      department: {
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: { billing: "Payments, invoicing, refunds", technical: null },
      },
    },
  },
  { timeoutMs: 300, correlationId: "trace-1" },
);
```

| Export | What it is |
| --- | --- |
| `callDecisionModel(route, request, options?)` | The one way to reach a decision model. Resolves with `DecisionCallResult` or rejects with a `DecisionCallError`. |
| `configureDecisionClient({ routeTable?, transport?, now? })` | Wiring for tests and the onboarding probe. Rebuilds the breakers. Throws on a table that breaks a load-time rule. |
| `decisionBreakers()`, `decisionBreakerKey(route)` | The decision routes' own breaker registry, keyed `decision:<route>`. |
| `decisionRouteTable`, `listDecisionRoutes()`, `decisionRouteDeclaration(route)`, `decisionRouteAdmission(route, provider)`, `decisionRouteViolations(table)` | The route table and its pure readers. A consumer that serves `dm.local` reads its checkpoint, caps and budget from here. |
| `encodeDecisionRequest`, `decodeDecisionResponse` | The pure codec, for a consumer that serves a route itself. |
| `decisionUsageOf` | Usage and cost at a route's declared price. |
| `DECISION_ROUTES`, `DECISION_FAULTS`, `DECISION_UNAVAILABLE_CODES` | The closed vocabularies. |
| `DecisionCallError` and its eight subclasses | The typed rejections. |

The function that builds the hosted transport is deliberately not exported. It checks no admission and holds no breaker, guard or budget, so the client is the only exported way to reach the vendor. Its types are exported, because typing a transport for `configureDecisionClient` needs them.

### Options

| Option | Meaning |
| --- | --- |
| `timeoutMs` | The caller's deadline for the whole call. It narrows the route's `budget_ms` and never widens it. Zero or negative means the deadline has passed, and the call is refused as `admission` before anything is charged. A value that is not a number is refused as `schema`. |
| `signal` | The caller's cancellation. |
| `correlationId` | Recorded on the attempt. Never sent to the vendor. |
| `probabilitySumTolerance` | How far a distribution's sum may differ from one before the answer is rejected. Absent: the sum is reported in `probabilitySums` and not enforced. |

### Result

`answers` are the validated wire answers, with distribution keys in the request's option order. `probabilitySums` holds each distribution's raw sum and `null` for a yes/no. `servedModel` is the model the vendor reports answered, which is always the route's pin on a result. `usage` carries the reported token counts and the cost at the route's price; a count the vendor did not report is `null`, and so is a cost that depends on it. `attempt` is the record of the one attempt.

A yes/no answer has no `confidence`, because the contract defines none. A choice's or a score's `confidence` and a score's `score` are the vendor's own statistics, carried as stated and never recomputed.

## The order of a call

1. **Resolve the route.** An unadmitted route rejects `unavailable` here. Nothing else has been touched.
2. **Check the options, then copy, encode and write the request**, in one synchronous step before the call returns its promise. The request is copied with each member read once, the copy is validated against the route's caps, and it is written as JSON once to prove it can be. What is later sent is that copy, so a caller that changes its request while the call waits changes nothing that reaches the vendor, and the answer is decoded against the questions that were sent.
3. **Fix the budget**: the smaller of the route's `budget_ms` and the caller's `timeoutMs`. One timer covers the queue and the vendor together.
4. **Consult the breaker.** An open breaker rejects `unavailable` (`breaker_open`).
5. **Enter the provider guards and dispatch once.** The guarded dispatch is raced against the budget, because the rate queue waits for the limits entry's own `acquire_timeout_ms` whatever budget it is handed.
6. **Compare the answering model with the pin**, on the whole id as reported, before the body is decoded.
7. **Decode** against the request as sent.

There is one attempt. Nothing retries, hedges or falls back: a retry hint is returned on the error and never slept on. Walking routes is the caller's job.

## Faults

Every rejection is a `DecisionCallError` whose own enumerable `fault` is one of `DECISION_FAULTS`, completed with the attempt it ended. A consumer keys on the `fault` literal, which survives a second copy of the package, an object spread and a JSON round trip.

| Error | `fault` | Raised when | Breaker |
| --- | --- | --- | --- |
| `DecisionRouteUnavailableError` | `unavailable` | The route is not admitted (`route_not_admitted`), is served by the consumer (`engine_served`), or its breaker is open (`breaker_open`). | untouched |
| `DecisionRequestInvalidError` | `schema` | The request or an option breaks the contract or the route's caps, before any call; or the vendor answers 422. | none, or reachable for a 422 |
| `DecisionAdmissionError` | `admission` | The call ended before dispatch: the guard refused it (`provider_guard`), the budget ran out in the queue (`route_budget`), or the caller left (`caller_signal`). The vendor was never contacted. | none |
| `DecisionCredentialError` | `credential` | The key variable is unset or holds a value that cannot be sent (no request made), or the vendor answers 401 or 403. | none, or reachable for a 401 or 403 |
| `DecisionTransportError` | `transport` | 408, 429, 503, 529 (capacity), any other 5xx, any other non-2xx, or a network failure. Carries `retryable` and `retryAfterMs`. | failure: capacity or hard |
| `DecisionTimeoutError` | `timeout` | The call ended after dispatch: the budget ran out (`route_budget`) or the caller aborted (`caller_signal`). | capacity failure for the budget, none for the caller |
| `DecisionResponseFormatError` | `schema` | A 2xx whose body fails validation. Carries `fieldPath` and the billed usage. | reachable |
| `DecisionRouteMismatchError` | `route_mismatch` | A model other than the route's pin answered. Carries both ids and the billed usage. | reachable |

The breaker measures whether the vendor can be reached in time. A rejected key, a rejected request, a malformed answer and a substituted model each arrived in time from a reachable vendor and each has its own fault, so none is charged to the route. A fault raised before a request existed gives no verdict. A guard refusal on a half-open route returns its probe slot.

The decision registry is not the generative client's. Its keys are `decision:<route>`, the generative registry never holds one, and opening either leaves the other untouched.

### The key

The key is read from the environment by name when the request is built. It appears in no error: the transport removes it from a vendor's error body and request id, and the client removes it from the answering model of a mismatch, from the request id of an answered attempt and from the field path of a rejected answer, in each case before the text is excerpted, so a key lying across the excerpt's bound is removed whole. A successful result is the vendor's answer as sent.

## Evidence classes

No authenticated call has been made from this codebase. Every vendor behaviour is exercised against the fixtures in `src/__tests__/llm/decision/fixtures/`, and each fixture's manifest entry states what it rests on. A test names the classes it relies on when it loads a fixture.

| Class | Meaning |
| --- | --- |
| `documented-verbatim` | Quoted from the vendor's published reference. |
| `observed-unauthenticated` | Recorded from a real response to a request that carried no credential. |
| `observed-authenticated` | Recorded from a real response to an authenticated call. Nothing is in this class yet. |
| `constructed-from-documented-fields` | Assembled from documented field tables where the reference quotes no example. |
| `synthetic-unobserved` | A body for a response nobody has seen. Only its status is documented. |

## Not verified

Each row is unknown until an authenticated call is made, and the code carries it as unknown.

| Unverified | How the code represents it |
| --- | --- |
| Bodies of 401, 422, 429 and 529 | Classification is by status alone. The error carries a bounded `bodyExcerpt`; `vendorErrorType` is read only from the one observed shape and is `null` otherwise. |
| Whether an invalid key returns 401 or 403 | Both are the `credential` fault. |
| Whether 429 and 529 carry a retry hint | `retryAfterMs` is `number` or `null`; absent is `null`, never zero. Nothing sleeps on it. |
| The status for a zero credit balance, more than 255 options, or more than 64k tokens | Any status outside the table is a `transport` fault, never an answer. |
| Whether a success always carries `usage` and a request id | Token counts, cost and `vendorRequestId` are nullable. |
| How tightly `probabilities` sum to one | The raw sum is returned. The codec holds no tolerance; a caller may pass one. |
| The `confidence` formula | Returned as the vendor's field and never interpreted. |
| Whether the response `model` equals a pinned id exactly | Strict equality against `expected_served_model`; any difference is `route_mismatch`. |
| The tokenizer and the fixed per-request overhead | This package does not estimate hosted tokens. The route declares a ceiling with its basis. |
| Whether identical requests return identical distributions | Nothing here caches or compares answers. |

Several numbers are free parameters of routes nothing can reach yet. They are recorded as such in the notes beside them and are to be re-derived from the first authenticated measurements: both `budget_ms` values, the breaker defaults, the hosted `max_state_tokens` ceiling and the `typesafe` limits entry.

Two limits of the provider guard bind before the hosted route is admitted. A cold guard admits the whole per-minute allowance in one burst, fifteen times the vendor's published per-second ceiling; the limits entry says what the guard needs to hold it. And the rate queue does not hear a caller's cancellation, so a call that ends while queued there is never dispatched but can still spend the token it was waiting for.

## Onboarding order

1. **Key.** The operator opens the account and provisions the key under the variable the provider declares (`api_key_env`), at the secret path it declares.
2. **Probe.** The operator runs the contract probe, which calls the hosted transport directly with that key and records the authenticated request and response shapes as fixtures.
3. **Table edit.** `account_status` becomes `live`, and `contract_evidence` becomes `authenticated-call` with the date in `contract_verified`. The test "the canonical routes fail closed" goes red by design: changing it is part of this step.
4. **Publish.** A push to `main` publishes the package.
5. **Consumer bump.** The consumer pins the new version. Its own contract test that the hosted route refuses goes red, which makes the flip a deliberate change there too.
6. **Consumer fleet rows.** Only now do the consumer's governed per-site mode and route rows mean anything for the hosted route.

## For a consumer that restricts imports

A consumer that confines the decision model to one module (design D12: a backtest cannot reach a live decision model) must restrict `configureDecisionClient` together with `callDecisionModel`. The first decides which table and which transport the second uses, so a module allowed to call it can open a route the published table leaves closed.

## Gates

| Gate | What it holds |
| --- | --- |
| `src/__tests__/llm/decision/decision-client.test.ts` | Admission before anything else, one attempt, the mismatch before the decode, the breaker's namespace and verdicts, the budget over the queue and the vendor, what is sent, the key, and that no failure resolves. |
| `src/__tests__/llm/decision/public-surface.test.ts` | The exported names, that the transport's factory is not one of them, that no decision source holds a vendor host or model id as a literal or imports a package, and that the generative client's aliases, tables and exports are unchanged. |
| `node scripts/verify-llm-client-build.mjs` | Run after the build, in CI. The barrel reaches every decision module, what it reaches imports no package and typechecks, the decision barrel is in the published types, and no declaration of a test-only source is. `reachability` as an argument runs the source checks alone. |
| `node scripts/verify-provider-limits.mjs` | Run in CI. Every provider of a route this package serves has a limits entry whose queue timeout does not exceed the route's budget. |
