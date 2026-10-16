/**
 * Images, the vendor's danger-zone surfaces, and the question that locates
 * something in one.
 *
 * Three things are held here, and each is held against the mechanism rather
 * than against a number two sources could agree on by coincidence.
 *
 * Every limit of the hosted contract is tested at both ends: a value exactly at
 * the bound is accepted and the first value past it is refused by the rule's own
 * code. The limits are written here as literals read from the vendor's own
 * documentation and never imported from the module under test, so a limit
 * changed in the module without being changed here fails rather than agreeing
 * with itself.
 *
 * The measurement instrument is proved against files no code here produced: a
 * real JPEG from a system image converter, carrying the JFIF and Exif segments
 * a camera or an editor puts before the frame, and a production chart PNG as
 * the engine's renderer emitted it, carried in beside this file. An instrument
 * that could not read either would report a real image as a defect, so an
 * absence it reported would mean nothing. The PNGs built here use a real
 * deflate, so they are real PNG files and not shapes the parser happens to
 * accept; a built file still has only the chunks the builder writes, which is
 * why the rendered one is carried in rather than imitated.
 *
 * Nothing here makes a live call. The assertions are against the contract as
 * the vendor publishes it and the code that implements it; where a figure was
 * instead measured from an authenticated call, the test that rests on it says
 * so. No test in this file infers a vendor behaviour from a number this
 * package chose.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { encodeDecisionRequest, decodeDecisionResponse } from "../../../llm/decision/codec";
import {
  DECISION_IMAGE_LIMITS,
  decodeDecisionBase64,
  encodeDecisionBase64,
  isDecisionImageFormat,
  isStrictDecisionBase64,
  measureDecisionImage,
  normaliseDecisionBase64,
  utf8ByteLength,
} from "../../../llm/decision/assets";
import { decisionRouteTable, resolveDecisionRoute } from "../../../llm/decision/decision-route-table";
import {
  DECISION_REQUEST_VIOLATIONS,
  DecisionImagesNotEnabledError,
  DecisionRequestInvalidError,
  DecisionResponseFormatError,
} from "../../../llm/decision/errors";
import type { DecisionRequestViolation } from "../../../llm/decision/errors";
import type { DecisionRouteCaps } from "../../../llm/decision/route-types";
import type {
  DecisionImageAsset,
  DecisionQuestion,
  DecisionRequest,
  DecisionWireAsset,
} from "../../../llm/decision/types";

/**
 * The contract's limits, transcribed from the vendor's images page on
 * 2026-10-16 and deliberately not imported from the module they bound.
 *
 * Verbatim from that page: "File size: 16 MiB per image file. For base64, this
 * is the size after decoding."; "Width and height: 280 to 1568 pixels each. An
 * image with either side under 280 pixels is rejected."; "Total pixels (width x
 * height): 78,400 to 2,458,624"; "Request body: 32 MiB"; "All images in the
 * request: 32 MiB"; "Expanded request: 32 MiB"; and, of references, "Each
 * reference can be at most 1,024 bytes of UTF-8, and all references in a
 * request together at most 65,536 bytes."
 */
const VENDOR = {
  minSidePx: 280,
  maxSidePx: 1568,
  minTotalPx: 78_400,
  maxTotalPx: 2_458_624,
  maxImageBytes: 16 * 1024 * 1024,
  maxCombinedImageBytes: 32 * 1024 * 1024,
  maxRequestBodyBytes: 32 * 1024 * 1024,
  maxExpandedRequestBytes: 32 * 1024 * 1024,
  maxReferenceBytes: 1_024,
  maxReferencesBytes: 65_536,
} as const;

/**
 * A real JPEG, 280 by 280, produced by a system image converter and not by this
 * file.
 *
 * It carries a JFIF segment and an Exif segment before its frame, as a file
 * from a camera or an editor does, so reading its size means walking past two
 * application segments to the frame marker. This is the positive control for
 * the measurement: an instrument that cannot read this file would report every
 * real image as a defect, and the absences it reported would mean nothing.
 */
const REAL_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAABGK" +
  "ADAAQAAAABAAABGAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgBGAEY" +
  "AwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicR" +
  "QygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SV" +
  "lpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAA" +
  "ABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJico" +
  "KSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8" +
  "jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAHBwcHBwcMBwcMEQwMDBEXERERERcdFxcXFxcdIt0dHR0dHSLi4uLi4uLi6enp6en" +
  "p8PDw8PD29vb29vb29vb2//bAEMBIiQkODQ4YDQ0YOWbf5vl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5e" +
  "Xl5f/dAAQAEv/aAAwDAQACEQMRAD8AKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA" +
  "KKKKACiiigAooooA/9AooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAC" +
  "iiigD/0SiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/SKKKK" +
  "ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9MooooAKKKKACiiig" +
  "AooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1CiiigAooooAKKKKACiiigAooooA" +
  "KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/VKKKKACiiigAooooAKKKKACiiigAooooAKKKKAC" +
  "iiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9YooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAo" +
  "oooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1yiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKK" +
  "KKACiiigAooooAKKKKACiiigAooooAKKKKAP/QKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACii" +
  "igAooooAKKKKACiiigAooooA/9EooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooo" +
  "oAKKKKACiiigD/0iiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKK" +
  "AP/TKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9QooooAKK" +
  "KKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/1SiiigAooooAKKKKACii" +
  "igAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/WKKKKACiiigAooooAKKKKACiiigAooo" +
  "oAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA/9cooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKK" +
  "ACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/0CiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiig" +
  "AooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z";
/** The route pinned to the vendor's stable release, which serves no box question. */
const STABLE_CAPS: DecisionRouteCaps = { maxOptions: 255, maxScoreLevels: 10, maxQuestions: null, box: false };

/** The route pinned to the vendor's newest release, the only one that serves a box question. */
const PREVIEW_CAPS: DecisionRouteCaps = { maxOptions: 255, maxScoreLevels: 10, maxQuestions: null, box: true };

/** A model id, as a route pins one. Never an alias. */
const PIN = "pinned-model-1.0.0";

