/**
 * Images for a typed decision request: how one is encoded, and what is
 * measured about it before anything is sent.
 *
 * An image reaches the hosted contract as an entry in the request's top-level
 * `assets` map, keyed by a reference string that is written wherever the image
 * belongs. Everything in this module is a pure function of its arguments: no
 * clock, no environment, no network, and nothing platform-specific. The base64
 * codec is written out here rather than taken from a runtime, because the
 * contract fixes the encoding exactly — the standard alphabet, `=` padding, no
 * line breaks, no `data:` prefix — and a runtime helper that differs in any of
 * those produces a body the vendor rejects for a reason the caller cannot see.
 *
 * Two measurements are taken from the bytes themselves and never from what the
 * caller said about them. The format is read from the file's own signature, so
 * a PNG labelled `jpg` is refused here instead of being refused by the vendor
 * as a damaged file. The pixel dimensions are read from the image header, so a
 * file outside the accepted side or area band is refused before it is paid
 * for. A dimension that cannot be read is not a dimension of zero: it is an
 * unreadable file, and it is refused as one.
 *
 * Nothing here resizes, re-encodes, rotates or repairs an image. The contract
 * rejects a file outside its limits rather than fitting it, and a library that
 * quietly fitted one would change the picture the model was asked about.
 *
 * @module llm/decision/assets
 */

/** Bytes in one kibibyte, the unit the contract's size limits are written in. */
const BYTES_PER_KIB = 1024;

/** Bytes in one mebibyte. */
const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;

/**
 * The limits the hosted contract places on images, in its own units.
 *
 * Every one of them is inclusive of both ends: the contract states that an
 * image outside a limit is rejected and never resized to fit, so a value
 * exactly at a bound is accepted and the first value past it is not.
 */
export const DECISION_IMAGE_LIMITS = {
  /** Fewest pixels an image may measure on either side. */
  minSidePx: 280,
  /** Most pixels an image may measure on either side. */
  maxSidePx: 1568,
  /**
   * Fewest pixels an image may hold in total.
   *
   * The contract states the area band and the side band separately. As the two
   * are published today the area band is exactly the square of the side band,
   * so an image inside the side bounds is inside the area bounds and the area
   * check has no input of its own. It is written out, and tested as the
   * identity it currently is, because which of the two the vendor widens next
   * is the vendor's to decide: the day the bands stop being squares of each
   * other, the area check starts deciding requests and the identity test fails
   * so that whoever transcribes the new numbers learns it.
   */
  minTotalPx: 280 * 280,
  /** Most pixels an image may hold in total. See {@link DECISION_IMAGE_LIMITS.minTotalPx}. */
  maxTotalPx: 1568 * 1568,
  /** Largest one image file may be, measured after base64 is decoded. */
  maxImageBytes: 16 * BYTES_PER_MIB,
  /**
   * Largest every distinct image in one request may be together.
   *
   * Base64 makes each image about a third larger and that growth counts against
   * the request-body limit, which is the same 32 MiB, so under the JSON body
   * this package sends the body limit is always reached first and this one has
   * no input of its own. It is written out because it is the contract's rule for
   * the multipart body the contract recommends, and it starts deciding requests
   * the day that body is built.
   */
  maxCombinedImageBytes: 32 * BYTES_PER_MIB,
  /** Largest the whole request body may be, measured as the UTF-8 it is sent as. */
  maxRequestBodyBytes: 32 * BYTES_PER_MIB,
  /** Largest the request may be once every reference is replaced by its image. */
  maxExpandedRequestBytes: 32 * BYTES_PER_MIB,
  /** Longest one reference string may be, in UTF-8 bytes. */
  maxReferenceBytes: BYTES_PER_KIB,
  /** Longest every reference in one request may be together, in UTF-8 bytes. */
  maxReferencesBytes: 64 * BYTES_PER_KIB,
} as const;

/** The image formats the hosted contract accepts, written as it writes them. */
export const DECISION_IMAGE_FORMATS = ["png", "jpg", "jpeg"] as const;

/** One image format the contract accepts. See {@link DECISION_IMAGE_FORMATS}. */
export type DecisionImageFormat = (typeof DECISION_IMAGE_FORMATS)[number];

/**
 * The format a file's own signature says it is.
 *
 * `jpeg` and `jpg` are two names for one format, and a signature cannot tell
 * them apart, so a measured format is only ever one of these two.
 */
