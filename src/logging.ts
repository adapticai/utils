import { DisplayManager } from "./display-manager";
import { getLogger, isLoggerInjected } from "./logger";
import { LogOptions, LogType } from "./types/logging-types";

/**
 * LogType values that should map to a `Logger.info()` call when routed
 * through an injected structured logger. Anything not in this set is
 * treated as `info` (the safe default for unknown levels).
 */
const INFO_LEVEL_TYPES: ReadonlySet<LogType> = new Set([
  "info",
  "major",
  "table",
  "system",
  "cost",
]);

/**
 * Builds the structured-logger context object for an injected logger call.
 *
 * The injected logger is expected to be a Pino-style structured logger
 * (the engine wires it via `setUtilsLogger({...})` from
 * `service-initializer.ts`). We surface every meaningful field from
 * `LogOptions` so downstream consumers can filter, query, and correlate.
 */
function buildLoggerContext(
  options: LogOptions,
): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  if (options.source) context.source = options.source;
  if (options.account) context.account = options.account;
  if (options.symbol) context.symbol = options.symbol;
  if (options.type) context.logType = options.type;
  if (options.metadata) Object.assign(context, options.metadata);
  return context;
}

/**
 * Logs a message.
 *
 * **Routing strategy:**
 * 1. If a structured logger has been injected via `setLogger()` (the engine
 *    does this on startup with a Pino child logger), route the message
 *    through that logger so it joins the centralised logging pipeline with
 *    full structure, source attribution, correlation IDs, and downstream
 *    aggregation.
 * 2. Otherwise (standalone CLI usage of `@adaptic/utils`), fall back to the
 *    legacy `DisplayManager`, which writes directly to `process.stdout` with
 *    ANSI colours, prompt preservation, and optional symbol-specific log
 *    files. This preserves backward compatibility for scripts.
 *
 * Without this routing, every Alpaca client call (positions, orders,
 * streams, market-data, crypto, options — 28 modules) would silently
 * bypass the host application's structured logger and emit unstructured
 * lines straight to stdout, producing a long-running observability gap
 * in production deployments.
 *
 * @param message The message to log.
 * @param options Optional options.
 * @param options.source The source of the message.
 * @param options.type The type of message to log.
 * @param options.symbol The trading symbol associated with this log.
 * @param options.logToFile Force logging to a file even when no symbol is provided.
 * @param options.account Optional account identifier surfaced in logs.
 * @param options.metadata Additional structured fields to merge into context.
 */
export function log(
  message: string,
  options: LogOptions = { source: "Server", type: "info" },
): void {
  if (isLoggerInjected()) {
    const logger = getLogger();
    const context = buildLoggerContext(options);
    const type = options.type ?? "info";

    if (type === "error") {
      logger.error(message, context);
    } else if (type === "warn") {
      logger.warn(message, context);
    } else if (type === "debug") {
      logger.debug(message, context);
    } else if (INFO_LEVEL_TYPES.has(type)) {
      logger.info(message, context);
    } else {
      logger.info(message, context);
    }
    return;
  }

  // Fallback: standalone CLI / no host logger wired in.
  const displayManager = DisplayManager.getInstance();
  displayManager.log(message, options);
}
