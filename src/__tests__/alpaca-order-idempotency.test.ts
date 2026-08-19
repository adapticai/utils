/**
 * B-0010 / F-0035 — the SDK order path must be idempotent.
 *
 * `createOrder` runs inside `AlpacaClient.executeWithRateLimit`, which retries
 * on network failure. Without a `client_order_id` an ECONNRESET raised *after*
 * the POST landed re-submitted the order and doubled a live position. These
 * tests pin the contract: a required idempotency key, a deterministic
 * broker-safe `client_order_id` derived from it, and duplicate-rejection
 * recovery that never issues a second order.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  expectTypeOf,
} from "vitest";
import fc from "fast-check";

vi.mock("../logging", () => ({
  log: vi.fn(),
}));

import {
  createOrder,
  deriveClientOrderId,
  getOrderByClientOrderId,
  MAX_CLIENT_ORDER_ID_LENGTH,
  type IdempotentCreateOrderParams,
} from "../alpaca/trading/orders";
import { withRetry } from "../utils/retry";
import { DuplicateClientOrderIdError } from "../errors";
import { AlpacaClient } from "../alpaca/client";
import { AlpacaOrder, CreateOrderParams } from "../types/alpaca-types";

/** Retry budget `AlpacaClient.executeWithRateLimit` applies to every SDK call. */
const CLIENT_MAX_RETRIES = 2;

/** Order params the tests submit, minus the idempotency key. */
const BASE_PARAMS: CreateOrderParams = {
  symbol: "AAPL",
  qty: "10",
  side: "buy",
  type: "market",
  time_in_force: "day",
};

/** Alpaca's 422 duplicate-idempotency-key rejection, in axios's error shape. */
function duplicateRejection(): Error {
  return Object.assign(new Error("Request failed with status code 422"), {
    response: {
      status: 422,
      data: { code: 42210000, message: "client_order_id must be unique" },
    },
  });
}

/** A connection reset raised after the POST has already landed broker-side. */
function connectionReset(): Error {
  return Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
}

/** Alpaca's 404 for an unknown `client_order_id`. */
function notFoundRejection(): Error {
  return Object.assign(new Error("Request failed with status code 404"), {
    response: { status: 404, data: { message: "order not found" } },
  });
}

interface FakeBroker {
  /** Orders the broker actually accepted, keyed by `client_order_id`. */
  readonly accepted: Map<string, AlpacaOrder>;
  /** Every POST body the SDK saw, including re-sent attempts. */
  readonly submissions: CreateOrderParams[];
  /** Failure injected after the POST lands, consumed once. */
  postLandingFailure: Error | null;
  /** Overrides the status stamped on accepted orders. */
  acceptedStatus: string;
  /** Forces the by-client-id lookup to fail with this error. */
  lookupFailure: Error | null;
}

/**
 * Builds a client whose `executeWithRateLimit` runs the real retry wrapper, so
 * the retry-after-network-failure behaviour under test is the production one.
 */
function makeClient(broker: FakeBroker): AlpacaClient {
  const sdk = {
    createOrder: (params: CreateOrderParams): Promise<AlpacaOrder> => {
      broker.submissions.push(params);
      const clientOrderId = params.client_order_id ?? "";
      if (broker.accepted.has(clientOrderId)) {
        return Promise.reject(duplicateRejection());
      }
      broker.accepted.set(clientOrderId, {
        id: `broker-${broker.accepted.size + 1}`,
        client_order_id: clientOrderId,
        status: broker.acceptedStatus,
        symbol: params.symbol,
        side: params.side,
        type: params.type,
      } as unknown as AlpacaOrder);
      if (broker.postLandingFailure) {
        const failure = broker.postLandingFailure;
        broker.postLandingFailure = null;
        return Promise.reject(failure);
      }
      return Promise.resolve(broker.accepted.get(clientOrderId) as AlpacaOrder);
    },
    getOrderByClientId: (clientOrderId: string): Promise<AlpacaOrder> => {
      if (broker.lookupFailure) {
        return Promise.reject(broker.lookupFailure);
      }
      const found = broker.accepted.get(clientOrderId);
      return found ? Promise.resolve(found) : Promise.reject(notFoundRejection());
    },
  };

  return {
    getSDK: () => sdk,
    executeWithRateLimit: <T>(
      operation: () => Promise<T>,
      label: string,
    ): Promise<T> =>
      withRetry(
        operation,
        { maxRetries: CLIENT_MAX_RETRIES, baseDelayMs: 1, maxDelayMs: 2 },
        label,
      ),
  } as unknown as AlpacaClient;
}

