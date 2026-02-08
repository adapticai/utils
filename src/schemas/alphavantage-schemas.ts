/**
 * Zod schemas for Alpha Vantage API response validation.
 * Validates API responses against expected shapes to catch breaking API changes early.
 */
import { z } from 'zod';

// ===== Quote Schemas =====

/** Schema for Alpha Vantage Global Quote response */
export const AlphaVantageQuoteResponseSchema = z.object({
  'Global Quote': z.object({
    '01. symbol': z.string(),
  }).catchall(z.string()),
});

// ===== News Schemas =====

/** Schema for a single topic in a news article */
const AVTopicSchema = z.object({
  topic: z.string(),
  relevance_score: z.string(),
});

/** Schema for ticker sentiment in a news article */
const AVTickerSentimentSchema = z.object({
  ticker: z.string(),
  relevance_score: z.string(),
  ticker_sentiment_score: z.string(),
  ticker_sentiment_label: z.string(),
});

/** Schema for a single Alpha Vantage news article */
export const AVNewsArticleSchema = z.object({
  title: z.string(),
  url: z.string(),
  time_published: z.string(),
  authors: z.array(z.string()),
  summary: z.string(),
  banner_image: z.string(),
  source: z.string(),
  category_within_source: z.string().nullable(),
  source_domain: z.string(),
  topics: z.array(AVTopicSchema),
  overall_sentiment_score: z.number(),
  overall_sentiment_label: z.string(),
  ticker_sentiment: z.array(AVTickerSentimentSchema),
});

/** Schema for Alpha Vantage news response */
export const AVNewsResponseSchema = z.object({
  items: z.union([z.number(), z.string()]),
  sentiment_score_definition: z.string(),
  relevance_score_definition: z.string(),
  feed: z.array(AVNewsArticleSchema),
});
