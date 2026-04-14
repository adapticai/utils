import { z } from "zod";

const DirectionSchema = z.enum(["long_only", "long_short", "market_neutral"]);

/**
 * Asset universe preferences schema (section 7.2).
 * Defines which instruments, exchanges, sectors, and market segments
 * the account is permitted to trade, along with liquidity and eligibility filters.
 *
 * The raw ZodObject variant (`AssetUniversePrefsObjectSchema`) is exported
 * for use with `deepPartial()`, which requires a ZodObject (not ZodDefault).
 */
export const AssetUniversePrefsObjectSchema = z.object({
  equitiesDirection: DirectionSchema.default("long_only"),
  etfsDirection: z.enum(["long_only", "long_short"]).default("long_only"),
  cryptoDirection: z.enum(["long_only", "long_short"]).default("long_only"),
  optionsDirection: z.enum(["long_only", "long_short"]).default("long_only"),
  allowedExchanges: z.array(z.string()).default([]),
  deniedExchanges: z.array(z.string()).default([]),
  allowedCountries: z.array(z.string()).default([]),
  deniedCountries: z.array(z.string()).default([]),
  allowedSectors: z.array(z.string()).default([]),
  deniedSectors: z.array(z.string()).default([]),
  allowedSymbols: z.array(z.string()).default([]),
  deniedSymbols: z.array(z.string()).default([]),
  cryptoSpotOnly: z.boolean().default(true),
  allowedCryptoPairs: z.array(z.string()).default([]),
  deniedCryptoPairs: z.array(z.string()).default([]),
  minMarketCapMillions: z.number().min(0).default(0),
  minAvgDailyVolume: z.number().min(0).default(0),
  minPrice: z.number().min(0).default(0),
  maxPrice: z.number().min(0).default(0),
  maxSpreadPct: z.number().min(0).default(0),
  minLiquidityScore: z.number().min(0).max(100).default(0),
  leveragedEtfsEnabled: z.boolean().default(false),
  inverseEtfsEnabled: z.boolean().default(false),
  memeStocksEnabled: z.boolean().default(false),
  ipoParticipationEnabled: z.boolean().default(false),
  borrowAvailabilityRequired: z.boolean().default(true),
  maxBorrowFeePct: z.number().min(0).default(5),
});

export const AssetUniversePrefsSchema = AssetUniversePrefsObjectSchema.default(
  {},
);

/** Inferred TypeScript type for asset universe preferences. */
export type AssetUniversePrefs = z.infer<typeof AssetUniversePrefsSchema>;
