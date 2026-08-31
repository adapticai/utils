import { describe, expect, it } from "vitest";
import {
  AdapticUtilsError,
  type AlpacaBrokerErrorDetail,
  alpacaHttpError,
  AlpacaApiError,
  AlphaVantageError,
  AuthenticationError,
  DataFormatError,
  DuplicateClientOrderIdError,
  enrichAlpacaError,
  extractAlpacaBrokerError,
  getAlpacaBrokerErrorCode,
  getAlpacaBrokerErrorDetail,
  HttpClientError,
  HttpServerError,
  MassiveApiError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  WebSocketError,
} from "../errors";

/**
 * Builds Alpaca's rejection in the SDK/axios error shape: the SDK sets
 * `message` only to the bare status line, and puts the machine-readable reason
 * (numeric `code` + human `message`) in `response.data`.
 */
function alpacaRejection(
  statusCode: number,
  code: number | string,
  message: string,
): Error {
  return Object.assign(
    new Error(`Request failed with status code ${statusCode}`),
    { response: { status: statusCode, data: { code, message } } },
  );
}

describe("AdapticUtilsError", () => {
  it("should create error with all properties", () => {
    const error = new AdapticUtilsError(
      "Test error",
      "TEST_CODE",
      "test-service",
      true,
    );

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_CODE");
    expect(error.service).toBe("test-service");
    expect(error.isRetryable).toBe(true);
    expect(error.name).toBe("AdapticUtilsError");
  });

  it("should default isRetryable to false", () => {
    const error = new AdapticUtilsError("Test", "CODE", "service");

    expect(error.isRetryable).toBe(false);
  });

  it("should be instanceof Error", () => {
    const error = new AdapticUtilsError("Test", "CODE", "service");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AdapticUtilsError);
  });

  it("should preserve cause when provided", () => {
    const cause = new Error("Original error");
    const error = new AdapticUtilsError(
      "Wrapper",
      "CODE",
      "service",
      false,
      cause,
    );

    expect(error.cause).toBe(cause);
  });

  it("should have a stack trace", () => {
    const error = new AdapticUtilsError("Test", "CODE", "service");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("AdapticUtilsError");
  });
});

describe("AlpacaApiError", () => {
  it("should create with service set to alpaca", () => {
    const error = new AlpacaApiError("Alpaca error", "ALPACA_ERR", 400);

    expect(error.service).toBe("alpaca");
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe("AlpacaApiError");
  });

  it("should be retryable for 429 status", () => {
    const error = new AlpacaApiError("Rate limited", "RATE_LIMIT", 429);

    expect(error.isRetryable).toBe(true);
  });

  it("should be retryable for 500 status", () => {
    const error = new AlpacaApiError("Server error", "SERVER_ERR", 500);

    expect(error.isRetryable).toBe(true);
  });

  it("should be retryable for 503 status", () => {
    const error = new AlpacaApiError("Service unavailable", "UNAVAILABLE", 503);

    expect(error.isRetryable).toBe(true);
  });

  it("should not be retryable for 400 status", () => {
    const error = new AlpacaApiError("Bad request", "BAD_REQ", 400);

    expect(error.isRetryable).toBe(false);
  });

  it("should not be retryable for 401 status", () => {
    const error = new AlpacaApiError("Unauthorized", "UNAUTH", 401);

    expect(error.isRetryable).toBe(false);
  });

  it("should not be retryable for undefined status", () => {
    const error = new AlpacaApiError("Unknown", "UNKNOWN");

    expect(error.isRetryable).toBe(false);
    expect(error.statusCode).toBeUndefined();
  });

  it("should be instanceof AdapticUtilsError", () => {
    const error = new AlpacaApiError("Test", "CODE", 200);

    expect(error).toBeInstanceOf(AdapticUtilsError);
    expect(error).toBeInstanceOf(AlpacaApiError);
  });
});

describe("MassiveApiError", () => {
  it("should set service to massive", () => {
    const error = new MassiveApiError("Massive error", "MASSIVE_ERR", 400);

    expect(error.service).toBe("massive");
    expect(error.name).toBe("MassiveApiError");
  });

  it("should be retryable for 429", () => {
    const error = new MassiveApiError("Rate limited", "RATE_LIMIT", 429);

    expect(error.isRetryable).toBe(true);
  });

  it("should not be retryable for 404", () => {
    const error = new MassiveApiError("Not found", "NOT_FOUND", 404);

    expect(error.isRetryable).toBe(false);
  });
});

