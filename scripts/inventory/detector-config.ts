/**
 * Declarative detector tables for the LLM inventory scan.
 *
 * Everything the scanner recognises is data in this module, never a literal
 * buried in traversal code. A detection rule that lives in a table can be
 * reviewed, diffed, and extended by whoever adds a provider; one buried in an
 * `if` can only be found by reading the whole walker.
 *
 * @module scripts/inventory/detector-config
 */

import type { DetectorConfig } from "./types";

/**
 * Module specifiers whose import means the file talks to a vendor SDK directly.
 *
 * Matched as exact specifier or as a subpath (`openai/resources/chat`), because
 * a deep import is the same coupling as a root import.
 */
export const VENDOR_SDK_MODULES: readonly string[] = [
  "openai",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@mistralai/mistralai",
];

/** The shared client package whose LLM surface the migration re-points. */
export const LUMIC_MODULE = "@adaptic/lumic-utils";

/**
 * Symbols exported by {@link LUMIC_MODULE} that constitute its LLM surface.
 *
 * An import of any of these is a call site for migration purposes even when it
 * is type-only: the W4 codemods must re-point every binding that names a model,
 * a provider, or a call, and a type import names the same contract a value
 * import does.
 */
export const LUMIC_LLM_ENTRY_SYMBOLS: readonly string[] = [
  "lumic",
  "makeLLMCall",
  "makeResponsesCall",
  "makeAnthropicCall",
  "makeOpenAICompatibleCall",
  "makeDeepseekCall",
  "makeImagesCall",
  "makeOpenAIChatCompletionCall",
  "makeResponsesAPICall",
  "createCompletion",
  "fixJsonWithAI",
  "SUPPORTED_MODELS",
  "MODEL_ALIASES",
  "isValidModel",
  "getModelProvider",
  "getModelCapabilities",
  "OPENAI_COMPATIBLE_PROVIDERS",
  "PROVIDER_DEFAULT_MODELS",
  "LLM_DEFAULT_PROVIDER",
  "LLM_MINI_PROVIDER",
  "LLM_NORMAL_PROVIDER",
  "LLM_ADVANCED_PROVIDER",
  "LLM_PROVIDER",
  "LLM_MODEL_MINI",
  "LLM_MODEL_NORMAL",
  "LLM_MODEL_ADVANCED",
  "LLMOptions",
  "LLMResponse",
  "LLMUsage",
  "LLMModel",
  "LLMProvider",
  "SupportedModel",
  "OpenAIModel",
  "AnthropicModel",
  "DeepseekModel",
  "KimiModel",
  "QwenModel",
  "XAIModel",
  "GeminiModel",
  "ModelCapabilities",
  "OpenAIResponseFormat",
  "OpenAICompatibleProviderConfig",
];

/**
 * First-party wrappers that reach a model on behalf of their callers.
 *
 * Importing or invoking one of these is as much a call site as touching the
 * SDK: the wrapper is where the model, the timeout, and the retry policy are
 * chosen, so the migration has to account for each caller of it.
 */
export const WRAPPER_SYMBOLS: readonly string[] = [
  "callLLMWithValidation",
  "dispatchValidatedLlmCall",
  "callLLMWithCaching",
  "callLLMWithTools",
  "runBoundedAbortableLlmCall",
];

/**
 * Every symbol whose presence as an imported or re-exported binding marks LLM surface.
 *
 * A binding named for an LLM entry point is LLM surface wherever it comes from:
 * the shared package re-exports its own call functions through relative paths,
 * and the engine re-exports its wrappers the same way. Matching on the binding
 * name rather than on the module specifier keeps those assembly points inside
 * the inventory instead of leaving a hole exactly where the surface is wired
 * together.
 */
export const LLM_SURFACE_SYMBOLS: readonly string[] = [
  ...LUMIC_LLM_ENTRY_SYMBOLS,
  ...WRAPPER_SYMBOLS,
];

/** Callee expressions (dotted paths accepted) that issue a model call. */
export const LLM_CALL_EXPRESSIONS: readonly string[] = [
  "lumic.llm.call",
  "lumic.llm.callResponses",
  "lumic.llm.images",
  ...LUMIC_LLM_ENTRY_SYMBOLS.filter((symbol) => symbol.startsWith("make")),
  "createCompletion",
  "fixJsonWithAI",
  ...WRAPPER_SYMBOLS,
];

/**
 * Trailing segments that mark a hyphenated identifier as a software role, not a model.
 *
 * The model-family patterns are deliberately permissive so no real model id can
 * slip past them, which lets a service tag like `gpt-analysis-service` or a
 * checklist id like `claude-compliance` in as well. No vendor names a model
 * after a software role, so rejecting these segments removes the noise without
 * putting any real model at risk of being missed.
 */
export const NON_MODEL_TRAILING_SEGMENTS: readonly string[] = [
  "adapter",
  "analysis",
  "client",
  "compliance",
  "error",
  "factory",
  "handler",
  "manager",
  "provider",
  "registry",
  "service",
  "wrapper",
];

/**
 * The subset of {@link LLM_CALL_EXPRESSIONS} that names a bare function or method.
 *
 * These are matched on the method name alone, so a call reached through an
 * injected collaborator counts as the call site it is. Dotted entries are
 * excluded: matching a trailing `.call` on any receiver would sweep in every
 * `Function.prototype.call` in the estate.
 */