export type DecisionMeasuredFormat = "png" | "jpg";

/** What was measured from one image's bytes. */
export interface DecisionImageMeasurement {
  /** The format the file's own signature says it is. */
  readonly format: DecisionMeasuredFormat;
  readonly widthPx: number;
  readonly heightPx: number;
  /** The file's size in bytes, which for a base64 asset is the size after decoding. */
  readonly byteLength: number;
}

/** Why an image's bytes could not be measured. */
export type DecisionImageDefect =
  | "image_format_unknown"
  | "image_animated"
  | "image_header_unreadable";

/** The outcome of measuring one image: what was read, or why nothing could be. */
export type DecisionImageReading =
  | { readonly measured: true; readonly measurement: DecisionImageMeasurement }
  | { readonly measured: false; readonly defect: DecisionImageDefect };

/** The base64 alphabet the contract fixes: standard, not the URL-safe variant. */
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The character that pads a base64 group to four. */
const BASE64_PAD = "=";

/** Characters per encoded group. */
const BASE64_GROUP_CHARS = 4;

/** Bytes per encoded group. */
const BASE64_GROUP_BYTES = 3;

/** Bits one base64 character carries. */
const BASE64_BITS = 6;

/** Bits one byte carries. */
const BITS_PER_BYTE = 8;

/** The mask that takes the low eight bits of an accumulator. */
const BYTE_MASK = 0xff;

/** Base64 text in exactly the form the contract fixes, padding included. */
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** A `data:` URL's header, up to and including the comma that ends it. */
const DATA_URL_PREFIX = /^data:[^,]*,/;

/** Whitespace of any kind, which base64 as the contract fixes it never holds. */
const ANY_WHITESPACE = /\s+/g;

/** The eight bytes that open every PNG file. */
const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Offset at which a PNG's first chunk begins, just past the signature. */
const PNG_FIRST_CHUNK_AT = 8;

/** Bytes a PNG chunk spends on its length and its type before its data. */
const PNG_CHUNK_HEADER_BYTES = 8;

/** Bytes a PNG chunk spends on its trailing checksum. */
const PNG_CHUNK_CRC_BYTES = 4;

/** Offset of a PNG's width within the IHDR chunk's data. */
const PNG_IHDR_WIDTH_AT = 0;

/** Offset of a PNG's height within the IHDR chunk's data. */
const PNG_IHDR_HEIGHT_AT = 4;

/** Fewest bytes of IHDR data a PNG's dimensions can be read from. */
const PNG_IHDR_MIN_BYTES = 8;

/** The PNG chunk that carries the image header. */
const PNG_HEADER_CHUNK = "IHDR";

/** The PNG chunk an animated PNG carries, which the contract rejects. */
const PNG_ANIMATION_CHUNK = "acTL";

/** The PNG chunk that opens the image data, past which no animation chunk may appear. */
const PNG_DATA_CHUNK = "IDAT";

/** Bytes in a PNG chunk's type, and in each of its big-endian lengths. */
const PNG_WORD_BYTES = 4;

/** The two bytes that open every JPEG file. */
const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8];

/** The byte that opens every JPEG marker. */
const JPEG_MARKER_LEAD = 0xff;

/** Bytes a JPEG segment spends on its own length, the two included. */
const JPEG_LENGTH_BYTES = 2;

/** Offset of a JPEG frame's height within its segment's payload, past the sample precision. */
const JPEG_FRAME_HEIGHT_AT = 1;

/** Offset of a JPEG frame's width within its segment's payload. */
const JPEG_FRAME_WIDTH_AT = 3;

/** Fewest payload bytes a JPEG frame's dimensions can be read from. */
const JPEG_FRAME_MIN_BYTES = 5;

/** First marker of the range that opens a JPEG frame. */
const JPEG_FRAME_MARKER_FIRST = 0xc0;

/** Last marker of the range that opens a JPEG frame. */
const JPEG_FRAME_MARKER_LAST = 0xcf;

/**
 * Markers inside the frame range that open no frame.
 *
 * Huffman tables, an arithmetic-coding conditioning segment, the reserved
 * extension and the start of a restart interval all share the range, and each
 * carries a payload that would read as a plausible set of dimensions.
 */
const JPEG_NON_FRAME_MARKERS: ReadonlySet<number> = new Set([0xc4, 0xc8, 0xcc]);

