import { z } from "zod";
import { LlmProvider } from "../enums";

/** Schema for a single entry in an LLM fallback chain. */
const FallbackChainEntrySchema = z.object({
  provider: z.nativeEnum(LlmProvider),
  modelId: z.string(),
});

/** Schema for tool use permissions granted to a specific model tier. */
const ToolUsePermissionsSchema = z.object({
  readTools: z.boolean().default(true),
  writeTools: z.boolean().default(false),
});

/**
 * Model preferences schema (section 7.9).
 * Governs LLM provider fallback chains, escalation triggers, cost limits,
 * latency targets, tool permissions by tier, and memory retention settings.
 *
 * The raw ZodObject variant (`ModelPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const ModelPrefsObjectSchema = z.object({
  miniFallbackChain: z.array(FallbackChainEntrySchema).default([]),
  normalFallbackChain: z.array(FallbackChainEntrySchema).default([]),
  advancedFallbackChain: z.array(FallbackChainEntrySchema).default([]),
  escalateToAdvancedWhenConflicts: z.boolean().default(true),
  escalateToAdvancedWhenHighExposure: z.boolean().default(true),
  highExposureThresholdPct: z.number().min(0).max(100).default(50),
  escalateToAdvancedWhenMultipleOrders: z.boolean().default(true),
  multipleOrdersThreshold: z.number().min(0).default(3),
  maxCostPerDayUsd: z.number().min(0).default(10),
  maxCostPerDecisionUsd: z.number().min(0).default(1),
  latencyTargetMs: z.number().min(0).default(5000),
  timeoutMs: z.number().min(0).default(30000),
  maxRetries: z.number().min(0).default(2),
  toolUsePermissionsByTier: z
    .record(z.string(), ToolUsePermissionsSchema)
    .default({
      mini: { readTools: true, writeTools: false },
      normal: { readTools: true, writeTools: false },
      advanced: { readTools: true, writeTools: true },
    }),
  memorySummaryCadenceMinutes: z.number().min(0).default(60),
  maxMemorySummariesRetained: z.number().min(0).default(50),
  excludedProvidersForWorkflows: z
    .record(z.string(), z.array(z.string()))
    .default({}),
  quantModelWeight: z.number().min(0).max(1).default(0.7),
});

export const ModelPrefsSchema = ModelPrefsObjectSchema.default({});

/** Inferred TypeScript type for model preferences. */
export type ModelPrefs = z.infer<typeof ModelPrefsSchema>;
