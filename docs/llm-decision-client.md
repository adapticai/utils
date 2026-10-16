# The typed decision client

`src/llm/decision/` asks a typed decision model a bounded question about a piece of state and returns a probability distribution over the question's own options. It is exported from the package root beside the generative client and shares nothing with it except the provider rate guard and the breaker class.

Design of record: `docs/superpowers/specs/2026-10-01-typed-decision-models-design.md` in the meta repo (D1, D2, D6, D7, D12, section 3.2).

## What the published package does today

It serves the two hosted routes and refuses `dm.local`. `dm.hosted` and `dm.hosted.preview` name a provider whose account is declared `live` with `authenticated-call` contract evidence, so `callDecisionModel` on either resolves, passes the breaker and the provider guard, and dispatches one attempt inside the route's budget to the model that route pins. `dm.local` is answered by the consumer's own process and rejects with fault `unavailable` and code `engine_served`, which is a statement about the design and never becomes true here.

A hosted route is opened or closed by two fields of `decision-routes.json` — the provider's `account_status` and the route's `contract_evidence` — read at admission before the request is looked at, a guard is charged or a socket is opened. Both are data rather than code, because code that assumed an account existed or a contract had been confirmed would be asserting something nobody measured. Changing either is an edit to that file and a release of this package; no running process can do it, and a key present in the environment is inert while the table says the account is shut.

The vendor's image surface and its question that locates something in an image are implemented against the contract its images page publishes, and that page's figures have been exercised with a real chart: a rendered 1024x768 PNG passes every limit declared here and encodes as the asset the vendor receives. The vendor calls both surfaces not ready for production in its own words, so the headers that reach them are per-call opt-ins a caller names and nothing the table turns on. Every limit is enforced here before dispatch, so a request this package knows the vendor will refuse never leaves. What the vendor's accuracy on that surface is remains the vendor's own caveat and is not a quantity this package measures. The long-context ceiling is implemented the same way and works on both releases.

## The two hosted routes

A route IS its pinned model together with the caps, budget and price that model is served under, so the vendor's two releases are two routes rather than one route with a choice of model. A caller able to name the model could move the answering model without a reviewed change to the table.

| Route | Pin | Locates something in an image |
| --- | --- | --- |
| `dm.hosted` | `jev-1.13.0` | No. The vendor serves it on the newer model alone. |
| `dm.hosted.preview` | `jev-1.14.0` | Yes. |

The vendor also publishes two moving names, `jev-latest` and `jev-preview`. They are recorded in the provider's `model_aliases` with the versioned id each resolves to, measured from an authenticated call — a request naming `jev-latest` is answered by `jev-1.13.0` and one naming `jev-preview` by `jev-1.14.0`, each reported back in the response's `model` field — and neither is ever sent: the vendor states that an alias moves when a new release ships, so sending one would change the answering model with no change on this side. The loader refuses a pin that ends in either name, and re-pointing an entry in `model_aliases` is a reviewed edit of one file that changes no request.

`GET /v1/models` lists only those two aliases. A versioned id is accepted by the `model` field whether or not it appears in that list, which the vendor states and an authenticated call confirms, so that list is the set of names an account may send and never the set of ids a route may pin. An id the vendor does not serve comes back `400` with `Unknown model`, so a pin is validated by the vendor rather than passed through.

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
| `DECISION_IMAGE_LIMITS`, `DECISION_IMAGE_FORMATS` | The vendor's image limits and accepted formats, as published. |
| `measureDecisionImage`, `formatsAgree` | What a file's own bytes say it is: its format, its pixel dimensions and its size, or the defect that stopped them being read. |
| `encodeDecisionBase64`, `normaliseDecisionBase64`, `isStrictDecisionBase64`, `utf8ByteLength` | The base64 encoding the contract fixes, and the byte count its size limits are written in. |
| `decisionUsageOf` | Usage and cost at a route's declared price. |
| `DECISION_ROUTES`, `DECISION_FAULTS`, `DECISION_UNAVAILABLE_CODES`, `DECISION_CLIENT_FAULT_STAGES`, `DECISION_REQUEST_VIOLATIONS` | The closed vocabularies. |
| `DecisionCallError` and its ten subclasses | The typed rejections. |

