/**
 * The image assets a typed request may carry, and every bound the vendor sets on them.
 *
 * WHY THE CHECKS ARE HERE AND NOT AT THE VENDOR. Each of these bounds is
 * answered with a 400 or a 413 (docs.typesafe.ai/images): an unsupported
 * format, an image under 280 or over 1568 pixels on a side, a total pixel count
 * outside 78,400..2,458,624, an image over 16 MiB, a body over 32 MiB, and an
 * asset that nothing references. A typed decision call runs inside a sub-second
 * deadline, so a refusal that costs nothing is worth strictly more than a round
 * trip that ends in a rejection — and the caller gets a message naming the
 * field rather than a vendor status to interpret.
 *
 * THE DIMENSIONS ARE READ FROM THE BYTES. A caller's own belief about an
 * image's size is not evidence: the header is. PNG dimensions come from IHDR,
 * JPEG dimensions from the first SOF marker, and bytes whose header cannot be
 * read are refused as unreadable rather than assumed to be in band.
 *
 * REFERENCE REQUIREMENT. The vendor replaces a reference with the image
 * wherever the key appears — as a whole string value or inside a string — and
 * refuses a request whose declared asset is never referenced. Both halves
 * matter: an unreferenced asset is a request that pays for bytes nobody looks
 * at, and a key short enough to occur by accident would splice an image into
 * unrelated text. So a key must be long enough and distinctive enough to be
 * deliberate, and it must appear somewhere.
 *
 * @module llm/decision/images
 */

import { DECISION_IMAGE_FORMATS } from "./types";
import type { DecisionImageFormat } from "./types";

/** The vendor's pixel bounds and byte ceilings, as a route declares them. */
export interface DecisionImageLimits {
  readonly formats: readonly DecisionImageFormat[];
  readonly minSidePx: number;
  readonly maxSidePx: number;
  readonly minTotalPx: number;
  readonly maxTotalPx: number;
  readonly maxImageBytes: number;
  readonly maxTotalBytes: number;
}

/** Shortest asset key this package will send. A key that can occur by accident is a defect. */
export const MIN_ASSET_KEY_LENGTH = 8;

/** The vendor's ceiling on one reference's length, in bytes. */
export const MAX_ASSET_KEY_BYTES = 1024;

/** The eight-byte PNG signature. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Offset of IHDR's type field in a well-formed PNG. */
const PNG_IHDR_TYPE_OFFSET = 12;

/** Offset of IHDR's width field. */
const PNG_WIDTH_OFFSET = 16;

/** Offset of IHDR's height field. */
const PNG_HEIGHT_OFFSET = 20;

/** Smallest PNG prefix carrying a complete IHDR header. */
const PNG_HEADER_BYTES = 24;

/** JPEG start-of-image marker. */
const JPEG_SOI = 0xffd8;

/** Marker introducer. */
const JPEG_MARKER_PREFIX = 0xff;

/** Markers that carry the frame's dimensions. */
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Base64 with the standard alphabet and at most two padding characters. */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Base64 encodes three bytes in four characters. */
const BASE64_GROUP = 4;

/** The pixel dimensions of an image, or `null` when its header cannot be read. */
export function imageDimensions(bytes: Buffer): { readonly widthPx: number; readonly heightPx: number } | null {
  return pngDimensions(bytes) ?? jpegDimensions(bytes);
}

/**
 * Read a PNG's dimensions from its IHDR chunk.
 *
 * @param bytes The image bytes.
 * @returns The dimensions, or `null` when the bytes are not a readable PNG.
 */
function pngDimensions(bytes: Buffer): { readonly widthPx: number; readonly heightPx: number } | null {
  if (bytes.length < PNG_HEADER_BYTES) return null;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  if (bytes.subarray(PNG_IHDR_TYPE_OFFSET, PNG_IHDR_TYPE_OFFSET + 4).toString("latin1") !== "IHDR") return null;
  const widthPx = bytes.readUInt32BE(PNG_WIDTH_OFFSET);
  const heightPx = bytes.readUInt32BE(PNG_HEIGHT_OFFSET);
  return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
}

/**
 * Read a JPEG's dimensions from its first start-of-frame marker.
 *
 * @param bytes The image bytes.
 * @returns The dimensions, or `null` when no frame header can be read.
 */
function jpegDimensions(bytes: Buffer): { readonly widthPx: number; readonly heightPx: number } | null {
  const SEGMENT_HEADER_BYTES = 4;
  const FRAME_HEIGHT_OFFSET = 5;
  const FRAME_WIDTH_OFFSET = 7;
  if (bytes.length < SEGMENT_HEADER_BYTES || bytes.readUInt16BE(0) !== JPEG_SOI) return null;
  let position = 2;
  while (position + SEGMENT_HEADER_BYTES <= bytes.length) {
    if (bytes[position] !== JPEG_MARKER_PREFIX) return null;
    const marker = bytes[position + 1];
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (position + FRAME_WIDTH_OFFSET + 2 > bytes.length) return null;
      const heightPx = bytes.readUInt16BE(position + FRAME_HEIGHT_OFFSET);
      const widthPx = bytes.readUInt16BE(position + FRAME_WIDTH_OFFSET);
      return widthPx > 0 && heightPx > 0 ? { widthPx, heightPx } : null;
    }
    const segmentLength = bytes.readUInt16BE(position + 2);
    if (segmentLength < 2) return null;
    position += 2 + segmentLength;
  }
  return null;
}