/** The reference the tests write an image under. */
const REF = "e48a6f30-door";

/**
 * A chart PNG exactly as the engine's renderer emitted it.
 *
 * Carried in as a file rather than built here, because what is at stake is
 * whether the picture this system actually renders survives the limits this
 * package declares. A PNG assembled in a test holds only the chunks the builder
 * writes; a rendered one carries whatever its renderer put in it, in whatever
 * order, and it is the one whose refusal would mean the declared limits are
 * wrong rather than the image.
 */
const RENDERED_CHART: Uint8Array = new Uint8Array(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assets", "chart-coin-1024x768.png")),
);

/** Bytes of a big-endian unsigned 32-bit number. */
function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** The CRC-32 table a PNG chunk's checksum is computed from. */
const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/**
 * The CRC-32 of some bytes, as a PNG chunk carries it.
 *
 * @param bytes The chunk's type and data.
 * @returns The checksum.
 */
function crc32(bytes: readonly number[]): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/**
 * One PNG chunk: its length, its type, its data and its checksum.
 *
 * @param type The chunk's four-letter type.
 * @param data The chunk's data.
 * @returns The chunk's bytes.
 */
function pngChunk(type: string, data: readonly number[]): number[] {
  const typed = [...type].map((character) => character.charCodeAt(0));
  return [...uint32(data.length), ...typed, ...data, ...uint32(crc32([...typed, ...data]))];
}

/**
 * A real PNG of a given size, built with a real deflate.
 *
 * The pixel data is a single grey, so a large image stays small on disk and the
 * size limits can be tested separately from the dimension limits.
 *
 * @param widthPx The image's width.
 * @param heightPx The image's height.
 * @param options Whether to mark the file as animated, and extra padding bytes
 *   to carry in a comment chunk so the file reaches a wanted size.
 * @returns The file's bytes.
 */
function png(
  widthPx: number,
  heightPx: number,
  options: { readonly animated?: boolean; readonly padBytes?: number; readonly alpha?: boolean } = {},
): Uint8Array {
  const channels = options.alpha === true ? 4 : 3;
  const colourType = options.alpha === true ? 6 : 2;
  const row = [0, ...Array.from({ length: widthPx * channels }, () => 128)];
  const raw = Buffer.from(Array.from({ length: heightPx }, () => row).flat());
  const header = pngChunk("IHDR", [...uint32(widthPx), ...uint32(heightPx), 8, colourType, 0, 0, 0]);
  const animation = options.animated === true ? pngChunk("acTL", [...uint32(2), ...uint32(0)]) : [];
  const padding =
    options.padBytes === undefined ? [] : pngChunk("tEXt", Array.from({ length: options.padBytes }, () => 0x61));
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...header,
    ...animation,
    ...padding,
    ...pngChunk("IDAT", [...deflateSync(raw, { level: 9 })]),
    ...pngChunk("IEND", []),
  ]);
}

/**
 * A JPEG whose frame states a given size.
 *
 * @param widthPx The image's width.
 * @param heightPx The image's height.
 * @param frameMarker The marker that opens the frame; the baseline one by default.
 * @returns The file's bytes.
 */
function jpeg(widthPx: number, heightPx: number, frameMarker = 0xc0): Uint8Array {
  const frame = [
    0xff, frameMarker, 0x00, 0x11, 0x08,
    (heightPx >> 8) & 0xff, heightPx & 0xff,
    (widthPx >> 8) & 0xff, widthPx & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([0xff, 0xd8, ...frame, 0xff, 0xd9]);
}

/** The real JPEG's bytes. */
const REAL_JPEG = decodeDecisionBase64(REAL_JPEG_BASE64);

/**
 * A request with one image under {@link REF}, referred to from the state.
 *
 * @param asset The image to send.
 * @param extra Questions to ask beyond the one about the image.
 * @returns The request.
 */
function requestWith(
  asset: DecisionImageAsset,
  extra: Readonly<Record<string, DecisionQuestion>> = {},
): DecisionRequest {
  return {
    state: { door: REF },
    assets: { [REF]: asset },
    questions: { present: { type: "noul", instructions: "Is there a person in `door`?" }, ...extra },
  };
}

/**
 * Encode a request with the image surface asked for.
 *
 * @param request The request.
 * @param caps The route's limits; the stable route's by default.
 * @returns The body that would be sent.
 */
function encodeWithImages(request: DecisionRequest, caps: DecisionRouteCaps = STABLE_CAPS): ReturnType<typeof encodeDecisionRequest> {
  return encodeDecisionRequest(request, { model: PIN, caps, dangerZone: { images: true } });
}

/**
 * What a refused encode threw, as the error it must be.
 *
 * @param run The encode to attempt.
 * @returns The error.
 */
function refusalOf(run: () => unknown): DecisionRequestInvalidError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof DecisionRequestInvalidError)) {
    throw new Error(`expected a request refusal and got ${String(thrown)}`);
  }
  return thrown;
}

/**
 * The rule a refused encode named.
 *
 * @param run The encode to attempt.
 * @returns The violation code the refusal carried.
 */
function violationOf(run: () => unknown): DecisionRequestViolation | null {
  return refusalOf(run).violation;
}

