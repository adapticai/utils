/**
 * Images on a typed decision call: the bounds, the header, and the no-op proof.
 *
 * Three things are being asserted, and the LAST one is the most important.
 *
 * 1. THE BOUNDS ARE THE VENDOR'S, CHECKED BEFORE DISPATCH. Each bound is
 *    documented (docs.typesafe.ai/images, read 2026-10-16) and answered with a
 *    400 or a 413, so each is refused here, where a refusal costs nothing, with
 *    a message naming the field.
 *
 * 2. THE HEADER TRAVELS ONLY WHERE IT IS DECLARED. The vendor requires
 *    `TypeSafe-Danger-Zone-Images: true` on every request holding an image and
 *    answers one without it with "Images are not turned on". The name comes
 *    from the route's declaration, so the test asserts the mechanism (declared
 *    name, sent only with images) rather than a constant in the transport.
 *
 * 3. A TEXT-ONLY REQUEST IS BYTE-IDENTICAL TO BEFORE. Image support is a new
 *    field on an existing request type, and the only way that is safe for the
 *    requests this package already makes is if they encode to the same bytes
 *    and carry the same headers. That is asserted directly, on the body and on
 *    the header set, because "it should not affect them" is not a measurement.
 *
 * @module __tests__/llm/decision/images
 */

import { describe, expect, it } from "vitest";

import { decodeDecisionResponse, encodeDecisionRequest } from "../../../llm/decision/codec";
import { decisionRouteTable, decisionRouteViolations } from "../../../llm/decision/decision-route-table";
import { DecisionRequestInvalidError, DecisionResponseFormatError } from "../../../llm/decision/errors";
import { decodeStrictBase64, imageDimensions, validateAssets } from "../../../llm/decision/images";
import type { DecisionImageLimits } from "../../../llm/decision/images";
import { createSystemOneTransport } from "../../../llm/decision/transports/systemone";
import type { ResolvedDecisionRoute, DecisionRouteImages } from "../../../llm/decision/route-types";
import type { DecisionRequest, DecisionWireRequest } from "../../../llm/decision/types";
import { createDecisionFetchDouble, decisionResponse } from "./support/fetch-double";

/** The route's declared image bounds, as the canonical table states them. */
const IMAGES: DecisionRouteImages = {
  supported: true,
  header: "TypeSafe-Danger-Zone-Images",
  formats: ["png", "jpg", "jpeg"],
  min_side_px: 280,
  max_side_px: 1568,
  min_total_px: 78_400,
  max_total_px: 2_458_624,
  max_image_bytes: 16 * 1024 * 1024,
  max_total_bytes: 32 * 1024 * 1024,
  box: false,
  production_status: "not production ready, in the vendor's own words",
};

/** The same bounds in the codec's own shape. */
const LIMITS: DecisionImageLimits = {
  formats: IMAGES.formats,
  minSidePx: IMAGES.min_side_px,
  maxSidePx: IMAGES.max_side_px,
  minTotalPx: IMAGES.min_total_px,
  maxTotalPx: IMAGES.max_total_px,
  maxImageBytes: IMAGES.max_image_bytes,
  maxTotalBytes: IMAGES.max_total_bytes,
};

/** CRC-32, as a PNG chunk carries it. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A PNG whose IHDR header states the given size.
 *
 * The signature, the chunk length and the CRC are all real, because the parser
 * under test reads exactly those: a fixture that skipped them would prove the
 * test can write bytes, not that the parser can read a PNG.
 *
 * @param widthPx Width in pixels.
 * @param heightPx Height in pixels.
 * @param padBytes Extra trailing bytes, for a size test.
 * @returns The PNG bytes.
 */
function pngOf(widthPx: number, heightPx: number, padBytes = 0): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(widthPx, 0);
  header.writeUInt32BE(heightPx, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = Buffer.concat([Buffer.from("IHDR", "latin1"), header]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(chunk), 0);
  return Buffer.concat([signature, length, chunk, crc, Buffer.alloc(padBytes)]);
}

/**
 * A JPEG whose first start-of-frame marker states the given size.
 *
 * @param widthPx Width in pixels.
 * @param heightPx Height in pixels.
 * @returns The JPEG bytes.
 */
function jpegOf(widthPx: number, heightPx: number): Buffer {
  const frame = Buffer.alloc(10);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(8, 2);
  frame[4] = 8;
  frame.writeUInt16BE(heightPx, 5);
  frame.writeUInt16BE(widthPx, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame]);
}

/** The asset key every test references. Long and distinctive, as a key must be. */
const ASSET_KEY = "chart-0123456789ab";