/**
 * Decode base64 that is exactly what the vendor accepts.
 *
 * @param text The encoded bytes.
 * @returns The decoded bytes, or `null` when the text is not standard padded
 *   base64 — including when it carries line breaks or a data-URL prefix.
 */
export function decodeStrictBase64(text: string): Buffer | null {
  if (text.length === 0 || text.length % BASE64_GROUP !== 0) return null;
  if (!BASE64_PATTERN.test(text)) return null;
  const decoded = Buffer.from(text, "base64");
  return decoded.toString("base64") === text ? decoded : null;
}

/** One asset, as it was validated. */
export interface ValidatedAsset {
  readonly key: string;
  readonly format: DecisionImageFormat;
  readonly byteLength: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** What the asset map was found to be. */
export interface AssetValidation {
  readonly assets: readonly ValidatedAsset[];
  /** One message per violation, each naming its field. Empty when the map is sound. */
  readonly violations: readonly string[];
}

/**
 * Check one asset map against a route's declared image limits.
 *
 * @param assets The map, already known to be an object of objects.
 * @param limits The route's declared bounds.
 * @param isReferenced Whether a key appears anywhere in the request's text.
 * @returns What was validated, and every violation found.
 */
export function validateAssets(
  assets: Readonly<Record<string, { readonly format: unknown; readonly data_base64: unknown; readonly type?: unknown }>>,
  limits: DecisionImageLimits,
  isReferenced: (key: string) => boolean,
): AssetValidation {
  const violations: string[] = [];
  const validated: ValidatedAsset[] = [];
  let totalBytes = 0;

  for (const key of Object.keys(assets)) {
    const at = `assets.${key}`;
    if (key.trim().length < MIN_ASSET_KEY_LENGTH) {
      violations.push(`${at} has a key under ${MIN_ASSET_KEY_LENGTH} characters: a key short enough to occur by accident would splice an image into unrelated text`);
    }
    if (Buffer.byteLength(key, "utf8") > MAX_ASSET_KEY_BYTES) {
      violations.push(`${at} has a key over the vendor's ${MAX_ASSET_KEY_BYTES}-byte reference limit`);
    }
    if (!isReferenced(key)) {
      violations.push(`${at} is never referenced by the state, an instruction or a criteria description, which the vendor refuses`);
    }
    const asset = assets[key];
    if (asset.type !== undefined && asset.type !== "image") {
      violations.push(`${at}.type must be "image" when it is given`);
    }
    const declared = asset.format;
    const format: DecisionImageFormat | undefined = DECISION_IMAGE_FORMATS.find(
      (candidate): boolean => candidate === declared,
    );
    if (format === undefined) {
      violations.push(`${at}.format must be one of ${DECISION_IMAGE_FORMATS.join(", ")}`);
      continue;
    }
    if (!limits.formats.includes(format)) {
      violations.push(`${at}.format ${format} is not one the route declares: ${limits.formats.join(", ")}`);
      continue;
    }
    if (typeof asset.data_base64 !== "string") {
      violations.push(`${at}.data_base64 must be base64 text, and is ${typeof asset.data_base64}`);
      continue;
    }
    const bytes = decodeStrictBase64(asset.data_base64);
    if (bytes === null) {
      violations.push(`${at}.data_base64 must be standard padded base64 with no line breaks and no data-URL prefix`);
      continue;
    }
    if (bytes.length > limits.maxImageBytes) {
      violations.push(`${at} is ${bytes.length} bytes, over the route's ${limits.maxImageBytes}-byte per-image limit`);
    }
    totalBytes += bytes.length;
    const dimensions = imageDimensions(bytes);
    if (dimensions === null) {
      violations.push(`${at} carries no readable ${format.toUpperCase()} header, so its dimensions are unknown`);
      continue;
    }
    const { widthPx, heightPx } = dimensions;
    if (widthPx < limits.minSidePx || heightPx < limits.minSidePx) {
      violations.push(`${at} is ${widthPx}x${heightPx}, under the route's ${limits.minSidePx} px minimum side`);
    }
    if (widthPx > limits.maxSidePx || heightPx > limits.maxSidePx) {
      violations.push(`${at} is ${widthPx}x${heightPx}, over the route's ${limits.maxSidePx} px maximum side`);
    }
    const totalPx = widthPx * heightPx;
    if (totalPx < limits.minTotalPx || totalPx > limits.maxTotalPx) {
      violations.push(`${at} has ${totalPx} pixels, outside the route's ${limits.minTotalPx}..${limits.maxTotalPx} band`);
    }
    validated.push({ key, format, byteLength: bytes.length, widthPx, heightPx });
  }

  if (totalBytes > limits.maxTotalBytes) {
    violations.push(`assets carry ${totalBytes} bytes together, over the route's ${limits.maxTotalBytes}-byte limit`);
  }
  return { assets: validated, violations };
}
