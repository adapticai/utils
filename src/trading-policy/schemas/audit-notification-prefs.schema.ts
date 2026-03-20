import { z } from 'zod';

/**
 * Audit and notification preferences schema (section 7.10).
 * Controls notification triggers, audit detail levels, artifact retention,
 * incident alert channels, and decision trace persistence.
 *
 * The raw ZodObject variant (`AuditNotificationPrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const AuditNotificationPrefsObjectSchema = z.object({
  notifyOnAutonomousActions: z.boolean().default(true),
  notifyOnBlockedTrades: z.boolean().default(true),
  notifyOnOverlayActivation: z.boolean().default(true),
  notifyOnPolicyMutation: z.boolean().default(true),
  dailySummaryEnabled: z.boolean().default(true),
  eventSummaryEnabled: z.boolean().default(true),
  auditDetailLevel: z.enum(['minimal', 'standard', 'verbose']).default('standard'),
  saveRationaleSummaries: z.boolean().default(true),
  saveToolCallTraces: z.boolean().default(false),
  saveContextSnapshots: z.boolean().default(true),
  incidentAlertChannel: z.enum(['email', 'slack', 'discord', 'webhook', 'none']).default('none'),
  incidentAlertEndpoint: z.string().default(''),
  requirePostActionExplanation: z.boolean().default(true),
  retainDecisionArtifactsDays: z.number().min(0).default(90),
});

export const AuditNotificationPrefsSchema = AuditNotificationPrefsObjectSchema.default({});

/** Inferred TypeScript type for audit and notification preferences. */
export type AuditNotificationPrefs = z.infer<typeof AuditNotificationPrefsSchema>;