function newBroker(): FakeBroker {
  return {
    accepted: new Map<string, AlpacaOrder>(),
    submissions: [],
    postLandingFailure: null,
    acceptedStatus: "new",
    lookupFailure: null,
  };
}

describe("deriveClientOrderId", () => {
  it("is a pure function of the key (same key ⇒ same id)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 400 }), (key) => {
        fc.pre(key.trim().length > 0);
        expect(deriveClientOrderId(key)).toBe(deriveClientOrderId(key));
      }),
    );
  });

  it("always yields a broker-safe, length-bounded id", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 400 }), (key) => {
        fc.pre(key.trim().length > 0);
        const id = deriveClientOrderId(key);
        expect(id).toMatch(/^[A-Za-z0-9._:-]+$/);
        expect(id.length).toBeGreaterThan(0);
        expect(id.length).toBeLessThanOrEqual(MAX_CLIENT_ORDER_ID_LENGTH);
      }),
    );
  });

  it("honours the engine's `client_order_id = trade.id` convention verbatim", () => {
    expect(deriveClientOrderId("clx8h2k9p0001trade")).toBe("clx8h2k9p0001trade");
  });

  it("distinguishes keys that only differ in unsafe characters", () => {
    expect(deriveClientOrderId("trade/1")).not.toBe(deriveClientOrderId("trade 1"));
  });

  it("rejects a blank key at runtime", () => {
    expect(() => deriveClientOrderId("   ")).toThrow(/idempotency key/i);
  });
});

describe("IdempotentCreateOrderParams", () => {
  it("still requires the key on the keyed contract type", () => {
    expectTypeOf<IdempotentCreateOrderParams>().toMatchTypeOf<{
      idempotencyKey: string;
    }>();
  });
});

/**
 * Transitional surface. `createOrder` is exported public API with in-repo and
 * cross-repo callers that supply no order identity — `options/strategies.ts`
 * (owned by B-0061) and the engine's `tool-execution-engine.ts`. Making the key
 * a hard compile-time requirement broke both. The key is therefore accepted as
 * optional at the boundary, and an omitted key is replaced by a per-submission
 * generated identity.
 *
 * What that buys is precise and limited, and these tests pin exactly it: an
 * un-keyed submission still carries ONE broker-side `client_order_id` that is
 * held constant across the transport retry, so the F-0035 double-fill (an
 * ECONNRESET after the POST landed) is closed for un-keyed callers too. What it
 * does NOT buy is de-duplication of a *caller-level* resubmission — two calls
 * are two logical orders. Only a caller-supplied key gives that, which is why
 * the un-keyed overload is deprecated rather than blessed.
 */