The function that builds the hosted transport is deliberately not exported. It checks no admission and holds no breaker, guard or budget, so the client is the only exported way to reach the vendor. Its types are exported, because typing a transport for `configureDecisionClient` needs them.

### Options

| Option | Meaning |
| --- | --- |
| `timeoutMs` | The caller's deadline for the whole call. It narrows the route's `budget_ms` and never widens it. Zero or negative means the deadline has passed, and the call is refused as `admission` before anything is charged. A value that is not a number is refused as `schema`. |
| `signal` | The caller's cancellation. |
| `correlationId` | Recorded on the attempt. Never sent to the vendor. |
| `probabilitySumTolerance` | How far a distribution's sum may differ from one before the answer is rejected. Absent: the sum is reported in `probabilitySums` and not enforced. |
| `dangerZone` | The vendor surfaces this one call opts in to: `{ images: true }` and `{ longContext: true }`. Absent means neither, which is what every call that does not name them gets. Only `true` turns one on; `false` is refused, because it reads as a choice no header carries. |

### Images

An image is listed once in the request's `assets` map under a reference string, and that reference is written wherever the image belongs: in the `state`, in a question's `instructions`, or in its `criteria`. Each entry carries either `bytes` (a `Uint8Array`, which this package encodes) or `data_base64` (text, normalised before it is checked — a `data:` header and the line breaks a wrapping encoder adds are stripped, because both describe the same bytes).

```ts
const chart = await renderChartPng();           // 1024 x 768, inside every bound
const reference = crypto.randomUUID();          // a value that cannot occur in the text by accident

await callDecisionModel(
  "dm.hosted.preview",
  {
    state: { chart: reference },
    assets: { [reference]: { bytes: chart } },
    questions: {
      broke_out: { type: "noul", instructions: "Did price break the marked level in `chart`?" },
      where: { type: "box", instructions: "where price broke the marked level in `chart`" },
    },
  },
  { dangerZone: { images: true } },
);
```

What is checked before anything is sent, each refusal carrying the rule's own code in `DecisionRequestInvalidError.violation`:

| Rule | Code |
| --- | --- |
| 280 to 1568 pixels per side | `asset_side_too_small`, `asset_side_too_large` |
| 78,400 to 2,458,624 pixels in total | `asset_pixels_too_few`, `asset_pixels_too_many` |
| 16 MiB per image file, measured after base64 is decoded | `asset_file_too_large` |
| 32 MiB for every distinct image together | `assets_combined_too_large` |
| 32 MiB once every reference is replaced by its image — each use counts again | `expanded_request_too_large` |
| 32 MiB for the request body, counted as the UTF-8 that is sent | `request_body_too_large` |
| 1,024 bytes per reference, 65,536 bytes for all of them | `reference_too_long`, `references_too_long` |
| Every asset is referenced somewhere | `asset_unreferenced` |
| PNG or JPEG, still, readable, and the format the file's own signature says | `asset_format_unknown`, `asset_animated`, `asset_header_unreadable`, `asset_format_mismatch` |
| An image given once, as bytes or as base64 | `asset_source_missing`, `asset_source_ambiguous`, `asset_base64_malformed` |
| A box question on a route whose model serves one, with an image to look in | `box_unsupported_by_route`, `box_needs_image` |

The format and the pixel dimensions are read from the file's own bytes and never from what the caller said about them: a PNG labelled `jpg` is refused here rather than refused by the vendor as a damaged file. Nothing is resized, re-encoded or repaired — the contract rejects a file outside its limits rather than fitting it, and a library that quietly fitted one would change the picture the model was asked about.

Base64 makes each image about a third larger and that growth counts against the 32 MiB body limit, so the body limit binds well before the images' own combined limit does. This package sends a JSON body only; the contract's multipart form, which the vendor recommends for exactly this reason, is not built here.

A request that carries an image, or a box question, without `dangerZone.images` is refused with `DecisionImagesNotEnabledError` before the image is even read. The header is never derived from the body: deriving it would enable a surface the vendor itself calls unready on behalf of a caller who never asked.

### What the model is poor at, and what that means for a chart question