/** A request carrying one chart, referenced from the state. */
function imageRequest(bytes: Buffer = pngOf(1024, 768)): DecisionRequest {
  return {
    state: { chart: ASSET_KEY },
    questions: {
      turn: { type: "noul", instructions: "Has the move in `chart` turned?" },
    },
    assets: { [ASSET_KEY]: { type: "image", format: "png", data_base64: bytes.toString("base64") } },
  };
}

/** Encode options for a route that declares images. */
const WITH_IMAGES = {
  model: "jev-1.13.0",
  caps: { maxOptions: 255, maxScoreLevels: 10, maxQuestions: null },
  images: IMAGES,
};

/** Encode options for a route that declares nothing about images. */
const WITHOUT_IMAGES = { model: "jev-1.13.0", caps: WITH_IMAGES.caps };

describe("base64 is exactly what the vendor accepts", () => {
  it("accepts standard padded base64 and rejects what the vendor documents as unusable", () => {
    const bytes = pngOf(280, 280);
    const encoded = bytes.toString("base64");
    expect(decodeStrictBase64(encoded)?.equals(bytes)).toBe(true);
    expect(decodeStrictBase64(`data:image/png;base64,${encoded}`)).toBeNull();
    expect(decodeStrictBase64(`${encoded.slice(0, 8)}\n${encoded.slice(8)}`)).toBeNull();
    expect(decodeStrictBase64("not base64 at all!!")).toBeNull();
    expect(decodeStrictBase64("")).toBeNull();
  });
});

describe("dimensions are read from the header, never assumed", () => {
  it("reads a PNG's IHDR and a JPEG's first frame", () => {
    expect(imageDimensions(pngOf(1024, 768))).toEqual({ widthPx: 1024, heightPx: 768 });
    expect(imageDimensions(jpegOf(640, 480))).toEqual({ widthPx: 640, heightPx: 480 });
  });

  it("returns null — UNKNOWN — for bytes with no readable header", () => {
    expect(imageDimensions(Buffer.from("this is not an image"))).toBeNull();
    expect(imageDimensions(pngOf(1024, 768).subarray(0, 16))).toBeNull();
  });
});

describe("validateAssets holds each image to the route's declared bounds", () => {
  const referenced = (): boolean => true;

  it("accepts an in-band chart", () => {
    const assets = { [ASSET_KEY]: { type: "image", format: "png", data_base64: pngOf(1024, 768).toString("base64") } };
    const validation = validateAssets(assets, LIMITS, referenced);
    expect(validation.violations).toEqual([]);
    expect(validation.assets).toEqual([{ key: ASSET_KEY, format: "png", byteLength: 33, widthPx: 1024, heightPx: 768 }]);
  });

  it("names each bound it refuses", () => {
    const cases: ReadonlyArray<readonly [string, Buffer, RegExp]> = [
      ["a side under the minimum", pngOf(279, 280), /minimum side/],
      ["a side over the maximum", pngOf(1569, 280), /maximum side/],
      ["a pixel count out of band", pngOf(280, 279), /pixels, outside/],
    ];
    for (const [label, bytes, pattern] of cases) {
      const assets = { [ASSET_KEY]: { type: "image", format: "png", data_base64: bytes.toString("base64") } };
      const violations = validateAssets(assets, LIMITS, referenced).violations.join(" | ");
      expect(violations, label).toMatch(pattern);
    }
  });

  it("refuses an unreferenced asset, which the vendor refuses too", () => {
    const assets = { [ASSET_KEY]: { type: "image", format: "png", data_base64: pngOf(1024, 768).toString("base64") } };
    const violations = validateAssets(assets, LIMITS, () => false).violations.join(" | ");
    expect(violations).toMatch(/never referenced/);
  });

  it("refuses a key short enough to occur by accident", () => {
    const assets = { ab: { type: "image", format: "png", data_base64: pngOf(1024, 768).toString("base64") } };
    const violations = validateAssets(assets, LIMITS, referenced).violations.join(" | ");
    expect(violations).toMatch(/under 8 characters/);
  });

  it("refuses an unsupported format and a per-image size over the ceiling", () => {
    const gif = { [ASSET_KEY]: { type: "image", format: "gif", data_base64: pngOf(1024, 768).toString("base64") } };
    expect(validateAssets(gif, LIMITS, referenced).violations.join(" | ")).toMatch(/format must be one of/);

    const tight: DecisionImageLimits = { ...LIMITS, maxImageBytes: 16 };
    const big = { [ASSET_KEY]: { type: "image", format: "png", data_base64: pngOf(1024, 768, 64).toString("base64") } };
    expect(validateAssets(big, tight, referenced).violations.join(" | ")).toMatch(/per-image limit/);
  });
});