describe("createOrder — un-keyed callers (transitional, B-0061 / engine handoff)", () => {
  let broker: FakeBroker;

  beforeEach(() => {
    broker = newBroker();
  });

  it("submits the un-keyed caller shape with a generated client_order_id", async () => {
    const client = makeClient(broker);

    // Byte-for-byte the shape `options/strategies.ts` passes for the covered
    // call's stock leg: no idempotencyKey, no client_order_id.
    const order = await createOrder(client, {
      symbol: "AAPL",
      qty: "10",
      side: "buy",
      type: "market",
      time_in_force: "day",
    });

    expect(broker.submissions).toHaveLength(1);
    const submittedId = broker.submissions[0].client_order_id;
    expect(typeof submittedId).toBe("string");
    expect((submittedId ?? "").length).toBeGreaterThan(0);
    expect(order.client_order_id).toBe(submittedId);
  });

  it("holds the generated id constant across the transport retry, leaving one broker order", async () => {
    broker.postLandingFailure = connectionReset();
    const client = makeClient(broker);

    const order = await createOrder(client, { ...BASE_PARAMS });

    expect(broker.submissions.length).toBeGreaterThan(1);
    const ids = new Set(broker.submissions.map((s) => s.client_order_id));
    expect(ids.size).toBe(1);
    expect(broker.accepted.size).toBe(1);
    expect(order.id).toBe("broker-1");
  });

  it("gives two un-keyed calls two distinct ids — it never pretends to de-duplicate across calls", async () => {
    const client = makeClient(broker);
    await createOrder(client, { ...BASE_PARAMS });
    await createOrder(client, { ...BASE_PARAMS });

    expect(broker.accepted.size).toBe(2);
    expect(broker.submissions[0].client_order_id).not.toBe(
      broker.submissions[1].client_order_id,
    );
  });

  it("still honours an explicit client_order_id when no key is supplied", async () => {
    const client = makeClient(broker);
    await createOrder(client, {
      ...BASE_PARAMS,
      client_order_id: "explicit-unkeyed",
    });
    expect(broker.submissions[0].client_order_id).toBe("explicit-unkeyed");
  });

  it("still refuses a blank explicit client_order_id when no key is supplied", async () => {
    const client = makeClient(broker);
    await expect(
      createOrder(client, { ...BASE_PARAMS, client_order_id: "   " }),
    ).rejects.toThrow(/blank client_order_id/i);
    expect(broker.submissions).toHaveLength(0);
  });
});