The vendor publishes a list of its own model's failure modes. The ones that decide how a question about a chart should be written, and which belong in the question rather than in this package:

- **It is not a calculator, and it does not count.** Reading a number off a picture — a price, a level, how many times something happened — is squarely inside the documented weak zone, and so is comparing two numbers or two dates. Ask what a number *means* (did price close above the marked level?) and keep the arithmetic in code. Ask where something is with a box, and convert the edges to pixels in code.
- **A numeric representation underperforms a semantic one.** A question framed in named terms beats the same question framed in raw values.
- **Context rot.** Accuracy falls as the state grows with material the question does not need. An image in a question's `instructions` is sent once per question that holds it, so an image several questions ask about belongs in the `state` once and is referred to by path — that is fewer tokens and less of every size limit as well as a better answer.
- **A choice leans toward its first option.** Reorder the options and check the answer is the same before relying on one.
- **It reads the question literally, and generates nothing.** Where interpretation is unavoidable, split it into two literal questions and combine them in code.
- **A box is always four edges.** There is no answer meaning "not found", so a box says where the target would be and nothing about whether it is there. Ask a yes/no question beside it and read the box only when that answer says yes.

That list is published for the older of the two pinned models and was last reviewed by the vendor on 2026-10-02. **No equivalent list is published for the newer model**, which is the one that serves a box question, so its known limitations are unstated rather than absent.

### Result

`answers` are the validated wire answers, with distribution keys in the request's option order. `probabilitySums` holds each distribution's raw sum and `null` for a yes/no. `servedModel` is the model the vendor reports answered, which is always the route's pin on a result. `usage` carries the reported token counts and the cost at the route's price; a count the vendor did not report is `null`, and so is a cost that depends on it. `attempt` is the record of the one attempt.

A yes/no answer has no `confidence`, because the contract defines none. A choice's or a score's `confidence` and a score's `score` are the vendor's own statistics, carried as stated and never recomputed.

## The order of a call

1. **Resolve the route.** An unadmitted route rejects `unavailable` here. Nothing else has been touched.
2. **Check the options, then copy, encode and write the request**, in one synchronous step before the call returns its promise. The request is copied with each member read once, the copy is validated against the route's caps, and it is written as JSON once to prove it can be. What is later sent is that copy, so a caller that changes its request while the call waits changes nothing that reaches the vendor, and the answer is decoded against the questions that were sent.
3. **Fix the budget**: the smaller of the route's `budget_ms` and the caller's `timeoutMs`. One timer covers the queue and the vendor together.
4. **Consult the breaker.** An open breaker rejects `unavailable` (`breaker_open`).
5. **Enter the provider guards and dispatch once.** The guards are handed the call's own signal, and the client asks for that signal to end the wait for a rate token as well as the wait for a concurrency permit (`signalEndsRateWait`, which the guard leaves off unless a caller sets it). So a call that ends while it is queued leaves that queue at once and takes neither a token nor a permit. The guarded dispatch is also raced against the budget, so the end of the call decides its outcome and the guard's refusal does not.
6. **Compare the answering model with the pin**, on the whole id as reported, before the body is decoded.
7. **Decode** against the request as sent.

There is one attempt. Nothing retries, hedges or falls back: a retry hint is returned on the error and never slept on. Walking routes is the caller's job.

## Faults

Every rejection is a `DecisionCallError` whose own enumerable `fault` is one of `DECISION_FAULTS`, completed with the attempt it ended. A consumer keys on the `fault` literal, which survives a second copy of the package, an object spread and a JSON round trip.