export const UNQUALIFIED_LLM_CALL_NAMES: readonly string[] =
  LLM_CALL_EXPRESSIONS.filter((expression) => !expression.includes("."));

/** Constructor names whose instantiation opens a direct vendor client. */
export const SDK_CONSTRUCTORS: readonly string[] = [
  "OpenAI",
  "Anthropic",
  "GoogleGenerativeAI",
  "Mistral",
];

/**
 * Vendor model-string families, as anchored regular expressions.
 *
 * Anchored end-to-end against the whole string literal so that prose mentioning
 * a model in a comment-like string does not register, and so that a partial
 * match inside an unrelated identifier cannot masquerade as a model id.
 */
export const MODEL_LITERAL_PATTERNS: readonly RegExp[] = [
  /^gpt-oss-[a-z0-9._-]+$/i,
  /^gpt-[a-z0-9._-]+$/i,
  /^claude-[a-z0-9._-]+$/i,
  /^o1(?:-[a-z0-9._-]+)?$/i,
  /^o3(?:-[a-z0-9._-]+)?$/i,
  /^o4-mini(?:-[a-z0-9._-]+)?$/i,
  /^deepseek-[a-z0-9._-]+$/i,
  /^grok-[a-z0-9._-]+$/i,
  /^gemini-[a-z0-9._-]+$/i,
  /^kimi-[a-z0-9._-]+$/i,
  /^qwen[a-z0-9._-]*$/i,
  /^glm-[a-z0-9._-]+$/i,
];

/**
 * Provider key environment variables that are always in scope.
 *
 * The route table is the primary source (every `api_key_env` it declares); this
 * list adds the vendors whose keys exist in the estate but which the route
 * table does not yet name, so a key in use before its route is authored is
 * still discovered.
 */
export const BASELINE_PROVIDER_KEY_ENV_VARS: readonly string[] = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "KIMI_API_KEY",
  "QWEN_API_KEY",
  "XAI_API_KEY",
  "GEMINI_API_KEY",
];

/** Property names whose `tools`-shaped presence proves tool use. */
export const TOOL_USE_MARKERS: readonly string[] = [
  "tools",
  "tool_choice",
  "toolChoice",
  "tool_calls",
  "toolCalls",
  "ChatCompletionTool",
];

/** Markers proving a JSON-schema-constrained response format. */
export const JSON_SCHEMA_MARKERS: readonly string[] = [
  "json_schema",
  "jsonSchema",
  "response_format",
  "responseFormat",
];

/** Markers proving the site streams tokens. */
export const STREAMING_MARKERS: readonly string[] = [
  "stream",
  "streaming",
  "createStream",
];

/**
 * Markers proving the site consumes a vendor-shaped stream envelope.
 *
 * A normalised stream is portable; a loop that reads `content_block_delta` or
 * `choices[0].delta` is written against one vendor's wire format and must be
 * re-expressed by an adapter before another provider can serve it.
 */
export const PROVIDER_STREAMING_MARKERS: readonly string[] = [
  "content_block_delta",
  "content_block_start",
  "message_delta",
  "toReadableStream",
  "chatCompletionStream",
  "ChatCompletionChunk",
  "MessageStreamEvent",
];

/** Markers proving image content parts reach the provider. */
export const VISION_MARKERS: readonly string[] = [
  "image_url",
  "imageUrl",
  "input_image",
  "ChatCompletionContentPartImage",
  "ImageBlockParam",
];

/** Markers proving provider prompt-cache intent. */
export const CACHE_CONTROL_MARKERS: readonly string[] = [
  "cache_control",
  "cacheControl",
  "cacheBreakpoints",
  "promptCacheKey",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
];

/** Property name marking a strict, schema-enforced response format. */
export const STRICT_MARKER = "strict";

/** Property names that declare a context-window size in tokens. */
export const CONTEXT_WINDOW_PROPERTY_NAMES: readonly string[] = [
  "context_window",
  "contextWindow",
  "max_context_tokens",
  "maxContextTokens",
  "max_input_tokens",
  "maxInputTokens",
  "contextLength",
  "context_length",
];

/**
 * Context size above which a site cannot be served portably.
 *
 * 256K tokens is the Section-3 threshold; expressed here as its exact binary
 * value so the comparison is a constant rather than a magic number at the
 * comparison site.
 */
export const CONTEXT_WINDOW_ADAPTER_THRESHOLD_TOKENS = 262144;

/**
 * Compose the run-time detector config from the route table.
 *
 * The key names and alias names are taken from `alias-routes.json` rather than
 * duplicated here, so adding a provider to the route table extends the scan
 * automatically and the two can never disagree.
 *
 * @param routeApiKeyEnvVars - Every `api_key_env` declared by the route table.
 * @param routeAliasNames - Every alias name declared by the route table.
 * @returns A detector config with both lists deduplicated and sorted.
 */
export function buildDetectorConfig(
  routeApiKeyEnvVars: readonly string[],
  routeAliasNames: readonly string[],
): DetectorConfig {
  const keys = new Set<string>([
    ...BASELINE_PROVIDER_KEY_ENV_VARS,
    ...routeApiKeyEnvVars,
  ]);
  return {
    providerKeyEnvVars: [...keys].sort(),
    aliasNames: [...new Set(routeAliasNames)].sort(),
  };
}