describe("createOrder — keyed submissions", () => {
  let broker: FakeBroker;

  beforeEach(() => {
    broker = newBroker();
  });

  it("submits the derived client_order_id", async () => {
    const client = makeClient(broker);
    const order = await createOrder(client, {
      ...BASE_PARAMS,
      idempotencyKey: "trade-abc-1",
    });
    expect(broker.submissions).toHaveLength(1);
    expect(broker.submissions[0].client_order_id).toBe("trade-abc-1");
    expect(order.client_order_id).toBe("trade-abc-1");
  });

  it("uses an explicitly supplied client_order_id verbatim", async () => {
    const client = makeClient(broker);
    await createOrder(client, {
      ...BASE_PARAMS,
      client_order_id: "explicit-id",
      idempotencyKey: "trade-abc-1",
    });
    expect(broker.submissions[0].client_order_id).toBe("explicit-id");
  });

  // A blank explicit id used to slip past `?? deriveClientOrderId(key)` — the
  // broker then minted its own id and the POST was non-idempotent again, which
  // is exactly the F-0035 double-fill this contract exists to close.
  it.each(["", "   "])(
    "refuses to submit when client_order_id is blank (%j)",
    async (blankId) => {
      const client = makeClient(broker);
      await expect(
        createOrder(client, {
          ...BASE_PARAMS,
          client_order_id: blankId,
          idempotencyKey: "trade-abc-1",
        }),
      ).rejects.toThrow(/blank client_order_id/i);
      expect(broker.submissions).toHaveLength(0);
    },
  );

  it("refuses to submit an explicit client_order_id the broker cannot accept", async () => {
    const client = makeClient(broker);
    await expect(
      createOrder(client, {
        ...BASE_PARAMS,
        client_order_id: "trade 1/2",
        idempotencyKey: "trade-abc-1",
      }),
    ).rejects.toThrow(/does not accept/i);
    await expect(
      createOrder(client, {
        ...BASE_PARAMS,
        client_order_id: "x".repeat(MAX_CLIENT_ORDER_ID_LENGTH + 1),
        idempotencyKey: "trade-abc-1",
      }),
    ).rejects.toThrow(/character limit/i);
    expect(broker.submissions).toHaveLength(0);
  });

  it("refuses to submit when the idempotency key is blank", async () => {
    const client = makeClient(broker);
    await expect(
      createOrder(client, { ...BASE_PARAMS, idempotencyKey: "  " }),
    ).rejects.toThrow(/idempotency key/i);
    expect(broker.submissions).toHaveLength(0);
  });

  it("leaves exactly one broker order when an ECONNRESET follows a landed POST", async () => {
    broker.postLandingFailure = connectionReset();
    const client = makeClient(broker);

    const order = await createOrder(client, {
      ...BASE_PARAMS,
      idempotencyKey: "trade-reset-1",
    });

    // The retry layer re-sent the POST, the broker rejected the duplicate id,
    // and the already-landed order was returned instead of a second position.
    expect(broker.submissions.length).toBeGreaterThan(1);
    expect(broker.accepted.size).toBe(1);
    expect(order.client_order_id).toBe("trade-reset-1");
    expect(order.id).toBe("broker-1");
  });

  it("returns the existing order when the same logical order is submitted twice", async () => {
    const client = makeClient(broker);
    const first = await createOrder(client, {
      ...BASE_PARAMS,
      idempotencyKey: "trade-dup-1",
    });
    const second = await createOrder(client, {
      ...BASE_PARAMS,
      idempotencyKey: "trade-dup-1",
    });

    expect(second.id).toBe(first.id);
    expect(broker.accepted.size).toBe(1);
  });

  it("fails closed, without re-submitting, when the duplicate lookup fails", async () => {
    const client = makeClient(broker);
    await createOrder(client, { ...BASE_PARAMS, idempotencyKey: "trade-dup-2" });
    broker.lookupFailure = Object.assign(
      new Error("Request failed with status code 503"),
      { response: { status: 503, data: { message: "upstream unavailable" } } },
    );
    const submissionsBefore = broker.submissions.length;

    await expect(
      createOrder(client, { ...BASE_PARAMS, idempotencyKey: "trade-dup-2" }),
    ).rejects.toBeInstanceOf(DuplicateClientOrderIdError);

    expect(broker.accepted.size).toBe(1);
    expect(broker.submissions.length).toBe(submissionsBefore + 1);
  });

  it("raises the typed duplicate error when the colliding order is terminally dead", async () => {
    broker.acceptedStatus = "canceled";
    const client = makeClient(broker);
    await createOrder(client, { ...BASE_PARAMS, idempotencyKey: "trade-dup-3" });

    await expect(
      createOrder(client, { ...BASE_PARAMS, idempotencyKey: "trade-dup-3" }),
    ).rejects.toBeInstanceOf(DuplicateClientOrderIdError);
    expect(broker.accepted.size).toBe(1);
  });

  it("still surfaces genuine rejections unchanged", async () => {
    const client = makeClient(broker);
    broker.postLandingFailure = Object.assign(
      new Error("Request failed with status code 422"),
      {
        response: {
          status: 422,
          data: { message: "limit price 502.50 is too far from the market" },
        },
      },
    );

    await expect(
      createOrder(client, { ...BASE_PARAMS, idempotencyKey: "trade-reject-1" }),
    ).rejects.toThrow(/502\.50/);
    // A rejection is not a duplicate: no retry, no second order.
    expect(broker.submissions).toHaveLength(1);
  });
});

describe("getOrderByClientOrderId", () => {
  it("returns null when the broker has no order for the id", async () => {
    const client = makeClient(newBroker());
    await expect(getOrderByClientOrderId(client, "never-sent")).resolves.toBeNull();
  });

  it("returns the order when it exists", async () => {
    const broker = newBroker();
    const client = makeClient(broker);
    await createOrder(client, { ...BASE_PARAMS, idempotencyKey: "trade-look-1" });
    const found = await getOrderByClientOrderId(client, "trade-look-1");
    expect(found?.id).toBe("broker-1");
  });
});