| Error | `fault` | Raised when | Breaker |
| --- | --- | --- | --- |
| `DecisionRouteUnavailableError` | `unavailable` | The route is not admitted (`route_not_admitted`), is served by the consumer (`engine_served`), or its breaker is open (`breaker_open`). | untouched |
| `DecisionRequestInvalidError` | `schema` | The request or an option breaks the contract or the route's caps, before any call; or the vendor answers 400, 413, 415 or 422. Carries `violation`, the broken rule's own code, for a refusal made here. | none |
| `DecisionImagesNotEnabledError` | `schema` | The request carries an image or a box question and the call did not name `dangerZone.images` (`request_validation`); or the vendor names its images header in a 400 (`vendor_rejected`). | none |
| `DecisionAdmissionError` | `admission` | The call ended before dispatch: the guard refused it (`provider_guard`), the budget ran out in the queue (`route_budget`), or the caller left (`caller_signal`). The vendor was never contacted. | none |
| `DecisionCredentialError` | `credential` | The key variable is unset or holds a value that cannot be sent (no request made), or the vendor answers 401 or 403. | none, or reachable for a 401 or 403 |
| `DecisionTransportError` | `transport` | 408, 429, 503, 529 (capacity), any other 5xx, any other non-2xx, or a network failure. Carries `retryable` and `retryAfterMs`. | failure: capacity or hard |
| `DecisionTimeoutError` | `timeout` | The call ended after dispatch: the budget ran out (`route_budget`) or the caller aborted (`caller_signal`). | capacity failure for the budget, none for the caller |
| `DecisionResponseFormatError` | `schema` | A 2xx whose body fails validation. Carries `fieldPath` and the billed usage. | reachable |
| `DecisionRouteMismatchError` | `route_mismatch` | A model other than the route's pin answered. Carries both ids and the billed usage. | reachable |
| `DecisionClientFaultError` | `internal` | The client's own machinery failed, or something it was wired with did: the route table, the breaker, the guards, the clock. Carries the `stage` (`resolving`, `admitting`, `recording`) and a `description` by class and code. Never retryable. | none |

The breaker measures whether the vendor can be reached in time. A rejected key, a rejected request, a malformed answer and a substituted model each arrived in time from a reachable vendor and each has its own fault, so none is charged to the route. That is why the four statuses with which the vendor rejects a request — 400, 413, 415 and 422 — are request faults and not transport faults: counted as the vendor failing, one caller repeating a malformed request would open the breaker and shut the route for every other caller. A fault raised before a request existed gives no verdict. A guard refusal on a half-open route returns its probe slot.

### A failure nobody classified

A failure that reaches the client as anything other than a decision error (a throw from a getter on the caller's request, from an injected clock or transport, from this package's own code, a thrown value that is not an error at all) still leaves it as one, with the attempt attached. It is given the fault of the stage the call had reached, and it is described by its class name and system code and those of its causes, never by its message, which can quote the request it failed on.

| Stage the call had reached | Raised as | `fault` | Breaker |
| --- | --- | --- | --- |
| Resolving the route | `DecisionClientFaultError`, stage `resolving` | `internal` | untouched |
| Reading the options | `DecisionRequestInvalidError` at `options` | `schema` | untouched |
| Copying, checking and writing the request | `DecisionRequestInvalidError` at `$` | `schema` | untouched |
| Passing the breaker and the guards (no request exists) | `DecisionClientFaultError`, stage `admitting` | `internal` | none |
| Dispatched, no answer yet | `DecisionTransportError`, not retryable: "the transport raised a failure that is not a decision fault" | `transport` | hard failure |
| An answer arrived and is being read | `DecisionResponseFormatError` at `$`, with the status and the billed usage | `schema` | reachable |
| Telling the breaker how the call ended | `DecisionClientFaultError`, stage `recording`; the attempt keeps the status and the billed usage | `internal` | as far as it got |

`internal` is a defect on this side. It is kept apart from `transport` for the reason `credential` is: counted with the vendor's failures it would read as a vendor that is slow or cannot be reached, and be answered by falling back and not by fixing the defect. A consumer that mirrors the faults must not count it against a vendor's health, and should alert on it by itself.

A value given as the route that is not text is recorded as `(not a route name)` and refused as an unknown route. A closed route is refused as closed whatever was passed with it, unreadable options included.

### The caller's own cancellation

A caller that aborts its signal receives `DecisionAdmissionError` while the call is queued and `DecisionTimeoutError` once it is dispatched, each with source `caller_signal`. It never receives the reason it aborted with, and that reason is not attached as a cause or quoted: it is the caller's value, of any type and with any content, and the caller already holds it on its own signal. The transport's signal is the client's own, and the reason it is aborted with is the error the caller receives, so the hosted transport, which rejects with its signal's reason, hands back that very error.

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