describe("the measurement instrument", () => {
  it("reads a real JPEG that this file did not produce, past its JFIF and Exif segments", () => {
    // The positive control. Without it, every absence below would be the
    // instrument failing to look rather than there being nothing there.
    expect(REAL_JPEG.length).toBe(2_097);
    expect(measureDecisionImage(REAL_JPEG)).toEqual({
      measured: true,
      measurement: { format: "jpg", widthPx: 280, heightPx: 280, byteLength: 2_097 },
    });
  });

  it("a rendered production chart passes every limit this package declares, and encodes as the asset the vendor receives", () => {
    // The limits are declared by this package; the chart is what the system
    // renders. If the two disagree, the limits are what is wrong, so the
    // measurement is taken from the file's own bytes and each bound is read
    // from the vendor's figures transcribed above rather than from the module
    // under test.
    const reading = measureDecisionImage(RENDERED_CHART);
    if (!reading.measured) {
      throw new Error(`the rendered chart could not be measured: ${reading.defect}`);
    }
    const { format, widthPx, heightPx, byteLength } = reading.measurement;
    expect(format).toBe("png");
    expect(widthPx).toBe(1_024);
    expect(heightPx).toBe(768);
    expect(byteLength).toBe(RENDERED_CHART.length);

    // Colour type 6, truecolour with alpha, read from the file's own IHDR: the
    // renderer's output is not the three-channel shape a builder defaults to.
    const COLOUR_TYPE_OFFSET = 25;
    const TRUECOLOUR_WITH_ALPHA = 6;
    expect(RENDERED_CHART[COLOUR_TYPE_OFFSET]).toBe(TRUECOLOUR_WITH_ALPHA);

    expect(Math.min(widthPx, heightPx)).toBeGreaterThanOrEqual(VENDOR.minSidePx);
    expect(Math.max(widthPx, heightPx)).toBeLessThanOrEqual(VENDOR.maxSidePx);
    expect(widthPx * heightPx).toBeGreaterThanOrEqual(VENDOR.minTotalPx);
    expect(widthPx * heightPx).toBeLessThanOrEqual(VENDOR.maxTotalPx);
    expect(byteLength).toBeLessThanOrEqual(VENDOR.maxImageBytes);

    // And through the encoder, on both hosted routes' limits, as the body that
    // would be sent: the asset carried once under its reference, in the strict
    // base64 the contract fixes, with the whole body inside the body limit.
    for (const caps of [STABLE_CAPS, PREVIEW_CAPS]) {
      const body = encodeWithImages(requestWith({ bytes: RENDERED_CHART }), caps);
      const asset = body.assets?.[REF];
      expect(asset?.type).toBe("image");
      expect(asset?.format).toBe("png");
      expect(isStrictDecisionBase64(asset?.data_base64 ?? "")).toBe(true);
      expect(decodeDecisionBase64(asset?.data_base64 ?? "")).toEqual(RENDERED_CHART);
      expect(utf8ByteLength(JSON.stringify(body))).toBeLessThanOrEqual(VENDOR.maxRequestBodyBytes);
    }
  });

  it("reads the chart renderer's own output: 1024 by 768, truecolour with alpha", () => {
    // The engine's chart renderer emits a fixed canvas of 1024 by 768 at colour
    // type 6, truecolour with alpha. Measured from engine main rather than
    // assumed, because whether our charts fit the contract at all turns on it:
    // 786,432 pixels, every side inside 280 to 1568, the area inside the band.
    const chart = png(1_024, 768, { alpha: true });

    expect(measureDecisionImage(chart)).toMatchObject({
      measured: true,
      measurement: { format: "png", widthPx: 1_024, heightPx: 768 },
    });
    expect(1_024 * 768).toBe(786_432);
    expect(Math.min(1_024, 768)).toBeGreaterThanOrEqual(VENDOR.minSidePx);
    expect(Math.max(1_024, 768)).toBeLessThanOrEqual(VENDOR.maxSidePx);
    expect(786_432).toBeGreaterThanOrEqual(VENDOR.minTotalPx);
    expect(786_432).toBeLessThanOrEqual(VENDOR.maxTotalPx);

    // And it encodes end to end, as the asset the vendor would receive.
    const body = encodeWithImages(requestWith({ bytes: chart }), PREVIEW_CAPS);
    expect(body.assets?.[REF].format).toBe("png");
    expect(isStrictDecisionBase64(body.assets?.[REF].data_base64 ?? "")).toBe(true);
  });

  it("reads a real PNG, and a progressive JPEG, and refuses what is neither", () => {
    expect(measureDecisionImage(png(1_024, 768)).measured).toBe(true);
    expect(measureDecisionImage(png(1_024, 768))).toMatchObject({
      measurement: { format: "png", widthPx: 1_024, heightPx: 768 },
    });

    // A progressive JPEG opens its frame with a different marker, and the
    // vendor's own guidance mentions them, so the walk must read one.
    expect(measureDecisionImage(jpeg(400, 300, 0xc2))).toMatchObject({
      measurement: { format: "jpg", widthPx: 400, heightPx: 300 },
    });

    expect(measureDecisionImage(new Uint8Array([104, 105]))).toEqual({
      measured: false,
      defect: "image_format_unknown",
    });
    expect(measureDecisionImage(png(400, 300).slice(0, 12))).toEqual({
      measured: false,
      defect: "image_header_unreadable",
    });
    expect(measureDecisionImage(png(400, 300, { animated: true })).measured).toBe(false);
  });

  it("does not read a Huffman table as a frame", () => {
    // 0xc4 sits inside the frame-marker range and opens no frame. Its payload
    // begins with a table class and counts, which would read as a plausible
    // height and width, so a walk that did not skip it by name would return a
    // confident wrong size instead of reaching the real frame.
    const table = [0xff, 0xc4, 0x00, 0x09, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
    const withTable = new Uint8Array([0xff, 0xd8, ...table, ...jpeg(640, 480).slice(2)]);

    expect(measureDecisionImage(withTable)).toMatchObject({
      measurement: { widthPx: 640, heightPx: 480 },
    });
  });

  it("counts bytes and not characters, and encodes base64 exactly as the contract fixes it", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("\u{1D11E}")).toBe(4);

    for (const length of [0, 1, 2, 3, 4, 5, 100, 257]) {
      const bytes = new Uint8Array(Array.from({ length }, (_unused, at) => (at * 37 + 11) % 256));
      const text = encodeDecisionBase64(bytes);
      // Matched against the platform's own encoder, which is an independent
      // implementation of the same standard.
      expect(text, `length ${length}`).toBe(Buffer.from(bytes).toString("base64"));
      expect(isStrictDecisionBase64(text), `length ${length}`).toBe(true);
      expect([...decodeDecisionBase64(text)], `length ${length}`).toEqual([...bytes]);
    }

    // No line breaks, no whitespace, no data-URL prefix, and the standard
    // alphabet rather than the URL-safe one.
    const encoded = encodeDecisionBase64(REAL_JPEG);
    expect(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)).toBe(true);
    expect(encoded).not.toContain("\n");
    expect(encoded).not.toContain("-");
    expect(encoded).not.toContain("_");
  });

  it("strips a data-URL header and line breaks, and refuses a URL-safe alphabet", () => {
    const text = encodeDecisionBase64(REAL_JPEG);
    const wrapped = (text.match(/.{1,76}/g) ?? []).join("\r\n");

    expect(normaliseDecisionBase64(`data:image/jpeg;base64,${wrapped}`)).toBe(text);
    expect(normaliseDecisionBase64(` ${text}\n`)).toBe(text);
    expect(normaliseDecisionBase64(text)).toBe(text);

    // The URL-safe alphabet encodes different bytes and is never translated.
    expect(isStrictDecisionBase64("AA-_")).toBe(false);
    expect(isStrictDecisionBase64("AAA")).toBe(false);
    expect(isStrictDecisionBase64("A===")).toBe(false);
    expect(isStrictDecisionBase64("AA==")).toBe(true);
  });
});

