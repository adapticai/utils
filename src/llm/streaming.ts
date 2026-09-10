/**
 * Streaming normalisation across provider wire formats.
 *
 * A caller that streams wants one thing — text as it arrives — but the wire
 * formats disagree about how to say it. OpenAI-compatible providers emit
 * server-sent events whose payload nests the increment under
 * `choices[0].delta.content` and end with a literal `[DONE]` sentinel;
 * Anthropic emits typed events where the increment is `delta.text` and the end
 * is an explicit `message_stop`. A consumer written against one shape breaks on
 * the other, which would make a fallback across providers fail precisely when
 * the fallback was needed.
 *
 * The one behaviour that matters more than the format is how a stream ENDS. A
 * stream cut short mid-answer looks exactly like a short answer: the consumer
 * has already received and probably already acted on the text. So a stream
 * that stops without its terminal event raises rather than returning what it
 * had — a truncated answer accepted as complete is a wrong answer that nothing
 * reports.
 *
 * @module llm/streaming
 */

/** SSE payload that marks the end of an OpenAI-compatible stream. */
const SSE_DONE_SENTINEL = "[DONE]";

/** Prefix carrying the payload on an SSE line. */
const SSE_DATA_PREFIX = "data:";

/** Anthropic event type carrying a text increment. */
const ANTHROPIC_DELTA_EVENT = "content_block_delta";

/** Anthropic event type marking the end of a message. */
const ANTHROPIC_STOP_EVENT = "message_stop";

/** Anthropic event type carrying a mid-stream error. */
const ANTHROPIC_ERROR_EVENT = "error";

/** One normalised chunk of a stream. */
export interface StreamChunk {
  /** Text produced since the previous chunk. Never null; an empty increment is skipped. */
  readonly delta: string;
  /** Cumulative text so far, so a consumer never has to accumulate it itself. */
  readonly text: string;
}

/**
 * Thrown when a stream ends without its terminal event.
 *
 * A distinct type because the caller's correct response differs from a normal
 * failure: the partial text exists and may be worth logging for diagnosis, but
 * it must never be treated as the answer.
 */
export class StreamTruncatedError extends Error {
  /** Text received before the stream stopped. Present for diagnosis only. */
  public readonly partialText: string;

  /**
   * @param partialText What had arrived when the stream stopped.
   * @param reason Why it stopped, when known.
   */
  public constructor(partialText: string, reason: string) {
    super(
      `LLM stream ended without a terminal event after ${partialText.length} characters: ${reason}. ` +
        "The partial text is not returned as an answer: a truncated answer accepted as complete is a wrong answer nothing reports.",
    );
    this.name = "StreamTruncatedError";
    this.partialText = partialText;
  }
}

/** Thrown when a provider reports an error inside an already-open stream. */
export class StreamProviderError extends Error {
  /** Text received before the error. */
  public readonly partialText: string;

  /**
   * @param partialText What had arrived when the error appeared.
   * @param detail The provider's message.
   */
  public constructor(partialText: string, detail: string) {
    super(`LLM stream failed mid-response: ${detail}`);
    this.name = "StreamProviderError";
    this.partialText = partialText;
  }
}

/**
 * Split a byte stream into complete lines.
 *
 * Chunk boundaries fall wherever the network puts them, not on line breaks, so
 * a partial line is carried across chunks. Parsing each network chunk as if it
 * were whole would drop or corrupt every event unlucky enough to be split.
 *
 * @param source The response body stream.
 * @returns An async iterable of complete lines.
 */
async function* toLines(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of source) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) {
    yield buffer;
  }
}

/**
 * Normalise an OpenAI-compatible SSE stream.
 *
 * @param source The response body stream.
 * @returns Normalised chunks.
 * @throws {StreamTruncatedError} When the stream ends without `[DONE]`.
 * @throws {StreamProviderError} When an error event appears mid-stream.
 */
export async function* normaliseOpenAiStream(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  let text = "";
  let sawDone = false;

  for await (const line of toLines(source)) {
    if (!line.startsWith(SSE_DATA_PREFIX)) {
      continue;
    }
    const payload = line.slice(SSE_DATA_PREFIX.length).trim();
    if (payload === SSE_DONE_SENTINEL) {
      sawDone = true;
      break;
    }
    if (payload.length === 0) {
      continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch (error) {
      throw new StreamProviderError(
        text,
        `unparseable event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (event.error !== undefined) {
      throw new StreamProviderError(text, JSON.stringify(event.error));
    }

    const choices = event.choices as { delta?: { content?: unknown } }[] | undefined;
    const delta = choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      text += delta;
      yield { delta, text };
    }
  }

  if (!sawDone) {
    throw new StreamTruncatedError(text, "no [DONE] sentinel was received");
  }
}

/**
 * Normalise an Anthropic event stream.
 *
 * @param source The response body stream.
 * @returns Normalised chunks.
 * @throws {StreamTruncatedError} When the stream ends without `message_stop`.
 * @throws {StreamProviderError} When an error event appears mid-stream.
 */
export async function* normaliseAnthropicStream(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  let text = "";
  let sawStop = false;

  for await (const line of toLines(source)) {
    if (!line.startsWith(SSE_DATA_PREFIX)) {
      continue;
    }
    const payload = line.slice(SSE_DATA_PREFIX.length).trim();
    if (payload.length === 0) {
      continue;
    }

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch (error) {
      throw new StreamProviderError(
        text,
        `unparseable event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const type = event.type;
    if (type === ANTHROPIC_ERROR_EVENT) {
      throw new StreamProviderError(text, JSON.stringify(event.error ?? event));
    }
    if (type === ANTHROPIC_STOP_EVENT) {
      sawStop = true;
      break;
    }
    if (type === ANTHROPIC_DELTA_EVENT) {
      const delta = (event.delta as { text?: unknown } | undefined)?.text;
      if (typeof delta === "string" && delta.length > 0) {
        text += delta;
        yield { delta, text };
      }
    }
  }

  if (!sawStop) {
    throw new StreamTruncatedError(text, "no message_stop event was received");
  }
}

/**
 * Normalise a stream according to the wire format its provider speaks.
 *
 * Selecting on the route's declared API style rather than sniffing the payload
 * keeps the decision with the route table, which is the thing that actually
 * knows which provider is answering.
 *
 * @param apiStyle The provider's wire format.
 * @param source The response body stream.
 * @returns Normalised chunks, identical in shape across providers.
 */
export function normaliseStream(
  apiStyle: "openai-compatible" | "anthropic",
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  return apiStyle === "anthropic"
    ? normaliseAnthropicStream(source)
    : normaliseOpenAiStream(source);
}

/**
 * Drain a normalised stream into its complete text.
 *
 * @param stream A normalised stream.
 * @returns The full text.
 * @throws Whatever the stream raises; a truncated stream never resolves to text.
 */
export async function collectStream(
  stream: AsyncIterable<StreamChunk>,
): Promise<string> {
  let text = "";
  for await (const chunk of stream) {
    text = chunk.text;
  }
  return text;
}