Each row is a shape the vendor's reference does not pin, and one authenticated call does not settle one: observing a field present once is not a guarantee that it is always present, and a status nobody has provoked is a status nobody has seen. So the code carries every row below as unknown whatever a single response happened to contain, and the fixture corpus claims no authenticated evidence until a probe run records it.

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

Several numbers are free parameters, recorded as such in the notes beside them and to be narrowed by measurement rather than guessed: both `budget_ms` values, the breaker defaults, the hosted `max_state_tokens` ceiling and the `typesafe` limits entry. The latencies measured on the hosted routes so far are a band and not a point: 281 to 313 ms for a one-question text call and 468 to 515 ms for a read over one 1024x768 PNG, against a declared `budget_ms` of 1500, which is a ceiling and not an operating point.

The provider guard holds the hosted routes to a per-second pace the vendor does not publish a figure for. The vendor enforces per second, on tokens and on requests, and answers `429` over either; its own ceiling for an organisation is visible only in its console, so the limits entry declares a `max_burst` separate from its refill rate and sets it to one second of that refill. A cold process therefore offers no more in one instant than the sustained pace already chosen, and the eleventh call in an instant is paced rather than refused. No token-per-second bound is enforced at all: this package does not count hosted tokens, so a single large request can cross the vendor's token bound while every request bound holds.

## Onboarding order

1. **Key.** The operator opens the account and provisions the key under the variable the provider declares (`api_key_env`), at the secret path it declares.
2. **Probe.** The operator runs the contract probe, which calls the hosted transport directly with that key and records the authenticated request and response shapes as fixtures.
3. **Table edit.** `account_status` becomes `live`, and `contract_evidence` becomes `authenticated-call` with the date in `contract_verified`. The test "the account-status gate decides a hosted route" exercises that field in both directions on the shipped table, so either move goes red there by design and changing it is part of this step.
4. **Publish.** A push to `main` publishes the package.
5. **Consumer bump.** The consumer pins the new version. Its own contract test that the hosted route refuses goes red, which makes the flip a deliberate change there too.
6. **Consumer fleet rows.** Only now do the consumer's governed per-site mode and route rows mean anything for the hosted route.

## For a consumer that restricts imports

A consumer that confines the decision model to one module (design D12: a backtest cannot reach a live decision model) must restrict `configureDecisionClient` together with `callDecisionModel`. The first decides which table and which transport the second uses, so a module allowed to call it can open a route the published table leaves closed.

## Gates

| Gate | What it holds |
| --- | --- |
| `src/__tests__/llm/decision/decision-client.test.ts` | Admission before anything else, one attempt, the mismatch before the decode, the breaker's namespace and verdicts, the budget over the queue and the vendor, what is sent, the key, that no failure resolves, and that every rejection, from every source in its table, is a decision error with its attempt. |
| `src/__tests__/rate-limiter-signal.test.ts`, `src/__tests__/llm/rate-guard-signal.test.ts` | The rate queue shared with the generative client. A recorded sequence of arrivals is admitted in the same order at the same instants with no signal, with a signal that never fires, and with a caller that asks for its signal to end the rate wait. A caller that leaves without having asked stays queued and is granted its token, at the recorded instants. One that asked takes no token and leaves no timer or listener, and the callers behind it are admitted as if it had never queued. |
| `src/__tests__/llm/client/rate-queue-budget.test.ts` | A characterisation of the generative chain, which does not ask: an attempt whose budget ends, whose caller cancels or which loses to a same-model attempt while queued for a rate token settles when the token arrives, is refused at the concurrency gate and spends the token. |
| `src/__tests__/llm/decision/public-surface.test.ts` | The exported names, that the transport's factory is not one of them, that no decision source holds a vendor host or model id as a literal or imports a package, and that the generative client's aliases, tables and exports are unchanged. |
| `node scripts/verify-llm-client-build.mjs` | Run after the build, in CI. The barrel reaches every decision module, what it reaches imports no package and typechecks, the decision barrel is in the published types, and no declaration of a test-only source is. `reachability` as an argument runs the source checks alone. |
| `node scripts/verify-provider-limits.mjs` | Run in CI. Every provider of a route this package serves has a limits entry whose queue timeout does not exceed the route's budget. |