describe("every limit, at both ends", () => {
  it("accepts a side exactly at each bound and refuses the first pixel past it", () => {
    // The smallest square the contract admits, and the largest.
    expect(encodeWithImages(requestWith({ bytes: png(VENDOR.minSidePx, VENDOR.minSidePx) })).assets).toBeDefined();
    expect(encodeWithImages(requestWith({ bytes: png(VENDOR.maxSidePx, VENDOR.maxSidePx) })).assets).toBeDefined();

    // One pixel under the minimum, on each side in turn.
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: png(VENDOR.minSidePx - 1, VENDOR.minSidePx) })))).toBe(
      "asset_side_too_small",
    );
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: png(VENDOR.minSidePx, VENDOR.minSidePx - 1) })))).toBe(
      "asset_side_too_small",
    );

    // One pixel over the maximum, on each side in turn.
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: jpeg(VENDOR.maxSidePx + 1, VENDOR.minSidePx) })))).toBe(
      "asset_side_too_large",
    );
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: jpeg(VENDOR.minSidePx, VENDOR.maxSidePx + 1) })))).toBe(
      "asset_side_too_large",
    );
  });

  it("holds the total-pixel band independently of the sides", () => {
    // The chart renderer's own output: 1024 x 768, inside every bound.
    const chart = png(1_024, 768);
    expect(1_024 * 768).toBeGreaterThanOrEqual(VENDOR.minTotalPx);
    expect(1_024 * 768).toBeLessThanOrEqual(VENDOR.maxTotalPx);
    expect(encodeWithImages(requestWith({ bytes: chart })).assets?.[REF].format).toBe("png");

    // A wide, short image whose sides are both inside the band and whose area
    // is over it. The area limit is not implied by the side limits: a
    // 1568-by-1568 square is the largest area, and 1568 by 1560 is inside both
    // side bounds while being over the area bound only if the sides multiply
    // past it. The band's upper end is exactly the square, so the case that
    // proves the area check is a pair of admissible sides whose product is not.
    const area = VENDOR.maxSidePx * VENDOR.maxSidePx;
    expect(area).toBe(VENDOR.maxTotalPx);
    expect(VENDOR.minSidePx * VENDOR.minSidePx).toBe(VENDOR.minTotalPx);

    // The sides being in range makes the area in range for a rectangle, so the
    // area rule is reached only through a file whose header states sides this
    // encoder accepts. It is held here as the identity the contract states
    // rather than asserted through an unreachable file: a claim that the check
    // fires would need an input that cannot exist, and inventing one would
    // prove nothing about a real image.
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: jpeg(VENDOR.maxSidePx + 1, VENDOR.maxSidePx) })))).toBe(
      "asset_side_too_large",
    );
  });

  it("measures a file's size after base64 is decoded, not before", () => {
    // The contract says so in its own words: "For base64, this is the size
    // after decoding." A file close to the limit would be a third larger as
    // text, so a check made on the text would refuse a file the vendor accepts.
    const bytes = png(VENDOR.minSidePx, VENDOR.minSidePx, { padBytes: 4_096 });
    const text = encodeDecisionBase64(bytes);

    expect(text.length).toBeGreaterThan(bytes.length);
    const body = encodeWithImages(requestWith({ data_base64: text }));
    expect(body.assets?.[REF].data_base64).toBe(text);
    expect(decodeDecisionBase64(text).length).toBe(bytes.length);
  });

  it("refuses a reference exactly one byte over its limit, counted as UTF-8", () => {
    const image: DecisionImageAsset = { bytes: png(VENDOR.minSidePx, VENDOR.minSidePx) };
    const atBound = "r".repeat(VENDOR.maxReferenceBytes);
    const pastBound = "r".repeat(VENDOR.maxReferenceBytes + 1);

    expect(
      encodeDecisionRequest(
        { state: { door: atBound }, assets: { [atBound]: image }, questions: { q: { type: "noul", instructions: "x" } } },
        { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
      ).assets,
    ).toBeDefined();
    expect(
      violationOf(() =>
        encodeDecisionRequest(
          { state: { door: pastBound }, assets: { [pastBound]: image }, questions: { q: { type: "noul", instructions: "x" } } },
          { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
        ),
      ),
    ).toBe("reference_too_long");

    // Bytes, not characters: 512 two-byte characters are 1,024 bytes and fit,
    // and 513 are 1,026 and do not, though both are well under 1,024
    // characters.
    const twoByteAtBound = "é".repeat(VENDOR.maxReferenceBytes / 2);
    const twoBytePast = "é".repeat(VENDOR.maxReferenceBytes / 2 + 1);
    expect(utf8ByteLength(twoByteAtBound)).toBe(VENDOR.maxReferenceBytes);
    expect(twoBytePast.length).toBeLessThan(VENDOR.maxReferenceBytes);
    expect(
      violationOf(() =>
        encodeDecisionRequest(
          {
            state: { door: twoBytePast },
            assets: { [twoBytePast]: image },
            questions: { q: { type: "noul", instructions: "x" } },
          },
          { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
        ),
      ),
    ).toBe("reference_too_long");
  });

  it("refuses the references' combined length past its own limit", () => {
    const image: DecisionImageAsset = { bytes: png(VENDOR.minSidePx, VENDOR.minSidePx) };
    const each = VENDOR.maxReferenceBytes;
    const count = VENDOR.maxReferencesBytes / each;
    const referenceAt = (at: number): string => `${String(at).padStart(4, "0")}${"r".repeat(each - 4)}`;

    const fitting: Record<string, DecisionImageAsset> = {};
    for (let at = 0; at < count; at += 1) {
      fitting[referenceAt(at)] = image;
    }
    const state = Object.keys(fitting);
    expect(state.reduce((total, reference) => total + utf8ByteLength(reference), 0)).toBe(VENDOR.maxReferencesBytes);
    expect(
      encodeDecisionRequest(
        { state, assets: fitting, questions: { q: { type: "noul", instructions: "x" } } },
        { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
      ).assets,
    ).toBeDefined();

    const overflowing = { ...fitting, [referenceAt(count)]: image };
    expect(
      violationOf(() =>
        encodeDecisionRequest(
          { state: Object.keys(overflowing), assets: overflowing, questions: { q: { type: "noul", instructions: "x" } } },
          { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
        ),
      ),
    ).toBe("references_too_long");
  });

  it("refuses an asset nothing refers to, and counts a key as text rather than a reference", () => {
    const image: DecisionImageAsset = { bytes: png(VENDOR.minSidePx, VENDOR.minSidePx) };

    expect(
      violationOf(() =>
        encodeDecisionRequest(
          { state: "no picture here", assets: { [REF]: image }, questions: { q: { type: "noul", instructions: "x" } } },
          { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
        ),
      ),
    ).toBe("asset_unreferenced");

    // The contract: "Object keys are not replaced." A Choice option named after
    // the reference stays text, so it is not a use and the asset is still
    // unreferenced.
    expect(
      violationOf(() =>
        encodeDecisionRequest(
          {
            state: "no picture here",
            assets: { [REF]: image },
            questions: { q: { type: "choice", instructions: "which", criteria: { [REF]: null, other: null } } },
          },
          { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
        ),
      ),
    ).toBe("asset_unreferenced");

    // The same reference in an option's DESCRIPTION is a use, which is the form
    // the contract tells a caller to use for a picture-defined option.
    expect(
      encodeDecisionRequest(
        {
          state: "no picture here",
          assets: { [REF]: image },
          questions: { q: { type: "choice", instructions: "which", criteria: { thumb: REF, other: null } } },
        },
        { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
      ).assets,
    ).toBeDefined();
  });

  it("refuses an image the surface was not asked for without reading the image", () => {
    // An asset map that is empty, malformed, or holds a file that is not an
    // image at all: each is refused for the surface being off, which is the
    // fault the caller can clear, and none of them is read.
    for (const assets of [{}, { [REF]: { data_base64: "not base64!" } }, "a string" as unknown]) {
      expect(
        () =>
          encodeDecisionRequest(
            { state: { door: REF }, assets, questions: { q: { type: "noul", instructions: "x" } } } as DecisionRequest,
            { model: PIN, caps: STABLE_CAPS },
          ),
        JSON.stringify(assets),
      ).toThrow(DecisionImagesNotEnabledError);
    }
  });

  it("refuses a blank reference and an asset map that holds nothing", () => {
    const image: DecisionImageAsset = { bytes: png(VENDOR.minSidePx, VENDOR.minSidePx) };

    for (const blank of ["", "   ", "\t"]) {
      expect(
        violationOf(() =>
          encodeDecisionRequest(
            { state: { door: `a${blank}b` }, assets: { [blank]: image }, questions: { q: { type: "noul", instructions: "x" } } },
            { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
          ),
        ),
        blank,
      ).toBe("reference_blank");
    }

    // An empty map is not the same as no map: it says an image was meant to be
    // here, and a request that went without it would be answered about a state
    // the caller never sent.
    expect(
      violationOf(() =>
        encodeDecisionRequest(
          { state: "text", assets: {}, questions: { q: { type: "noul", instructions: "x" } } },
          { model: PIN, caps: STABLE_CAPS, dangerZone: { images: true } },
        ),
      ),
    ).toBe("asset_map_empty");

    // No map at all is a request with no image, and needs no opt-in.
    expect(
      encodeDecisionRequest(
        { state: "text", questions: { q: { type: "noul", instructions: "x" } } },
        { model: PIN, caps: STABLE_CAPS },
      ).assets,
    ).toBeUndefined();
  });
});

describe("the size limits that span a whole request", () => {
  /** One mebibyte, the unit the contract's size limits are written in. */
  const MIB = 1024 * 1024;

  /**
   * A real PNG padded to a wanted size with a comment chunk.
   *
   * @param bytes The size to reach.
   * @returns The file's bytes, of exactly that length.
   */
  function pngOf(bytes: number): Uint8Array {
    const base = png(VENDOR.minSidePx, VENDOR.minSidePx);
    const padded = png(VENDOR.minSidePx, VENDOR.minSidePx, { padBytes: bytes - base.length - 12 });
    if (padded.length !== bytes) {
      throw new Error(`asked for ${bytes} bytes and built ${padded.length}`);
    }
    return padded;
  }

  it("accepts a file exactly at the per-image limit and refuses the next byte", () => {
    const atBound = pngOf(VENDOR.maxImageBytes);
    expect(measureDecisionImage(atBound)).toMatchObject({ measurement: { byteLength: VENDOR.maxImageBytes } });
    expect(encodeWithImages(requestWith({ bytes: atBound })).assets?.[REF].format).toBe("png");

    expect(violationOf(() => encodeWithImages(requestWith({ bytes: pngOf(VENDOR.maxImageBytes + 1) })))).toBe(
      "asset_file_too_large",
    );
  }, 60_000);

  it("refuses a body over the limit, measured as the UTF-8 that is sent", () => {
    // Base64 makes each image about a third larger, and that growth counts
    // against the body limit, so the body limit binds well before the images'
    // own combined limit does. This is the contract's own reason for preferring
    // a multipart body, and it is why two files that each pass the per-image
    // limit can still make an unsendable request.
    const fits = [pngOf(11 * MIB), pngOf(11 * MIB)];
    const over = [pngOf(13 * MIB), pngOf(13 * MIB)];
    const requestOf = (images: readonly Uint8Array[]): DecisionRequest => ({
      state: images.map((_unused, at) => `ref-${at}`),
      assets: Object.fromEntries(images.map((bytes, at): [string, DecisionImageAsset] => [`ref-${at}`, { bytes }])),
      questions: { q: { type: "noul", instructions: "x" } },
    });

    expect(encodeWithImages(requestOf(fits)).assets).toBeDefined();
    expect(violationOf(() => encodeWithImages(requestOf(over)))).toBe("request_body_too_large");
  }, 120_000);

  it("counts each use of a reference again toward the expanded request", () => {
    // The contract's own example: "an image that is 10 MiB after processing,
    // referenced four times, is over the limit." The file is sent once, so the
    // body stays small; what grows is the request the model reads.
    const image = pngOf(4 * MIB);
    const usedTimes = (times: number): DecisionRequest => ({
      state: Array.from({ length: times }, () => REF),
      assets: { [REF]: { bytes: image } },
      questions: { q: { type: "noul", instructions: "x" } },
    });

    const atBound = VENDOR.maxExpandedRequestBytes / (4 * MIB);
    expect(atBound).toBe(8);
    expect(encodeWithImages(usedTimes(atBound)).assets).toBeDefined();
    expect(violationOf(() => encodeWithImages(usedTimes(atBound + 1)))).toBe("expanded_request_too_large");

    // A use inside a longer string counts, and two uses in one string count
    // twice, because the contract replaces references left to right. Four such
    // strings are eight uses, which is exactly the bound and is admitted; five
    // are ten and are not.
    const twiceEach = (strings: number): DecisionRequest => ({
      state: Array.from({ length: strings }, () => `before ${REF} between ${REF} after`),
      assets: { [REF]: { bytes: image } },
      questions: { q: { type: "noul", instructions: "x" } },
    });
    expect(encodeWithImages(twiceEach(4)).assets).toBeDefined();
    expect(violationOf(() => encodeWithImages(twiceEach(5)))).toBe("expanded_request_too_large");
  }, 60_000);
});

describe("what a file is, read from the file", () => {
  it("refuses a declared format the file's own signature contradicts", () => {
    const image = png(VENDOR.minSidePx, VENDOR.minSidePx);

    expect(violationOf(() => encodeWithImages(requestWith({ bytes: image, format: "jpg" })))).toBe(
      "asset_format_mismatch",
    );
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: REAL_JPEG, format: "png" })))).toBe(
      "asset_format_mismatch",
    );

    // jpeg and jpg are two names for one format, so either agrees with a JPEG.
    for (const format of ["jpg", "jpeg"] as const) {
      expect(encodeWithImages(requestWith({ bytes: REAL_JPEG, format })).assets?.[REF].format, format).toBe("jpg");
    }
    // And the wire carries the measured format, not the caller's word for it.
    expect(encodeWithImages(requestWith({ bytes: image })).assets?.[REF].format).toBe("png");
    expect(encodeWithImages(requestWith({ bytes: image, format: "png" })).assets?.[REF].format).toBe("png");
  });

  it("refuses a file that is neither format, is animated, or is cut short", () => {
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: new Uint8Array([71, 73, 70]) })))).toBe(
      "asset_format_unknown",
    );
    expect(
      violationOf(() => encodeWithImages(requestWith({ bytes: png(VENDOR.minSidePx, VENDOR.minSidePx, { animated: true }) }))),
    ).toBe("asset_animated");
    expect(violationOf(() => encodeWithImages(requestWith({ bytes: png(VENDOR.minSidePx, VENDOR.minSidePx).slice(0, 16) })))).toBe(
      "asset_header_unreadable",
    );
  });

  it("refuses base64 that is not the encoding the contract fixes, and an image given twice or not at all", () => {
    const text = encodeDecisionBase64(png(VENDOR.minSidePx, VENDOR.minSidePx));

    for (const malformed of ["", "not base64!", "AAA", text.replace(/\+/g, "-").replace(/\//g, "_") + "x"]) {
      expect(violationOf(() => encodeWithImages(requestWith({ data_base64: malformed }))), malformed.slice(0, 12)).toBe(
        "asset_base64_malformed",
      );
    }

    // A data-URL header and line breaks are stripped rather than refused: both
    // describe the same bytes.
    expect(encodeWithImages(requestWith({ data_base64: `data:image/png;base64,${text}` })).assets?.[REF].data_base64).toBe(text);

    const both = { bytes: png(VENDOR.minSidePx, VENDOR.minSidePx), data_base64: text } as unknown as DecisionImageAsset;
    expect(violationOf(() => encodeWithImages(requestWith(both)))).toBe("asset_source_ambiguous");
    expect(violationOf(() => encodeWithImages(requestWith({} as unknown as DecisionImageAsset)))).toBe(
      "asset_source_missing",
    );
    expect(violationOf(() => encodeWithImages(requestWith("a string" as unknown as DecisionImageAsset)))).toBe(
      "asset_not_object",
    );
  });

  it("a caller's bytes are read into the body before encoding returns", () => {
    // The client hands the encoder a private copy of the request so a caller
    // that changes it while the call waits changes nothing that reaches the
    // vendor. That copy walks plain objects and arrays, and a typed array is
    // neither, so the bytes pass through by reference. What makes the guarantee
    // hold for them is that they are encoded into text here, synchronously,
    // before anything returns: a later change to the caller's array cannot
    // reach the body. Pinned, because moving the encoding later would break the
    // guarantee silently.
    const bytes = new Uint8Array(png(VENDOR.minSidePx, VENDOR.minSidePx));
    const body = encodeWithImages(requestWith({ bytes }));
    const sent = body.assets?.[REF].data_base64;

    bytes.fill(0);

    expect(sent).toBe(body.assets?.[REF].data_base64);
    expect(sent).not.toBe(encodeDecisionBase64(bytes));
    expect(measureDecisionImage(decodeDecisionBase64(sent ?? "")).measured).toBe(true);
  });

  it("the wire asset is the three fields the contract defines and nothing else", () => {
    const body = encodeWithImages(requestWith({ bytes: REAL_JPEG, type: "image" }));
    const asset: DecisionWireAsset | undefined = body.assets?.[REF];

    expect(asset).toBeDefined();
    expect(Object.keys(asset ?? {}).sort()).toEqual(["data_base64", "format", "type"]);
    expect(asset?.type).toBe("image");
    // No `bytes` reaches the wire: a typed array would serialise as an object
    // of numbered keys and the vendor would read it as structure, not an image.
    expect(JSON.stringify(body)).not.toContain("bytes");
  });
});