describe("the codec carries an asset map only where the route declares one", () => {
  it("carries the map, rebuilt with the wire's fields", () => {
    const body = encodeDecisionRequest(imageRequest(), WITH_IMAGES);
    expect(body.assets).toEqual({
      [ASSET_KEY]: { type: "image", format: "png", data_base64: pngOf(1024, 768).toString("base64") },
    });
  });

  it("refuses images on a route that declares none, before anything is sent", () => {
    expect(() => encodeDecisionRequest(imageRequest(), WITHOUT_IMAGES)).toThrow(DecisionRequestInvalidError);
    expect(() => encodeDecisionRequest(imageRequest(), WITHOUT_IMAGES)).toThrow(/declares no image support/);
  });

  it("refuses an empty asset map rather than sending a header for nothing", () => {
    const request: DecisionRequest = { ...imageRequest(), assets: {} };
    expect(() => encodeDecisionRequest(request, WITH_IMAGES)).toThrow(/at least one image/);
  });

  it("refuses a box question on a route whose pin does not serve Box", () => {
    const request: DecisionRequest = {
      state: { chart: ASSET_KEY },
      questions: { where: { type: "box", instructions: `Find the break in \`chart\`. ${ASSET_KEY}` } },
      assets: imageRequest().assets,
    };
    expect(() => encodeDecisionRequest(request, WITH_IMAGES)).toThrow(/box support/);
  });

  it("carries a box question on a route that declares box support, and refuses one with no image", () => {
    const withBox = { ...WITH_IMAGES, images: { ...IMAGES, box: true } };
    const request: DecisionRequest = {
      state: { chart: ASSET_KEY },
      questions: { where: { type: "box", instructions: `Find the break in \`chart\`. ${ASSET_KEY}` } },
      assets: imageRequest().assets,
    };
    expect(encodeDecisionRequest(request, withBox).questions.where).toEqual({
      type: "box",
      instructions: `Find the break in \`chart\`. ${ASSET_KEY}`,
    });

    const textOnly: DecisionRequest = { state: { chart: "nothing" }, questions: request.questions };
    expect(() => encodeDecisionRequest(textOnly, withBox)).toThrow(/carries none/);
  });

  it("refuses criteria on a box question, which the wire has no shape for", () => {
    const withBox = { ...WITH_IMAGES, images: { ...IMAGES, box: true } };
    const request = {
      state: { chart: ASSET_KEY },
      questions: { where: { type: "box", instructions: "Find it", criteria: { a: "b" } } },
      assets: imageRequest().assets,
    };
    expect(() => encodeDecisionRequest(request as DecisionRequest, withBox)).toThrow(/takes no criteria/);
  });
});

describe("a text-only request is unchanged by image support", () => {
  const TEXT_ONLY: DecisionRequest = {
    state: "Help! My payouts have been failing for 3 days.",
    questions: {
      department: {
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: { billing: "Payments, invoicing, refunds", technical: null },
      },
    },
  };

  it("encodes to the same body, with no assets field at all", () => {
    const body = encodeDecisionRequest(TEXT_ONLY, WITH_IMAGES);
    expect(Object.keys(body)).toEqual(["state", "model", "questions"]);
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({ state: TEXT_ONLY.state, model: WITH_IMAGES.model, questions: TEXT_ONLY.questions }),
    );
    expect(JSON.stringify(encodeDecisionRequest(TEXT_ONLY, WITHOUT_IMAGES))).toBe(JSON.stringify(body));
  });
});

describe("a box answer is read, and a malformed one rejected whole", () => {
  const withBox = { ...WITH_IMAGES, images: { ...IMAGES, box: true } };
  const request: DecisionRequest = {
    state: { chart: ASSET_KEY },
    questions: { where: { type: "box", instructions: `Find the break in \`chart\`. ${ASSET_KEY}` } },
    assets: imageRequest().assets,
  };

  it("reads the four edges as fractions and carries the vendor's confidence", () => {
    encodeDecisionRequest(request, withBox);
    const decoded = decodeDecisionResponse(
      {
        model: "jev-1.14.0",
        answers: { where: { type: "box", box: { top: 0.1, bottom: 0.4, left: 0.2, right: 0.6 }, confidence: 0.42 } },
      },
      request,
    );
    expect(decoded.answers.where).toEqual({
      type: "box",
      box: { top: 0.1, bottom: 0.4, left: 0.2, right: 0.6 },
      confidence: 0.42,
    });
    expect(decoded.probabilitySums.where).toBeNull();
  });

  it("rejects a box whose edges are out of order rather than swapping them", () => {
    expect(() =>
      decodeDecisionResponse(
        {
          model: "jev-1.14.0",
          answers: { where: { type: "box", box: { top: 0.9, bottom: 0.1, left: 0.2, right: 0.6 }, confidence: 0.4 } },
        },
        request,
      ),
    ).toThrow(DecisionResponseFormatError);
  });

  it("rejects an edge outside [0, 1] rather than clamping it", () => {
    expect(() =>
      decodeDecisionResponse(
        {
          model: "jev-1.14.0",
          answers: { where: { type: "box", box: { top: 0.1, bottom: 1.4, left: 0.2, right: 0.6 }, confidence: 0.4 } },
        },
        request,
      ),
    ).toThrow(DecisionResponseFormatError);
  });
});