describe("AlphaVantageError", () => {
  it("should set service to alphavantage", () => {
    const error = new AlphaVantageError("AV error", "AV_ERR", 400);

    expect(error.service).toBe("alphavantage");
    expect(error.name).toBe("AlphaVantageError");
  });

  it("should be retryable for server errors (5xx)", () => {
    const error = new AlphaVantageError("Server error", "SERVER_ERR", 502);

    expect(error.isRetryable).toBe(true);
  });
});

describe("TimeoutError", () => {
  it("should always be retryable", () => {
    const error = new TimeoutError("Request timed out", "alpaca", 30000);

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe("TIMEOUT");
    expect(error.timeoutMs).toBe(30000);
    expect(error.name).toBe("TimeoutError");
  });

  it("should set the service correctly", () => {
    const error = new TimeoutError("Timeout", "massive", 5000);

    expect(error.service).toBe("massive");
  });
});

describe("ValidationError", () => {
  it("should never be retryable", () => {
    const error = new ValidationError("Invalid input", "alpaca", "symbol");

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.invalidField).toBe("symbol");
    expect(error.name).toBe("ValidationError");
  });

  it("should work without invalidField", () => {
    const error = new ValidationError("Invalid", "test");

    expect(error.invalidField).toBeUndefined();
  });
});

describe("AuthenticationError", () => {
  it("should never be retryable", () => {
    const error = new AuthenticationError("Unauthorized", "alpaca", 401);

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe("AUTH_ERROR");
    expect(error.statusCode).toBe(401);
    expect(error.name).toBe("AuthenticationError");
  });
});

describe("HttpClientError", () => {
  it("should not be retryable", () => {
    const error = new HttpClientError("Bad request", "massive", 400);

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe("CLIENT_ERROR");
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe("HttpClientError");
  });
});

describe("HttpServerError", () => {
  it("should always be retryable", () => {
    const error = new HttpServerError("Server error", "alpaca", 500);

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe("SERVER_ERROR");
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe("HttpServerError");
  });
});

describe("RateLimitError", () => {
  it("should always be retryable", () => {
    const error = new RateLimitError("Rate limited", "massive", 5000);

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe("RATE_LIMIT");
    expect(error.retryAfterMs).toBe(5000);
    expect(error.name).toBe("RateLimitError");
  });

  it("should work without retryAfterMs", () => {
    const error = new RateLimitError("Rate limited", "test");

    expect(error.retryAfterMs).toBeUndefined();
    expect(error.isRetryable).toBe(true);
  });
});

describe("WebSocketError", () => {
  it("should default to retryable", () => {
    const error = new WebSocketError("WS error", "alpaca");

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe("WEBSOCKET_ERROR");
    expect(error.name).toBe("WebSocketError");
  });

  it("should allow non-retryable configuration", () => {
    const error = new WebSocketError("WS auth error", "alpaca", false);

    expect(error.isRetryable).toBe(false);
  });
});

describe("NetworkError", () => {
  it("should always be retryable", () => {
    const error = new NetworkError("DNS failure", "massive");

    expect(error.isRetryable).toBe(true);
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.name).toBe("NetworkError");
  });
});

describe("DataFormatError", () => {
  it("should not be retryable", () => {
    const error = new DataFormatError("Invalid JSON", "alpaca");

    expect(error.isRetryable).toBe(false);
    expect(error.code).toBe("DATA_FORMAT_ERROR");
    expect(error.name).toBe("DataFormatError");
  });
});