/** The marker that ends the headers and opens the entropy-coded scan. */
const JPEG_SCAN_MARKER = 0xda;

/** The marker that ends a JPEG file. */
const JPEG_END_MARKER = 0xd9;

/** First standalone marker, which carries no length and no payload. */
const JPEG_STANDALONE_FIRST = 0xd0;

/** Last standalone marker, which carries no length and no payload. */
const JPEG_STANDALONE_LAST = 0xd9;

/** The byte that pads the run before a JPEG marker, and is skipped. */
const JPEG_FILL = 0xff;

/** Reverse of the base64 alphabet: character code to its six-bit value. */
const BASE64_VALUES: ReadonlyMap<string, number> = new Map(
  [...BASE64_ALPHABET].map((character, index): [string, number] => [character, index]),
);

/**
 * Encode bytes as base64 in exactly the form the contract fixes.
 *
 * The standard alphabet, `=` padding to a whole group, and nothing else: no
 * line breaks, no whitespace and no `data:` prefix. Written here rather than
 * taken from a runtime so the output is the same text on every platform this
 * package runs on.
 *
 * @param bytes The file's bytes.
 * @returns The base64 text, ready to be sent as `data_base64`.
 */
export function encodeDecisionBase64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += BASE64_GROUP_BYTES) {
    const remaining = bytes.length - at;
    const first = bytes[at] ?? 0;
    const second = remaining > 1 ? (bytes[at + 1] ?? 0) : 0;
    const third = remaining > 2 ? (bytes[at + 2] ?? 0) : 0;
    const group = (first << (BITS_PER_BYTE * 2)) | (second << BITS_PER_BYTE) | third;
    const characters = [
      BASE64_ALPHABET[(group >> (BASE64_BITS * 3)) & 0x3f] ?? "",
      BASE64_ALPHABET[(group >> (BASE64_BITS * 2)) & 0x3f] ?? "",
      remaining > 1 ? (BASE64_ALPHABET[(group >> BASE64_BITS) & 0x3f] ?? "") : BASE64_PAD,
      remaining > 2 ? (BASE64_ALPHABET[group & 0x3f] ?? "") : BASE64_PAD,
    ];
    text += characters.join("");
  }
  return text;
}

/**
 * Put base64 text into the one form the contract accepts.
 *
 * A caller's text can arrive carrying a `data:` URL header, or broken into
 * lines by an encoder that wraps at a column. Both are stripped here rather
 * than refused, because both describe the same bytes and the contract's
 * complaint about either is one the caller could not act on. Nothing else is
 * changed: a URL-safe alphabet is a different encoding of different bytes and
 * is not silently translated.
 *
 * @param text The caller's base64 text.
 * @returns The text with any `data:` header and any whitespace removed.
 */
export function normaliseDecisionBase64(text: string): string {
  return text.replace(DATA_URL_PREFIX, "").replace(ANY_WHITESPACE, "");
}

/**
 * Whether text is base64 in exactly the form the contract fixes.
 *
 * @param text The text, already normalised.
 * @returns True when it holds only the standard alphabet and is padded to a
 *   whole group of four.
 */
export function isStrictDecisionBase64(text: string): boolean {
  return text.length % BASE64_GROUP_CHARS === 0 && STRICT_BASE64.test(text);
}

/**
 * Decode base64 text in the contract's own form back to bytes.
 *
 * @param text The base64 text, already normalised and known to be strict.
 * @returns The bytes it encodes.
 */
export function decodeDecisionBase64(text: string): Uint8Array {
  const padding = text.endsWith(`${BASE64_PAD}${BASE64_PAD}`)
    ? 2
    : text.endsWith(BASE64_PAD)
      ? 1
      : 0;
  const groups = text.length / BASE64_GROUP_CHARS;
  const bytes = new Uint8Array(groups * BASE64_GROUP_BYTES - padding);
  let written = 0;
  for (let at = 0; at < text.length; at += BASE64_GROUP_CHARS) {
    let group = 0;
    for (let step = 0; step < BASE64_GROUP_CHARS; step += 1) {
      group = (group << BASE64_BITS) | (BASE64_VALUES.get(text[at + step] ?? BASE64_PAD) ?? 0);
    }
    for (let step = BASE64_GROUP_BYTES - 1; step >= 0; step -= 1) {
      const byte = (group >> (BITS_PER_BYTE * step)) & BYTE_MASK;
      if (written < bytes.length) {
        bytes[written] = byte;
        written += 1;
      }
    }
  }
  return bytes;
}

