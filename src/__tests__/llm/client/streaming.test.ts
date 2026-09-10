import { describe, expect, it } from "vitest";

import {
  StreamProviderError,
  StreamTruncatedError,
  collectStream,
  normaliseStream,
} from "../../../llm/streaming";
import type { StreamChunk } from "../../../llm/streaming";
import { rejection } from "./support/rejections";
import {
  anthropicSseBody,
  byteStream,
  byteStreamSplitEvery,
  openAiSseBody,
  splitEvery,
} from "./support/streams";

/** The same logical answer, expressed by both providers. */
const DELTAS: readonly string[] = ["The ", "position ", "is flat — café ✓"];

/** The answer those increments spell out. */
const FULL_TEXT = DELTAS.join("");

/** A chunk size small enough to land inside a JSON payload and a multi-byte character. */
const TINY_CHUNK_BYTES = 7;

/** Deltas emitted before a provider error interrupts the stream. */
const DELTAS_BEFORE_ERROR = 1;

/**
 * Drain a normalised stream into its chunks.
 *
 * @param stream The normalised stream.
 * @returns Every chunk it yielded, in order.
 */
async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("stream normalisation across wire formats", () => {
  it("produces identical chunk sequences from both wire formats", async () => {
    const fromOpenAi = await drain(
      normaliseStream("openai-compatible", byteStream([openAiSseBody(DELTAS)])),
    );
    const fromAnthropic = await drain(
      normaliseStream("anthropic", byteStream([anthropicSseBody(DELTAS)])),
    );

    // A consumer written against one shape would break on the other, which
    // would make a cross-provider fallback fail exactly when it was needed.
    expect(fromOpenAi).toEqual(fromAnthropic);
    expect(fromOpenAi.map((chunk) => chunk.delta)).toEqual([...DELTAS]);
    expect(fromOpenAi[fromOpenAi.length - 1].text).toBe(FULL_TEXT);
  });

  it("parses a stream whose chunks break inside a payload", async () => {
    const openAi = await drain(
      normaliseStream(
        "openai-compatible",
        byteStreamSplitEvery(openAiSseBody(DELTAS), TINY_CHUNK_BYTES),
      ),
    );
    const anthropic = await drain(
      normaliseStream(
        "anthropic",
        byteStreamSplitEvery(anthropicSseBody(DELTAS), TINY_CHUNK_BYTES),
      ),
    );

    expect(openAi.map((chunk) => chunk.delta)).toEqual([...DELTAS]);
    expect(anthropic.map((chunk) => chunk.delta)).toEqual([...DELTAS]);
    expect(openAi[openAi.length - 1].text).toBe(FULL_TEXT);
  });

  it("parses a stream delivered one line fragment at a time", async () => {
    const chunks = await drain(
      normaliseStream(
        "openai-compatible",
        byteStream(splitEvery(openAiSseBody(DELTAS), TINY_CHUNK_BYTES)),
      ),
    );

    expect(chunks[chunks.length - 1].text).toBe(FULL_TEXT);
  });

  it("raises rather than returning the partial text when a stream is cut short", async () => {
    const truncated = openAiSseBody(DELTAS, { terminate: false });

    const attempt = drain(normaliseStream("openai-compatible", byteStream([truncated])));
    await expect(attempt).rejects.toBeInstanceOf(StreamTruncatedError);

    const error = await rejection(attempt, StreamTruncatedError);
    // The partial text is available for diagnosis and must never be the answer:
    // a truncated answer accepted as complete is a wrong answer nothing reports.
    expect(error.partialText).toBe(FULL_TEXT);
    expect(error.message).toContain("[DONE]");
  });

  it("raises when an Anthropic stream ends without message_stop", async () => {
    const attempt = drain(
      normaliseStream("anthropic", byteStream([anthropicSseBody(DELTAS, { terminate: false })])),
    );

    await expect(attempt).rejects.toBeInstanceOf(StreamTruncatedError);
    await expect(attempt).rejects.toThrow(/message_stop/);
  });

  it("raises on a provider error inside an already-open stream", async () => {
    const openAiAttempt = drain(
      normaliseStream(
        "openai-compatible",
        byteStream([openAiSseBody(DELTAS, { errorAfter: DELTAS_BEFORE_ERROR })]),
      ),
    );
    await expect(openAiAttempt).rejects.toBeInstanceOf(StreamProviderError);
    await expect(openAiAttempt).rejects.toThrow(/upstream overloaded/);

    const anthropicAttempt = drain(
      normaliseStream(
        "anthropic",
        byteStream([anthropicSseBody(DELTAS, { errorAfter: DELTAS_BEFORE_ERROR })]),
      ),
    );
    await expect(anthropicAttempt).rejects.toBeInstanceOf(StreamProviderError);
    await expect(anthropicAttempt).rejects.toThrow(/upstream overloaded/);
  });

  it("collects the full text of a well-formed stream", async () => {
    expect(
      await collectStream(
        normaliseStream("openai-compatible", byteStream([openAiSseBody(DELTAS)])),
      ),
    ).toBe(FULL_TEXT);
    expect(
      await collectStream(normaliseStream("anthropic", byteStream([anthropicSseBody(DELTAS)]))),
    ).toBe(FULL_TEXT);
  });
});
