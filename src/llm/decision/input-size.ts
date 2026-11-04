/**
 * What a decision request will cost its provider in INPUT TOKENS, estimated
 * before it is sent, and how far that estimate turned out to be wrong.
 *
 * The hosted vendor enforces two ceilings per second — one on requests and one
 * on input tokens — and refuses over either. The request ceiling can be held by
 * counting calls. The token ceiling cannot: two calls that are identical to a
 * call-counting guard can differ by three orders of magnitude in what the
 * vendor bills them, so holding the token ceiling means knowing a request's
 * size BEFORE it is dispatched. A count read from the response is a count of
 * tokens already billed.
 *
 * Nothing here is a tokenizer, and nothing here claims to be the vendor's own
 * count. Two measured anchors and one declared conversion stand in for it:
 *
 *  - An IMAGE is billed by its canvas and not by its file. A 25 KB chart and a
 *    4 KB blank at the same 1024x768 canvas were both billed 2632 input tokens,
 *    so an image's cost is taken as that measurement scaled by pixel count. The
 *    vendor publishes no formula, so this is an extrapolation from one canvas
 *    and is stated as one.
 *  - TEXT is converted from the UTF-8 bytes of the request as it is written,
 *    with the images' base64 payloads taken out, because those bytes are not
 *    billed as text. Bytes rather than characters, so a script outside ASCII
 *    costs what it weighs.
 *
 * An estimate of a quantity only the vendor measures must be checked against
 * the vendor, or it stops being an estimate and becomes an assumption: an
 * estimator nobody reconciles is how a guard silently stops guarding, and a
 * systematic under-estimate would leave its bucket holding a ceiling it had
 * drifted below. So every answered call compares what was debited with the
 * input count the vendor reported, and {@link decisionInputTokenDrift} is that
 * record. A call the vendor reported no count for is counted as unreported and
 * never as agreement.
 *
 * Where no estimate can be formed the reading says so. The caller's honest
 * move is then to refuse the call, not to send it: a provider that refuses over
 * a token ceiling cannot be paced by a client that declines to count, and
 * admitting on an unknown turns the guard off for exactly the requests whose
 * size nobody could establish.
 *
 * @module llm/decision/input-size
 */

import {
  decodeDecisionBase64,
  isStrictDecisionBase64,
  measureDecisionImage,
  normaliseDecisionBase64,
  utf8ByteLength,
} from "./assets";

import type { DecisionWireRequest } from "./types";

/**
 * Input tokens the vendor billed for one measured image.
 *
 * Measured, not published: the vendor states no way to estimate an image's
 * cost. A 25 KB chart and a 4 KB blank at {@link MEASURED_IMAGE_PIXELS} were
 * billed this same figure, which is what establishes that the count follows the
 * canvas rather than the file.
 */
const MEASURED_IMAGE_TOKENS = 2632;

/** The canvas {@link MEASURED_IMAGE_TOKENS} was measured at: 1024 x 768. */
const MEASURED_IMAGE_PIXELS = 1024 * 768;

/**
 * UTF-8 bytes charged as one input token of text.
 *
 * Deliberately below the four bytes per token this package uses to normalise
 * leg latencies, because the two numbers answer opposite questions. A latency
 * normaliser wants the typical case; a guard wants to err toward charging too
 * much, since the cost of over-charging is a call paced slightly slower and the
 * cost of under-charging is the ceiling breached. JSON is also denser in
 * punctuation than the prose that four-bytes-per-token describes.
 *
 * It is an estimate and not a bound: a tokenizer can emit a token per byte for
 * text it has never seen. {@link decisionInputTokenDrift} is what makes that
 * falsifiable rather than assumed.
 */
const BYTES_PER_TEXT_TOKEN = 3;

/**
 * Bytes of an image decoded to look for its canvas before the whole file is.
 *
 * An image's cost follows its canvas, which lives in a header near the front of
 * the file, so decoding the whole file to read it is work spent for nothing —
 * and it is work the ENCODER has already done once on the same bytes. Measured
 * on the contract's 16 MiB ceiling, that second full decode costs about 306 ms
 * of a hosted route's 1500 ms budget; on the traffic actually measured (a
 * 1024x768 PNG of about 25 KB) it costs about 2.5 ms. The bound exists for the
 * first case without changing the second.
 *
 * Correctness does not rest on the prefix being large enough. The header bytes
 * are the same bytes either way, so a canvas read from a prefix that contains
 * the header is identical to one read from the whole file, and a prefix that
 * does NOT contain it falls through to decoding the whole file. 64 KiB is well
 * past a PNG's header and past the metadata a JPEG usually carries before its
 * first frame, including an EXIF thumbnail.
 */
const CANVAS_PREFIX_BYTES = 64 * 1024;

/** Base64 characters per group, which decode to {@link BASE64_GROUP_BYTES} bytes. */
const BASE64_GROUP_CHARS = 4;

/** Bytes one base64 group carries. */
const BASE64_GROUP_BYTES = 3;