/**
 * The number of bytes text occupies when it is sent as UTF-8.
 *
 * Every size the contract states is a count of bytes rather than of
 * characters, and the two differ for every character outside ASCII. Counted
 * here from the code points, so the same text measures the same on every
 * platform.
 *
 * @param text The text to measure.
 * @returns Its length in UTF-8 bytes.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Whether bytes open with a given signature.
 *
 * @param bytes The file's bytes.
 * @param signature The bytes a file of this format opens with.
 * @returns True when every byte of the signature is present at the start.
 */
function opensWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, at) => bytes[at] === byte);
}

/**
 * Read a big-endian unsigned 32-bit number.
 *
 * @param bytes The file's bytes.
 * @param at Offset of the number's first byte.
 * @returns The number, or `null` when the file ends before it.
 */
function readUint32(bytes: Uint8Array, at: number): number | null {
  if (at + PNG_WORD_BYTES > bytes.length) {
    return null;
  }
  return (
    ((bytes[at] ?? 0) * 0x1000000 +
      ((bytes[at + 1] ?? 0) << 16) +
      ((bytes[at + 2] ?? 0) << 8) +
      (bytes[at + 3] ?? 0)) >>>
    0
  );
}

/**
 * Read a big-endian unsigned 16-bit number.
 *
 * @param bytes The file's bytes.
 * @param at Offset of the number's first byte.
 * @returns The number, or `null` when the file ends before it.
 */
function readUint16(bytes: Uint8Array, at: number): number | null {
  if (at + JPEG_LENGTH_BYTES > bytes.length) {
    return null;
  }
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

/**
 * Read four bytes as the ASCII name of a PNG chunk.
 *
 * @param bytes The file's bytes.
 * @param at Offset of the name's first byte.
 * @returns The name, or `null` when the file ends before it.
 */
function readChunkType(bytes: Uint8Array, at: number): string | null {
  if (at + PNG_WORD_BYTES > bytes.length) {
    return null;
  }
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  );
}

/**
 * Measure a PNG from its header, and find out whether it is animated.
 *
 * The chunks are walked rather than the header read at its usual offset, so an
 * animation control chunk placed anywhere before the image data is found. An
 * animated PNG is a defect and not a measurement: the contract rejects one,
 * and its first frame's dimensions would read as a still image's.
 *
 * @param bytes The file's bytes.
 * @returns What was measured, or why nothing could be.
 */
function readPngImage(bytes: Uint8Array): DecisionImageReading {
  let header: { readonly widthPx: number; readonly heightPx: number } | null = null;
  let at = PNG_FIRST_CHUNK_AT;
  while (at + PNG_CHUNK_HEADER_BYTES <= bytes.length) {
    const length = readUint32(bytes, at);
    const type = readChunkType(bytes, at + PNG_WORD_BYTES);
    if (length === null || type === null) {
      break;
    }
    const dataAt = at + PNG_CHUNK_HEADER_BYTES;
    if (type === PNG_ANIMATION_CHUNK) {
      return { measured: false, defect: "image_animated" };
    }
    if (type === PNG_HEADER_CHUNK && header === null) {
      if (length < PNG_IHDR_MIN_BYTES) {
        return { measured: false, defect: "image_header_unreadable" };
      }
      const widthPx = readUint32(bytes, dataAt + PNG_IHDR_WIDTH_AT);
      const heightPx = readUint32(bytes, dataAt + PNG_IHDR_HEIGHT_AT);
      if (widthPx === null || heightPx === null) {
        return { measured: false, defect: "image_header_unreadable" };
      }
      header = { widthPx, heightPx };
    }
    if (type === PNG_DATA_CHUNK) {
      break;
    }
    at = dataAt + length + PNG_CHUNK_CRC_BYTES;
  }
  if (header === null || header.widthPx === 0 || header.heightPx === 0) {
    return { measured: false, defect: "image_header_unreadable" };
  }
  return {
    measured: true,
    measurement: {
      format: "png",
      widthPx: header.widthPx,
      heightPx: header.heightPx,
      byteLength: bytes.length,
    },
  };
}