describe("the transport sends the vendor's image header exactly where it belongs", () => {
  const KEY_ENV = "DECISION_IMAGE_TEST_KEY";
  const route = (images: DecisionRouteImages | null): ResolvedDecisionRoute => ({
    route: "dm.hosted",
    providerName: "vendor",
    provider: {
      api_style: "systemone",
      base_url: "https://vendor.invalid",
      base_url_env: null,
      api_key_env: KEY_ENV,
      secret_path: "test/decision-vendor",
      account_status: "live",
    },
    modelPin: "jev-1.13.0",
    expectedServedModel: "jev-1.13.0",
    budgetMs: 1500,
    caps: { maxOptions: 255, maxScoreLevels: 10, maxQuestions: null },
    maxStateTokens: 32_000,
    priceAnchor: null,
    apiKeyEnv: KEY_ENV,
    baseUrl: "https://vendor.invalid",
    images,
  });

  /** Make one call and return the headers it sent. */
  async function headersFor(
    images: DecisionRouteImages | null,
    body: DecisionWireRequest,
  ): Promise<Readonly<Record<string, string>>> {
    process.env[KEY_ENV] = "sk-test-key";
    try {
      const double = createDecisionFetchDouble(() =>
        decisionResponse(200, JSON.stringify({ model: "jev-1.13.0", answers: {}, usage: { input_tokens: 1 } })),
      );
      const transport = createSystemOneTransport({ fetchImpl: double.fetchImpl });
      await transport.execute({ route: route(images), body, signal: new AbortController().signal });
      return double.calls[0].headers;
    } finally {
      delete process.env[KEY_ENV];
    }
  }

  it("sends the declared header on a request carrying images", async () => {
    const headers = await headersFor(IMAGES, encodeDecisionRequest(imageRequest(), WITH_IMAGES));
    expect(headers[IMAGES.header.toLowerCase()]).toBe("true");
  });

  it("sends no image header on a text-only request", async () => {
    const body = encodeDecisionRequest(
      { state: "text", questions: { q: { type: "noul", instructions: "Is it text?" } } },
      WITH_IMAGES,
    );
    const headers = await headersFor(IMAGES, body);
    expect(Object.hasOwn(headers, IMAGES.header.toLowerCase())).toBe(false);
  });

  it("sends no image header for a route that declares none, even if a body carried assets", async () => {
    const headers = await headersFor(null, encodeDecisionRequest(imageRequest(), WITH_IMAGES));
    expect(Object.hasOwn(headers, IMAGES.header.toLowerCase())).toBe(false);
  });
});

describe("the canonical route table", () => {
  it("declares images and box on the hosted route, with the vendor's bounds", () => {
    const hosted = decisionRouteTable.routes["dm.hosted"];
    expect(hosted.images?.supported).toBe(true);
    expect(hosted.images?.header).toBe("TypeSafe-Danger-Zone-Images");
    expect(hosted.images?.min_side_px).toBe(280);
    expect(hosted.images?.max_side_px).toBe(1568);
    expect(hosted.images?.min_total_px).toBe(280 * 280);
    expect(hosted.images?.max_total_px).toBe(1568 * 1568);
    expect(hosted.images?.production_status).toMatch(/ready for production/);

    // Box is served from Jev 1.14, so the declaration is true only of a route pinned there.
    expect(hosted.images?.box).toBe(true);
    if (hosted.served_by !== "utils") {
      throw new Error("the hosted route is not served by this package");
    }
    expect(hosted.version_pin).toBe("jev-1.14.0");
    expect(decisionRouteViolations(decisionRouteTable)).toEqual([]);
  });

  it("refuses a half-written image declaration, and refuses box support without image support", () => {
    const broken = JSON.parse(JSON.stringify(decisionRouteTable)) as {
      routes: Record<string, { images?: Record<string, unknown> }>;
    };
    broken.routes["dm.hosted"].images = { ...IMAGES, min_side_px: 2000 };
    expect(decisionRouteViolations(broken as unknown as typeof decisionRouteTable).join(" | ")).toMatch(
      /min_side_px must not exceed max_side_px/,
    );

    const boxOnly = JSON.parse(JSON.stringify(decisionRouteTable)) as {
      routes: Record<string, { images?: Record<string, unknown> }>;
    };
    boxOnly.routes["dm.hosted"].images = { ...IMAGES, supported: false, box: true };
    expect(decisionRouteViolations(boxOnly as unknown as typeof decisionRouteTable).join(" | ")).toMatch(
      /box support without image support/,
    );
  });
});