/** Why a request's input size could not be estimated. */
export type DecisionInputSizeDefect =
  /** The request could not be written as JSON, so its text could not be weighed. */
  | "body_unwritable"
  /** An image's canvas could not be read from its bytes, so its cost is unknown. */
  | "image_unreadable";

/** What a request will cost in input tokens, or why that could not be established. */
export type DecisionInputSizeReading =
  | {
      readonly estimated: true;
      /** The whole estimate: text plus images, in input tokens. */
      readonly inputTokens: number;
      /** The part of it that is text. */
      readonly textTokens: number;
      /** The part of it that is images. */
      readonly imageTokens: number;
      /** How many images were weighed. */
      readonly imageCount: number;
      /**
       * Image bytes decoded to reach the answer.
       *
       * The cost the estimate paid, and the only deterministic way to see that
       * the canvas was read from a header prefix rather than from the whole
       * file — a wall-clock threshold measures the machine, not the mechanism.
       * It is the decoded size, so a prefix read reports the prefix and a
       * fallback reports the file.
       */
      readonly imageBytesRead: number;
    }
  | { readonly estimated: false; readonly defect: DecisionInputSizeDefect };

/**
 * The canvas of one image, read from as few of its bytes as will say.
 *
 * A whole-group prefix of strict base64 is itself strict base64 and decodes to
 * exactly the file's leading bytes, so the prefix is read first and the whole
 * file only when the prefix did not carry the header. Only the canvas is
 * returned: a measurement taken from a prefix would carry that prefix's
 * `byteLength` and not the file's, and handing a caller a record with one true
 * field and one quietly wrong one is worse than handing it none.
 *
 * The format and animation rules are the ENCODER's and are not re-judged here.
 * This answers one question — how large is the canvas the vendor will bill —
 * about a request the encoder has already accepted.
 *
 * @param base64 The image as the wire carries it.
 * @returns The canvas, or `null` when no canvas could be read from the bytes.
 */
