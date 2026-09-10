/**
 * Wire-format stream builders for the streaming normalisation tests.
 *
 * The normaliser's hardest requirement is that a chunk boundary is not a
 * message boundary: the network splits bytes wherever it likes, including
 * inside a JSON payload. These builders therefore emit the wire text and let a
 * test choose the byte-chunking independently, so the same logical stream can
 * be replayed whole, split per line, or split every few bytes.
 *
 * @module __tests__/llm/client/support/streams
 */

/** Sentinel closing an OpenAI-compatible server-sent event stream. */
export const SSE_DONE_LINE = "data: [DONE]";

/**
 * Render an OpenAI-compatible SSE body.
 *
 * @param deltas Text increments, in order.
 * @param options Rendering options.
 * @param options.terminate Emit the `[DONE]` sentinel. Omitting it models a truncated stream.
 * @param options.errorAfter Emit a provider error event after this many deltas.
 * @returns The wire text.
 */
export function openAiSseBody(
  deltas: readonly string[],
  options: { readonly terminate?: boolean; readonly errorAfter?: number } = {},
): string {
  const lines: string[] = [];
  deltas.forEach((delta, index) => {
    lines.push(
      `data: ${JSON.stringify({
        id: "chatcmpl-test",
        choices: [{ index: 0, delta: { content: delta } }],
      })}`,
      "",
    );
    if (options.errorAfter !== undefined && index + 1 === options.errorAfter) {
      lines.push(
        `data: ${JSON.stringify({ error: { message: "upstream overloaded", type: "server_error" } })}`,
        "",
      );
    }
  });
  if (options.terminate !== false) {
    lines.push(SSE_DONE_LINE, "");
  }
  return lines.join("\n");
}

/**
 * Render an Anthropic event-stream body.
 *
 * Each event carries both the `event:` line a real stream sends and the `data:`
 * line the normaliser reads, so the test proves the normaliser ignores the
 * former rather than merely never meeting it.
 *
 * @param deltas Text increments, in order.
 * @param options Rendering options.
 * @param options.terminate Emit `message_stop`. Omitting it models a truncated stream.
 * @param options.errorAfter Emit a provider error event after this many deltas.
 * @returns The wire text.
 */
export function anthropicSseBody(
  deltas: readonly string[],
  options: { readonly terminate?: boolean; readonly errorAfter?: number } = {},
): string {
  const lines: string[] = [
    "event: message_start",
    `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_test" } })}`,
    "",
  ];
  deltas.forEach((delta, index) => {
    lines.push(
      "event: content_block_delta",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: delta },
      })}`,
      "",
    );
    if (options.errorAfter !== undefined && index + 1 === options.errorAfter) {
      lines.push(
        "event: error",
        `data: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "upstream overloaded" } })}`,
        "",
      );
    }
  });
  if (options.terminate !== false) {
    lines.push("event: message_stop", `data: ${JSON.stringify({ type: "message_stop" })}`, "");
  }
  return lines.join("\n");
}

/**
 * Split text into fixed-size pieces.
 *
 * Sized in characters rather than lines so a piece can land inside a JSON
 * payload, which is the boundary case a line-oriented parser gets wrong.
 *
 * @param text The wire text.
 * @param size Characters per piece.
 * @returns The pieces, in order.
 */
export function splitEvery(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    pieces.push(text.slice(offset, offset + size));
  }
  return pieces;
}

/**
 * Present pieces of wire text as the byte stream a response body would be.
 *
 * @param pieces The pieces, in order.
 * @returns An async iterable of encoded chunks.
 */
export function byteStream(pieces: readonly string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      for (const piece of pieces) {
        yield encoder.encode(piece);
      }
    },
  };
}

/**
 * Present wire text as a byte stream chopped at fixed BYTE offsets.
 *
 * Chopping the encoded bytes rather than the string is what puts a boundary
 * inside a multi-byte character as well as inside a JSON payload, which is the
 * case an incremental decoder exists for.
 *
 * @param text The wire text.
 * @param size Bytes per chunk.
 * @returns An async iterable of encoded chunks.
 */
export function byteStreamSplitEvery(
  text: string,
  size: number,
): AsyncIterable<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      for (let offset = 0; offset < encoded.length; offset += size) {
        yield encoded.slice(offset, offset + size);
      }
    },
  };
}