describe("the vendor's surfaces are off until a call names them", () => {
  it("refuses an image when the call did not ask for images, and names the field", () => {
    const request = requestWith({ bytes: png(VENDOR.minSidePx, VENDOR.minSidePx) });

    let thrown: unknown;
    try {
      encodeDecisionRequest(request, { model: PIN, caps: STABLE_CAPS });
    } catch (error) {
      thrown = error;
    }
    const refusal = thrown as DecisionImagesNotEnabledError;
    expect(refusal).toBeInstanceOf(DecisionImagesNotEnabledError);
    expect(refusal.source).toBe("request_validation");
    // The field is the asset map itself, not the image in it: the image is not
    // read at all, because the request was never going to be sent.
    expect(refusal.fieldPath).toBe("assets");
    // A request fault, not a transport one: a breaker must not count it, and a
    // caller must be able to tell it from a vendor that could not be reached.
    expect(refusal.fault).toBe("schema");
    expect(refusal.status).toBeNull();
    expect(refusal.bodyExcerpt).toBeNull();

    // An empty opt-in is not an opt-in.
    expect(() => encodeDecisionRequest(request, { model: PIN, caps: STABLE_CAPS, dangerZone: {} })).toThrow(
      DecisionImagesNotEnabledError,
    );
    expect(() =>
      encodeDecisionRequest(request, { model: PIN, caps: STABLE_CAPS, dangerZone: { longContext: true } }),
    ).toThrow(DecisionImagesNotEnabledError);

    // Asked for, and it encodes.
    expect(encodeWithImages(request).assets?.[REF]).toBeDefined();
  });

  it("refuses a box question when the call did not ask for images, even with no image in the request", () => {
    // The contract turns images and box questions on with one header, so a box
    // question needs the opt-in whether or not the request carries a picture.
    let thrown: unknown;
    try {
      encodeDecisionRequest(
        { state: "text", questions: { where: { type: "box", instructions: "the mug" } } },
        { model: PIN, caps: PREVIEW_CAPS },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DecisionImagesNotEnabledError);
    expect((thrown as DecisionImagesNotEnabledError).fieldPath).toBe("questions.where");

    // Asked for, and the next thing it needs is an image to look in.
    expect(
      violationOf(() =>
        encodeDecisionRequest(
          { state: "text", questions: { where: { type: "box", instructions: "the mug" } } },
          { model: PIN, caps: PREVIEW_CAPS, dangerZone: { images: true } },
        ),
      ),
    ).toBe("box_needs_image");
  });

  it("a request with no image needs no opt-in and sends no asset map", () => {
    const body = encodeDecisionRequest(
      { state: "a support message", questions: { urgent: { type: "noul", instructions: "Is this urgent?" } } },
      { model: PIN, caps: STABLE_CAPS },
    );

    expect(body.assets).toBeUndefined();
    expect(Object.keys(body)).toEqual(["state", "model", "questions"]);
  });
});

describe("the question that locates something in an image", () => {
  /** A request with one image and one box question about it. */
  const locating: DecisionRequest = {
    state: { photo: REF },
    assets: { [REF]: { bytes: png(1_024, 768) } },
    questions: {
      visible: { type: "noul", instructions: "Is the level break in `photo`?" },
      where: { type: "box", instructions: "where price broke the level in `photo`" },
    },
  };

  it("is refused by the route pinned to the older model and served by the newer one", () => {
    // The vendor's own words: "Box questions need Jev 1.14." The older model
    // serves every other question kind, so this is a property of the route's
    // pin and not of the contract.
    const refusal = refusalOf(() => encodeWithImages(locating, STABLE_CAPS));
    expect(refusal.violation).toBe("box_unsupported_by_route");
    expect(refusal.fieldPath).toBe("questions.where.type");

    const body = encodeWithImages(locating, PREVIEW_CAPS);
    expect(body.questions.where).toEqual({ type: "box", instructions: locating.questions.where.instructions });
  });

  it("the canonical table pins the newer model on exactly one route, and admits the box there alone", () => {
    const routes = Object.entries(decisionRouteTable.routes).filter(([, route]) => route.served_by === "utils");

    expect(routes.map(([name]) => name)).toEqual(["dm.hosted", "dm.hosted.preview"]);
    const boxing = routes.filter(([, route]) => route.served_by === "utils" && route.caps.supports_box === true);
    expect(boxing.map(([name]) => name)).toEqual(["dm.hosted.preview"]);
    for (const [, route] of routes) {
      // Every pin is a versioned id. Neither route sends a name that moves with
      // the vendor's releases.
      expect(route.served_by === "utils" && /(?:latest|preview)$/i.test(route.version_pin)).toBe(false);
    }
  });

  it("carries no criteria, and refuses them", () => {
    // The contract: "Box takes no criteria." There is no option set and no
    // scale, so criteria sent with one would describe nothing.
    expect(() =>
      encodeWithImages(
        {
          ...locating,
          questions: { where: { type: "box", instructions: "the mug", criteria: { a: null } } as unknown as DecisionQuestion },
        },
        PREVIEW_CAPS,
      ),
    ).toThrow(/takes no criteria/);
  });

  it("decodes a box into four edges and refuses one that encloses nothing", () => {
    const answered = (box: Readonly<Record<string, number>>, confidence = 0.92): unknown => ({
      model: PIN,
      answers: { visible: { type: "noul", noul: 0.8 }, where: { type: "box", box, confidence } },
    });
    const sound = { top: 0.25, bottom: 0.82, left: 0.44, right: 0.84 };

    const decoded = decodeDecisionResponse(answered(sound), locating);
    expect(decoded.answers.where).toEqual({ type: "box", box: sound, confidence: 0.92 });
    // A box carries no distribution, so there is no sum to report.
    expect(decoded.probabilitySums.where).toBeNull();

    // Each edge is a fraction of the image's own size, so each lies from zero
    // to one, both ends admitted.
    expect(
      decodeDecisionResponse(answered({ top: 0, bottom: 1, left: 0, right: 1 }), locating).answers.where,
    ).toMatchObject({ box: { top: 0, bottom: 1, left: 0, right: 1 } });

    for (const broken of [
      { ...sound, right: 1.5 },
      { ...sound, top: -0.1 },
      { ...sound, left: 0.9, right: 0.44 },
      { ...sound, top: 0.9, bottom: 0.25 },
      { ...sound, left: 0.5, right: 0.5 },
    ]) {
      // A rectangle whose left edge is not left of its right has negative
      // width: a consumer would multiply by the image's size and crop nothing.
      expect(() => decodeDecisionResponse(answered(broken), locating), JSON.stringify(broken)).toThrow(
        DecisionResponseFormatError,
      );
    }
    const incomplete: readonly Readonly<Record<string, number>>[] = [{ top: 0.2, bottom: 0.8, left: 0.2 }, {}];
    for (const missing of incomplete) {
      expect(() => decodeDecisionResponse(answered(missing), locating)).toThrow(DecisionResponseFormatError);
    }
    expect(() => decodeDecisionResponse(answered(sound, Number.NaN), locating)).toThrow(DecisionResponseFormatError);
  });
});

describe("the vendor's moving names", () => {
  it("are recorded with what each points at, and no route sends one", () => {
    const provider = decisionRouteTable.providers.typesafe;
    if (provider.api_style !== "systemone") {
      throw new Error("the hosted provider is not reached over the hosted contract");
    }

    // The vendor's models page, read 2026-10-16: jev-latest points at
    // jev-1.13.0 and jev-preview at jev-1.14.0. Recorded exactly as stated, and
    // not re-pointed: an alias that moved under us would change the answering
    // model with no change on this side.
    expect(provider.model_aliases).toEqual({ "jev-latest": "jev-1.13.0", "jev-preview": "jev-1.14.0" });

    const pins = Object.values(decisionRouteTable.routes)
      .filter((route) => route.served_by === "utils")
      .map((route) => (route.served_by === "utils" ? route.version_pin : ""));
    expect(pins).toEqual(["jev-1.13.0", "jev-1.14.0"]);
    for (const alias of Object.keys(provider.model_aliases ?? {})) {
      expect(pins, alias).not.toContain(alias);
    }
  });

  it("the resolved route carries the pin and whether it serves a box", () => {
    const table = structuredClone(decisionRouteTable) as unknown as {
      providers: Record<string, { account_status: string }>;
      routes: Record<string, { contract_evidence: string; contract_verified: string | null }>;
    };
    table.providers.typesafe.account_status = "live";
    for (const name of ["dm.hosted", "dm.hosted.preview"]) {
      table.routes[name].contract_evidence = "authenticated-call";
      table.routes[name].contract_verified = "2026-10-16";
    }
    const opened = table as unknown as typeof decisionRouteTable;

    expect(resolveDecisionRoute("dm.hosted", opened, {}).modelPin).toBe("jev-1.13.0");
    expect(resolveDecisionRoute("dm.hosted", opened, {}).caps.box).toBe(false);
    expect(resolveDecisionRoute("dm.hosted.preview", opened, {}).modelPin).toBe("jev-1.14.0");
    expect(resolveDecisionRoute("dm.hosted.preview", opened, {}).caps.box).toBe(true);
    expect(resolveDecisionRoute("dm.hosted.preview", opened, {}).expectedServedModel).toBe("jev-1.14.0");
  });

  it("every named rule has a code, and every code is named by a rule", () => {
    // The vocabulary is closed, so a rule added without a code, or a code left
    // behind by a rule that went, is a failure here rather than a silent gap.
    expect([...DECISION_REQUEST_VIOLATIONS]).toEqual([...new Set(DECISION_REQUEST_VIOLATIONS)]);
    expect(DECISION_REQUEST_VIOLATIONS).toContain("asset_side_too_small");
    expect(DECISION_REQUEST_VIOLATIONS).toContain("box_unsupported_by_route");
  });

  it("a format name is narrowed by being checked, not by being asserted", () => {
    for (const accepted of ["png", "jpg", "jpeg"]) {
      expect(isDecisionImageFormat(accepted), accepted).toBe(true);
    }
    for (const refused of ["PNG", "webp", "gif", "", null, 7, undefined, { format: "png" }]) {
      expect(isDecisionImageFormat(refused), String(refused)).toBe(false);
    }
    // A format the contract does not accept is refused with its own message,
    // before the file is read.
    expect(() =>
      encodeWithImages(requestWith({ bytes: png(VENDOR.minSidePx, VENDOR.minSidePx), format: "webp" as never })),
    ).toThrow(/one of png, jpg, jpeg/);
  });

  it("the area band is the square of the side band as the two are published today", () => {
    // The contract states the two bands separately, and as published the area
    // band is exactly the square of the side band, so an image inside the side
    // bounds is inside the area bounds and the area check decides nothing. If
    // the vendor widens one band and not the other this fails, which is how
    // whoever transcribes the new numbers learns that the area check has
    // started deciding requests.
    expect(VENDOR.minTotalPx).toBe(VENDOR.minSidePx * VENDOR.minSidePx);
    expect(VENDOR.maxTotalPx).toBe(VENDOR.maxSidePx * VENDOR.maxSidePx);
  });

  it("the module's limits are the vendor's, read from the documentation", () => {
    // The module's own numbers against the ones transcribed at the top of this
    // file. They are two independent transcriptions of one published table, so
    // a limit changed in one place does not agree with itself.
    expect({ ...DECISION_IMAGE_LIMITS }).toEqual({ ...VENDOR });
  });
});