describe("Error hierarchy", () => {
  it("should all be instanceof Error", () => {
    const errors = [
      new AlpacaApiError("test", "CODE", 400),
      new MassiveApiError("test", "CODE", 400),
      new AlphaVantageError("test", "CODE", 400),
      new TimeoutError("test", "service", 1000),
      new ValidationError("test", "service"),
      new AuthenticationError("test", "service", 401),
      new HttpClientError("test", "service", 400),
      new HttpServerError("test", "service", 500),
      new RateLimitError("test", "service"),
      new WebSocketError("test", "service"),
      new NetworkError("test", "service"),
      new DataFormatError("test", "service"),
    ];

    errors.forEach((error) => {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AdapticUtilsError);
    });
  });

  it("each error should have a unique name", () => {
    const names = [
      new AlpacaApiError("test", "CODE").name,
      new MassiveApiError("test", "CODE").name,
      new AlphaVantageError("test", "CODE").name,
      new TimeoutError("test", "service", 1000).name,
      new ValidationError("test", "service").name,
      new AuthenticationError("test", "service").name,
      new HttpClientError("test", "service", 400).name,
      new HttpServerError("test", "service", 500).name,
      new RateLimitError("test", "service").name,
      new WebSocketError("test", "service").name,
      new NetworkError("test", "service").name,
      new DataFormatError("test", "service").name,
    ];

    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

describe("AlpacaApiError.brokerError (additive field)", () => {
  it("is undefined for the existing (pre-enrichment) constructor call", () => {
    // The load-bearing backward-compat guarantee: every existing construction
    // that stops at `cause` still compiles and leaves the new field undefined.
    const error = new AlpacaApiError("Alpaca error", "ALPACA_ERR", 400);
    expect(error.brokerError).toBeUndefined();
    expect(error.name).toBe("AlpacaApiError");
    expect(error.statusCode).toBe(400);
  });

  it("carries the normalized broker detail when supplied", () => {
    const detail: AlpacaBrokerErrorDetail = {
      brokerCode: 42210000,
      brokerMessage: "cannot replace order in pending_cancel status",
      statusCode: 422,
      raw: { code: 42210000 },
    };
    const error = new AlpacaApiError("m", "C", 422, undefined, detail);
    expect(error.brokerError?.brokerCode).toBe(42210000);
  });
});

describe("extractAlpacaBrokerError", () => {
  it("reads the numeric code + message from an axios/SDK response.data", () => {
    const detail = extractAlpacaBrokerError(
      alpacaRejection(422, 42210000, "cannot replace order"),
    );
    expect(detail).toEqual({
      brokerCode: 42210000,
      brokerMessage: "cannot replace order",
      statusCode: 422,
      raw: { code: 42210000, message: "cannot replace order" },
    });
  });

  it("walks the `cause` chain to find a wrapped SDK rejection", () => {
    // The exact production shape: the wrapper throws its own Error and preserves
    // the SDK rejection (with response.data) as `cause`.
    const wrapper = new Error(
      "Failed to update trailing stop abc: Request failed with status code 422",
      { cause: alpacaRejection(422, 42210000, "cannot replace order") },
    );
    expect(extractAlpacaBrokerError(wrapper)?.brokerCode).toBe(42210000);
  });

  it("accepts a numeric-string code (40310000 as a string)", () => {
    expect(
      extractAlpacaBrokerError(
        alpacaRejection(403, "40310000", "insufficient qty available"),
      )?.brokerCode,
    ).toBe(40310000);
  });

  it("parses a response.data left as an unparsed JSON string", () => {
    const err = Object.assign(new Error("Request failed with status code 422"), {
      response: {
        status: 422,
        data: JSON.stringify({ code: 42210000, message: "stale order" }),
      },
    });
    expect(extractAlpacaBrokerError(err)?.brokerCode).toBe(42210000);
  });

  it("returns undefined for a plain Error with no broker payload (absence stays absent)", () => {
    expect(extractAlpacaBrokerError(new Error("boom"))).toBeUndefined();
    expect(extractAlpacaBrokerError(undefined)).toBeUndefined();
    expect(extractAlpacaBrokerError("string error")).toBeUndefined();
  });

  it("surfaces a known HTTP status even when the body has neither code nor message (status is not discarded)", () => {
    // Gap #1: an object body carrying no `code`/`message` used to return
    // undefined, throwing away a KNOWN 422. The status is itself signal.
    const statusOnly = Object.assign(
      new Error("Request failed with status code 422"),
      { response: { status: 422, data: { unrelated: "field" } } },
    );
    const detail = extractAlpacaBrokerError(statusOnly);
    expect(detail).toBeDefined();
    expect(detail?.statusCode).toBe(422);
    expect(detail?.brokerCode).toBeNull(); // never fabricated into a value
  });

  it("prefers a numeric code deeper in the cause chain over a shallower code-less node (no short-circuit on null code)", () => {
    // Gap #2: a shallow node whose attached brokerError resolved no code must
    // not shadow the real numeric code carried by a deeper cause.
    const coded = alpacaRejection(422, 42210000, "cannot replace order");
    const shallow = Object.assign(new Error("wrapper"), {
      brokerError: {
        brokerCode: null,
        brokerMessage: null,
        statusCode: 429,
        raw: {},
      },
      cause: coded,
    });
    expect(getAlpacaBrokerErrorCode(shallow)).toBe(42210000);
    expect(extractAlpacaBrokerError(shallow)?.brokerCode).toBe(42210000);
  });
});

describe("getAlpacaBrokerErrorCode / getAlpacaBrokerErrorDetail", () => {
  it("returns the numeric code, or null when absent — never a fabricated 0", () => {
    expect(
      getAlpacaBrokerErrorCode(alpacaRejection(422, 42210000, "x")),
    ).toBe(42210000);
    expect(getAlpacaBrokerErrorCode(new Error("no payload"))).toBeNull();
  });

  it("returns the full detail or null", () => {
    expect(
      getAlpacaBrokerErrorDetail(alpacaRejection(403, 40310000, "insufficient")),
    ).toMatchObject({ brokerCode: 40310000, statusCode: 403 });
    expect(getAlpacaBrokerErrorDetail(new Error("plain"))).toBeNull();
  });
});

describe("enrichAlpacaError (additive enrichment)", () => {
  it("preserves message, name, and Error identity while attaching the broker code", () => {
    const source = alpacaRejection(422, 42210000, "cannot replace order");
    const message = "Failed to update trailing stop abc: Request failed with status code 422";
    const thrown = enrichAlpacaError(new Error(message), source);

    // Purely additive: every existing consumer reads the identical value.
    expect(thrown.message).toBe(message);
    expect(thrown.name).toBe("Error");
    expect(thrown).toBeInstanceOf(Error);
    // New consumers get the structured code + the preserved raw rejection.
    expect(thrown.brokerError?.brokerCode).toBe(42210000);
    expect(getAlpacaBrokerErrorCode(thrown)).toBe(42210000);
    expect(thrown.cause).toBe(source);
  });

  it("returns the same target reference (enrichment is in-place)", () => {
    const target = new Error("x");
    expect(enrichAlpacaError(target, alpacaRejection(422, 1, "y"))).toBe(target);
  });

  it("does not overwrite a cause that is already set", () => {
    const original = new Error("original cause");
    const target = new Error("wrap", { cause: original });
    enrichAlpacaError(target, alpacaRejection(422, 42210000, "z"));
    expect(target.cause).toBe(original);
    // The broker detail is still surfaced from the enrichment source.
    expect(getAlpacaBrokerErrorCode(target)).toBe(42210000);
  });

  it("adds no brokerError when the source carries no broker payload", () => {
    const thrown = enrichAlpacaError(new Error("wrap"), new Error("plain"));
    expect(thrown.brokerError).toBeUndefined();
  });
});

describe("alpacaHttpError (raw-fetch seam broker-code preservation)", () => {
  it("attaches a typed .response so the numeric code is recoverable; message byte-identical; instanceof Error", () => {
    // The raw-fetch seams (AlpacaTradingAPI.makeRequest + legacy order helpers)
    // build the thrown error with this instead of a plain `new Error`, so the
    // vendor body reaches getAlpacaBrokerErrorCode without the SDK's axios shape.
    const body = JSON.stringify({
      code: 42210000,
      message: "cannot replace order in pending_cancel status",
    });
    const message = `Alpaca API error (422): ${body}`;
    const err = alpacaHttpError(message, 422, body);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(message);
    expect(err.response).toEqual({ status: 422, data: body });
    expect(getAlpacaBrokerErrorCode(err)).toBe(42210000);
    expect(getAlpacaBrokerErrorDetail(err)).toMatchObject({
      brokerCode: 42210000,
      statusCode: 422,
    });
  });

  it("recovers a numeric-string code body (40310000) from the raw string body", () => {
    const body = JSON.stringify({
      code: "40310000",
      message: "insufficient qty available for order",
    });
    expect(getAlpacaBrokerErrorCode(alpacaHttpError("boom", 403, body))).toBe(
      40310000,
    );
  });
});

describe("DuplicateClientOrderIdError broker payload", () => {
  it("populates brokerError from its cause (the original 422 rejection)", () => {
    const cause = alpacaRejection(422, 42210000, "client_order_id must be unique");
    const error = new DuplicateClientOrderIdError("dup", "coid-1", true, cause);
    expect(error.brokerError?.brokerCode).toBe(42210000);
    expect(error.statusCode).toBe(422);
    // Existing shape is unchanged.
    expect(error.name).toBe("DuplicateClientOrderIdError");
    expect(error.clientOrderId).toBe("coid-1");
    expect(error.cause).toBe(cause);
  });
});