/**
 * Measure a JPEG by walking its markers to the frame that states its size.
 *
 * Only the markers that open a frame are read. The four that share the frame
 * range and open none — the Huffman tables, the arithmetic-coding conditioning
 * segment, the reserved extension and the restart interval — are skipped by
 * name, because each carries a payload whose first bytes would read as a
 * plausible height and width.
 *
 * @param bytes The file's bytes.
 * @returns What was measured, or why nothing could be.
 */
function readJpegImage(bytes: Uint8Array): DecisionImageReading {
  let at = JPEG_SIGNATURE.length;
  while (at < bytes.length) {
    if (bytes[at] !== JPEG_MARKER_LEAD) {
      return { measured: false, defect: "image_header_unreadable" };
    }
    let markerAt = at;
    while (markerAt < bytes.length && bytes[markerAt] === JPEG_FILL) {
      markerAt += 1;
    }
    const marker = bytes[markerAt];
    if (marker === undefined || marker === JPEG_END_MARKER || marker === JPEG_SCAN_MARKER) {
      return { measured: false, defect: "image_header_unreadable" };
    }
    if (marker >= JPEG_STANDALONE_FIRST && marker <= JPEG_STANDALONE_LAST) {
      at = markerAt + 1;
      continue;
    }
    const length = readUint16(bytes, markerAt + 1);
    if (length === null || length < JPEG_LENGTH_BYTES) {
      return { measured: false, defect: "image_header_unreadable" };
    }
    const payloadAt = markerAt + 1 + JPEG_LENGTH_BYTES;
    const payloadBytes = length - JPEG_LENGTH_BYTES;
    const opensFrame =
      marker >= JPEG_FRAME_MARKER_FIRST &&
      marker <= JPEG_FRAME_MARKER_LAST &&
      !JPEG_NON_FRAME_MARKERS.has(marker);
    if (opensFrame) {
      if (payloadBytes < JPEG_FRAME_MIN_BYTES) {
        return { measured: false, defect: "image_header_unreadable" };
      }
      const heightPx = readUint16(bytes, payloadAt + JPEG_FRAME_HEIGHT_AT);
      const widthPx = readUint16(bytes, payloadAt + JPEG_FRAME_WIDTH_AT);
      if (heightPx === null || widthPx === null || heightPx === 0 || widthPx === 0) {
        return { measured: false, defect: "image_header_unreadable" };
      }
      return { measured: true, measurement: { format: "jpg", widthPx, heightPx, byteLength: bytes.length } };
    }
    at = payloadAt + payloadBytes;
  }
  return { measured: false, defect: "image_header_unreadable" };
}

/**
 * Measure an image from its own bytes.
 *
 * What the caller called the file is not consulted. The format comes from the
 * file's signature and the dimensions from its header, so a file that is not
 * what it was labelled, is animated, or is cut short is reported as the defect
 * it is rather than as a measurement that happens to parse.
 *
 * @param bytes The file's bytes.
 * @returns The format, the dimensions and the size, or the defect that stopped
 *   them being read.
 */
export function measureDecisionImage(bytes: Uint8Array): DecisionImageReading {
  if (opensWith(bytes, PNG_SIGNATURE)) {
    return readPngImage(bytes);
  }
  if (opensWith(bytes, JPEG_SIGNATURE)) {
    return readJpegImage(bytes);
  }
  return { measured: false, defect: "image_format_unknown" };
}

/**
 * Whether a value is one of the formats the contract accepts.
 *
 * A guard rather than a cast, so a caller's value is narrowed by being checked
 * and never by being asserted.
 *
 * @param value The value to test.
 * @returns True when it is one of the accepted format names.
 */
export function isDecisionImageFormat(value: unknown): value is DecisionImageFormat {
  return typeof value === "string" && (DECISION_IMAGE_FORMATS as readonly string[]).includes(value);
}

/**
 * Whether a declared format and a measured one describe the same thing.
 *
 * `jpeg` and `jpg` are two names for one format, so either declaration agrees
 * with a measured JPEG. Nothing else does.
 *
 * @param declared The format the caller stated.
 * @param measured The format the file's signature says it is.
 * @returns True when the two agree.
 */
export function formatsAgree(declared: DecisionImageFormat, measured: DecisionMeasuredFormat): boolean {
  return measured === "png" ? declared === "png" : declared === "jpg" || declared === "jpeg";
}
