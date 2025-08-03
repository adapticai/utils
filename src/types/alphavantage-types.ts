// Use interface for AVNewsArticle as it's a complex object that might need extension
/**
 * Represents a news article from Alpha Vantage.
 * @interface AVNewsArticle
 * @property {string} title - The title of the news article.
 * @property {string} url - The URL to the full article.
 * @property {string} time_published - The publication time of the article.
 * @property {string[]} authors - The authors of the article.
 * @property {string} summary - A brief summary of the article.
 * @property {string} banner_image - The URL of the banner image for the article.
 * @property {string} source - The source of the news article.
 * @property {string|null} category_within_source - The category of the article within the source, or null if not applicable.
 * @property {string} source_domain - The domain of the source.
 * @property {{ topic: string, relevance_score: string }[]} topics - An array of topics related to the article, each with a relevance score.
 * @property {number} overall_sentiment_score - The overall sentiment score of the article.
 * @property {string} overall_sentiment_label - The label representing the overall sentiment (e.g., positive, negative).
 * @property {{ ticker: string, relevance_score: string, ticker_sentiment_score: string, ticker_sentiment_label: string }[]} ticker_sentiment - An array of ticker sentiment objects.
 */
export interface AVNewsArticle {
  title: string;
  url: string;
  time_published: string;
  authors: string[];
  summary: string;
  banner_image: string;
  source: string;
  category_within_source: string | null;
  source_domain: string;
  topics: {
    topic: string;
    relevance_score: string;
  }[];
  overall_sentiment_score: number;
  overall_sentiment_label: string;
  ticker_sentiment: {
    ticker: string;
    relevance_score: string;
    ticker_sentiment_score: string;
    ticker_sentiment_label: string;
  }[];
}

// Use interface for response types
/**
 * Represents the response structure for news articles from Alpha Vantage.
 * @interface AVNewsResponse
 * @property {number} items - The number of items in the response.
 * @property {string} sentiment_score_definition - Definition of the sentiment score.
 * @property {string} relevance_score_definition - Definition of the relevance score.
 * @property {AVNewsArticle[]} feed - An array of news articles.
 */
export interface AVNewsResponse {
  items: number;
  sentiment_score_definition: string;
  relevance_score_definition: string;
  feed: AVNewsArticle[];
}

// Use interface for API responses
/**
 * Represents the response structure for a quote from the Alpha Vantage API.
 * @interface AlphaVantageQuoteResponse
 * @property {{ '01. symbol': string, [key: string]: string }} Global Quote - The global quote information.
 */
export interface AlphaVantageQuoteResponse {
  'Global Quote': {
    '01. symbol': string;
    [key: string]: string;
  };
}