function canvasOf(
  base64: string,
): { readonly widthPx: number; readonly heightPx: number; readonly bytesRead: number } | null {
  let normalised: string;
  try {
    normalised = normaliseDecisionBase64(base64);
  } catch {
    return null;
  }
  const prefixChars = Math.ceil(CANVAS_PREFIX_BYTES / BASE64_GROUP_BYTES) * BASE64_GROUP_CHARS;
  if (normalised.length > prefixChars) {
    const prefix = normalised.slice(0, prefixChars);
    if (isStrictDecisionBase64(prefix)) {
      try {
        const bytes = decodeDecisionBase64(prefix);
        const reading = measureDecisionImage(bytes);
        if (reading.measured) {
          return {
            widthPx: reading.measurement.widthPx,
            heightPx: reading.measurement.heightPx,
            bytesRead: bytes.length,
          };
        }
      } catch {
        // The prefix said nothing. The whole file is read below, which is the
        // answer this was only ever trying to reach sooner.
      }
    }
  }
  try {
    const bytes = decodeDecisionBase64(normalised);
    const reading = measureDecisionImage(bytes);
    return reading.measured
      ? {
          widthPx: reading.measurement.widthPx,
          heightPx: reading.measurement.heightPx,
          bytesRead: bytes.length,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * The input tokens one image of a given canvas is taken to cost.
 *
 * Linear in pixel count through the one measured anchor, so the measured canvas
 * returns exactly the measured figure and every other canvas is an
 * extrapolation from it. Rounded up, because a fractional token is not a thing
 * a vendor bills and the guard belongs on the dearer side of the rounding.
 *
 * @param widthPx The canvas width.
 * @param heightPx The canvas height.
 * @returns The estimated input tokens.
 */
export function estimateImageInputTokens(widthPx: number, heightPx: number): number {
  return Math.ceil((widthPx * heightPx * MEASURED_IMAGE_TOKENS) / MEASURED_IMAGE_PIXELS);
}

/**
 * The text of a request as it is weighed: the body with each image's base64
 * payload replaced by nothing.
 *
 * The payload is excluded because it is not billed as text — the image it
 * encodes is billed by its canvas, and counting the base64 as well would
 * charge one image twice, the second time at about a third more than the file.
 * The rest of the `assets` entry stays, because the reference and the format
 * are text the request carries.
 *
 * @param body The request as it is sent.
 * @returns The JSON to weigh, or `null` when the body cannot be written.
 */
function textOfRequest(body: DecisionWireRequest): string | null {
  const { assets, ...rest } = body;
  const weighed =
    assets === undefined
      ? rest
      : {
          ...rest,
          assets: Object.fromEntries(
            Object.keys(assets).map((reference) => [
              reference,
              { type: assets[reference].type, format: assets[reference].format, data_base64: "" },
            ]),
          ),
        };
  try {
    const text: unknown = JSON.stringify(weighed);
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/**
 * Estimate what a request will cost in input tokens, before it is sent.
 *
 * Every image is measured from its own bytes rather than from anything the
 * request says about it, on the same ground the encoder measures them: a
 * declared canvas is a claim and a header is a fact. An image whose canvas
 * cannot be read makes the whole request unmeasurable, and the reading says so
 * rather than leaving that image out — an estimate silently missing one image
 * is the under-estimate most likely to breach the ceiling it was formed to
 * respect.
 *
 * @param body The request as it is sent.
 * @returns The estimate, or the defect that prevented one.
 */
export function estimateDecisionInputTokens(body: DecisionWireRequest): DecisionInputSizeReading {
  const text = textOfRequest(body);
  if (text === null) {
    return { estimated: false, defect: "body_unwritable" };
  }
  const textTokens = Math.ceil(utf8ByteLength(text) / BYTES_PER_TEXT_TOKEN);

  const assets = body.assets;
  if (assets === undefined) {
    return {
      estimated: true,
      inputTokens: textTokens,
      textTokens,
      imageTokens: 0,
      imageCount: 0,
      imageBytesRead: 0,
    };
  }
  const references = Object.keys(assets);
  let imageTokens = 0;
  let imageBytesRead = 0;
  for (const reference of references) {
    const canvas = canvasOf(assets[reference].data_base64);
    if (canvas === null) {
      return { estimated: false, defect: "image_unreadable" };
    }
    imageTokens += estimateImageInputTokens(canvas.widthPx, canvas.heightPx);
    imageBytesRead += canvas.bytesRead;
  }
  return {
    estimated: true,
    inputTokens: textTokens + imageTokens,
    textTokens,
    imageTokens,
    imageCount: references.length,
    imageBytesRead,
  };
}

/** How far this client's input-token estimates have fallen from the vendor's own counts. */
export interface DecisionInputTokenDrift {
  /** Answered calls whose estimate could be compared with a reported count. */
  readonly samples: number;
  /** Those calls' estimates, summed. */
  readonly estimatedTotal: number;
  /** The counts the vendor reported for them, summed. */
  readonly reportedTotal: number;
  /** How many of them the vendor billed MORE than was debited. */
  readonly underEstimates: number;
  /**
   * The worst ratio of reported to estimated seen, or `null` with no sample.
   *
   * Above one, the guard has been debiting less than the vendor billed, and its
   * bucket has been holding a looser ceiling than it declares by that factor.
   * It is the figure that decides whether {@link BYTES_PER_TEXT_TOKEN} and the
   * image anchor still describe this traffic.
   */
  readonly worstReportedOverEstimated: number | null;
  /**
   * Answered calls the vendor reported no usable input count for.
   *
   * Counted apart from {@link DecisionInputTokenDrift.samples} and never folded
   * into it: a call that cannot be compared is not a call whose estimate agreed,
   * and averaging it in as agreement is how a drift measure reports health it
   * never observed.
   */
  readonly unreported: number;
}

/** The running record, reset only by {@link resetDecisionInputTokenDrift}. */
let drift: DecisionInputTokenDrift = {
  samples: 0,
  estimatedTotal: 0,
  reportedTotal: 0,
  underEstimates: 0,
  worstReportedOverEstimated: null,
  unreported: 0,
};

/**
 * Record what one answered call was debited against what the vendor billed it.
 *
 * Called for every answered call that carried an estimate, whatever the vendor
 * reported, so an endpoint that stops reporting usage shows up as a rising
 * `unreported` rather than as a drift measure quietly standing still.
 *
 * @param estimated The input tokens debited before dispatch.
 * @param reported The input count the vendor reported, or `null` when it reported none.
 * @returns void
 */
export function recordDecisionInputTokenDrift(estimated: number, reported: number | null): void {
  if (reported === null || !Number.isFinite(reported) || reported < 0) {
    drift = { ...drift, unreported: drift.unreported + 1 };
    return;
  }
  // A zero estimate has no ratio to report, and a ratio against zero is not a
  // large drift but an undefined one, so the sample counts and the ratio does
  // not move.
  const ratio = estimated > 0 ? reported / estimated : null;
  const worst =
    ratio === null
      ? drift.worstReportedOverEstimated
      : drift.worstReportedOverEstimated === null
        ? ratio
        : Math.max(drift.worstReportedOverEstimated, ratio);
  drift = {
    samples: drift.samples + 1,
    estimatedTotal: drift.estimatedTotal + estimated,
    reportedTotal: drift.reportedTotal + reported,
    underEstimates: drift.underEstimates + (reported > estimated ? 1 : 0),
    worstReportedOverEstimated: worst,
    unreported: drift.unreported,
  };
}

/**
 * Read the drift record.
 *
 * @returns What has been recorded since the process started, or since the last reset.
 */
export function decisionInputTokenDrift(): DecisionInputTokenDrift {
  return drift;
}

/**
 * Discard the drift record.
 *
 * Exists so a test can start from a known position; the record is otherwise
 * carried between tests and makes their order matter.
 *
 * @returns void
 */
export function resetDecisionInputTokenDrift(): void {
  drift = {
    samples: 0,
    estimatedTotal: 0,
    reportedTotal: 0,
    underEstimates: 0,
    worstReportedOverEstimated: null,
    unreported: 0,
  };
}
