/**
 * News Module
 * Market news and analysis using Alpaca SDK
 */
import { AlpacaClient } from '../client';
import { AlpacaNewsArticle, SimpleNews, NewsResponse } from '../../types/alpaca-types';
import { log as baseLog } from '../../logging';
import { LogOptions } from '../../types/logging-types';

const log = (message: string, options: LogOptions = { type: 'info' }) => {
  baseLog(message, { ...options, source: 'AlpacaNews' });
};

/**
 * Error thrown when news operations fail
 */
export class NewsError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'NewsError';
  }
}

/**
 * Parameters for fetching news
 */
export interface GetNewsParams {
  /** Symbols to filter news by */
  symbols?: string[];
  /** Start date/time for the news range */
  start?: Date;
  /** End date/time for the news range */
  end?: Date;
  /** Maximum number of articles to return (default 10, max 50) */
  limit?: number;
  /** Sort order: 'asc' for oldest first, 'desc' for newest first (default) */
  sort?: 'asc' | 'desc';
  /** Include full article content (default false) */
  includeContent?: boolean;
}

/**
 * Strip HTML tags from a string
 */
function stripHtml(html: string): string {
  if (!html) {
    return '';
  }

  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, ' ');

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&hellip;/g, '...')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'");

  // Decode numeric HTML entities
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Convert date to RFC-3339 format string
 */
function toRFC3339(date: Date | string): string {
  if (typeof date === 'string') {
    return date;
  }
  return date.toISOString();
}

/**
 * Calculate basic sentiment score from text
 * Returns a value between -1 (negative) and 1 (positive)
 * This is a simple heuristic-based approach
 */
function calculateSentiment(text: string): number {
  if (!text) {
    return 0;
  }

  const lowerText = text.toLowerCase();

  // Positive indicators
  const positiveWords = [
    'surge', 'surges', 'surging', 'soar', 'soars', 'soaring',
    'gain', 'gains', 'gained', 'rise', 'rises', 'rising', 'rose',
    'jump', 'jumps', 'jumped', 'boost', 'boosts', 'boosted',
    'profit', 'profits', 'profitable', 'growth', 'growing', 'grew',
    'beat', 'beats', 'beating', 'exceed', 'exceeds', 'exceeded',
    'outperform', 'outperforms', 'strong', 'stronger', 'strongest',
    'upgrade', 'upgrades', 'upgraded', 'bullish', 'rally', 'rallies',
    'record', 'high', 'highs', 'positive', 'optimistic', 'upbeat',
    'success', 'successful', 'breakthrough', 'innovation', 'innovative',
  ];

  // Negative indicators
  const negativeWords = [
    'drop', 'drops', 'dropped', 'fall', 'falls', 'falling', 'fell',
    'decline', 'declines', 'declined', 'plunge', 'plunges', 'plunged',
    'crash', 'crashes', 'crashed', 'tumble', 'tumbles', 'tumbled',
    'loss', 'losses', 'losing', 'lost', 'miss', 'misses', 'missed',
    'downgrade', 'downgrades', 'downgraded', 'bearish', 'selloff',
    'weak', 'weaker', 'weakest', 'concern', 'concerns', 'worried',
    'warning', 'warns', 'warned', 'risk', 'risks', 'risky',
    'negative', 'pessimistic', 'underperform', 'underperforms',
    'layoff', 'layoffs', 'lawsuit', 'investigation', 'fraud',
    'recession', 'bankruptcy', 'default', 'crisis', 'trouble',
  ];

  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of positiveWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      positiveCount += matches.length;
    }
  }

  for (const word of negativeWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches) {
      negativeCount += matches.length;
    }
  }

  const total = positiveCount + negativeCount;
  if (total === 0) {
    return 0;
  }

  // Calculate sentiment score between -1 and 1
  return (positiveCount - negativeCount) / total;
}

/**
 * Convert Alpaca news article to simplified news format
 */
function toSimpleNews(article: AlpacaNewsArticle, includeContent: boolean = false): SimpleNews {
  const cleanSummary = stripHtml(article.summary);
  const cleanContent = includeContent ? stripHtml(article.content) : undefined;

  // Calculate sentiment from headline and summary
  const sentimentText = `${article.headline} ${cleanSummary}`;
  const sentiment = calculateSentiment(sentimentText);

  return {
    symbols: article.symbols,
    title: stripHtml(article.headline),
    summary: cleanSummary,
    content: cleanContent,
    url: article.url,
    source: article.source,
    author: article.author,
    date: article.created_at,
    updatedDate: article.updated_at,
    sentiment,
  };
}

/**
 * Get news articles with optional filtering
 * @param client - AlpacaClient instance
 * @param params - Parameters for fetching news
 * @returns Array of simplified news articles
 * @throws NewsError if the request fails
 */
export async function getNews(
  client: AlpacaClient,
  params: GetNewsParams = {}
): Promise<SimpleNews[]> {
  const { symbols, start, end, limit = 10, sort = 'desc', includeContent = false } = params;

  log(`Fetching news${symbols ? ` for ${symbols.join(', ')}` : ''}`, { type: 'debug' });

  try {
    const sdk = client.getSDK();

    const options: {
      symbols?: string;
      start?: string;
      end?: string;
      limit: number;
      sort: 'asc' | 'desc';
      include_content?: boolean;
    } = {
      limit: Math.min(limit, 50), // API max is 50
      sort,
    };

    if (symbols && symbols.length > 0) {
      options.symbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean).join(',');
    }
    if (start) {
      options.start = toRFC3339(start);
    }
    if (end) {
      options.end = toRFC3339(end);
    }
    if (includeContent) {
      options.include_content = true;
    }

    // Use SDK's getNews method
    const response = await sdk.getNews(options);

    if (!response || !Array.isArray(response)) {
      log('No news data returned', { type: 'debug' });
      return [];
    }

    // Map SDK response to our SimpleNews type
    // The SDK returns a slightly different structure, so we map the fields
    const articles: SimpleNews[] = response.map((article) => {
      // SDK returns properties in different format
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdkArticle = (article as unknown) as {
        ID?: number;
        id?: number;
        Author?: string;
        author?: string;
        Content?: string;
        content?: string;
        CreatedAt?: string;
        created_at?: string;
        UpdatedAt?: string;
        updated_at?: string;
        Headline?: string;
        headline?: string;
        Source?: string;
        source?: string;
        Summary?: string;
        summary?: string;
        URL?: string;
        url?: string;
        Symbols?: string[];
        symbols?: string[];
        Images?: Array<{ size: string; url: string }>;
        images?: Array<{ size: string; url: string }>;
      };

      // Normalize to our expected format
      const normalizedArticle: AlpacaNewsArticle = {
        id: sdkArticle.ID || sdkArticle.id || 0,
        author: sdkArticle.Author || sdkArticle.author || '',
        content: sdkArticle.Content || sdkArticle.content || '',
        created_at: sdkArticle.CreatedAt || sdkArticle.created_at || '',
        updated_at: sdkArticle.UpdatedAt || sdkArticle.updated_at || '',
        headline: sdkArticle.Headline || sdkArticle.headline || '',
        source: sdkArticle.Source || sdkArticle.source || '',
        summary: sdkArticle.Summary || sdkArticle.summary || '',
        url: sdkArticle.URL || sdkArticle.url || '',
        symbols: sdkArticle.Symbols || sdkArticle.symbols || [],
        images: (sdkArticle.Images || sdkArticle.images || []).map((img) => ({
          size: img.size as 'large' | 'small' | 'thumb',
          url: img.url,
        })),
      };

      return toSimpleNews(normalizedArticle, includeContent);
    });

    log(`Successfully fetched ${articles.length} news articles`, { type: 'debug' });

    return articles;
  } catch (error) {
    if (error instanceof NewsError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to fetch news: ${errorMessage}`, { type: 'error' });

    throw new NewsError(
      `Failed to fetch news: ${errorMessage}`,
      'FETCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get latest news for a specific symbol
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol to get news for
 * @param limit - Maximum number of articles (default 10)
 * @returns Array of simplified news articles
 * @throws NewsError if the request fails
 */
export async function getLatestNews(
  client: AlpacaClient,
  symbol: string,
  limit: number = 10
): Promise<SimpleNews[]> {
  const normalizedSymbol = symbol.toUpperCase().trim();

  if (!normalizedSymbol) {
    throw new NewsError('Symbol is required', 'INVALID_SYMBOL');
  }

  log(`Fetching latest news for ${normalizedSymbol}`, { type: 'debug' });

  return getNews(client, {
    symbols: [normalizedSymbol],
    limit,
    sort: 'desc',
  });
}

/**
 * Search news by keyword in headlines and summaries
 * Note: This performs client-side filtering since Alpaca API doesn't support keyword search
 * @param client - AlpacaClient instance
 * @param query - Search query (case-insensitive)
 * @param limit - Maximum number of articles (default 10)
 * @returns Array of simplified news articles matching the query
 * @throws NewsError if the request fails
 */
export async function searchNews(
  client: AlpacaClient,
  query: string,
  limit: number = 10
): Promise<SimpleNews[]> {
  if (!query || query.trim().length === 0) {
    throw new NewsError('Search query is required', 'INVALID_QUERY');
  }

  const searchQuery = query.trim().toLowerCase();

  log(`Searching news for: ${searchQuery}`, { type: 'debug' });

  try {
    // Fetch more articles than needed to filter client-side
    const fetchLimit = Math.min(limit * 5, 50);

    const articles = await getNews(client, {
      limit: fetchLimit,
      sort: 'desc',
    });

    // Filter articles that match the search query
    const matchingArticles = articles.filter((article) => {
      const title = article.title.toLowerCase();
      const summary = article.summary.toLowerCase();
      const content = article.content?.toLowerCase() || '';

      return (
        title.includes(searchQuery) ||
        summary.includes(searchQuery) ||
        content.includes(searchQuery)
      );
    });

    // Return only the requested number of articles
    const result = matchingArticles.slice(0, limit);

    log(`Found ${result.length} news articles matching "${query}"`, { type: 'debug' });

    return result;
  } catch (error) {
    if (error instanceof NewsError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to search news: ${errorMessage}`, { type: 'error' });

    throw new NewsError(
      `Failed to search news: ${errorMessage}`,
      'SEARCH_ERROR',
      undefined,
      error
    );
  }
}

/**
 * Get news for multiple symbols
 * @param client - AlpacaClient instance
 * @param symbols - Array of stock symbols
 * @param limit - Maximum number of articles per symbol (default 5)
 * @returns Map of symbol to news articles
 */
export async function getNewsForSymbols(
  client: AlpacaClient,
  symbols: string[],
  limit: number = 5
): Promise<Map<string, SimpleNews[]>> {
  if (!symbols || symbols.length === 0) {
    throw new NewsError('At least one symbol is required', 'INVALID_SYMBOLS');
  }

  const normalizedSymbols = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);

  log(`Fetching news for ${normalizedSymbols.length} symbols`, { type: 'debug' });

  // Fetch news for all symbols at once
  const allNews = await getNews(client, {
    symbols: normalizedSymbols,
    limit: normalizedSymbols.length * limit,
    sort: 'desc',
  });

  // Group news by symbol
  const newsBySymbol = new Map<string, SimpleNews[]>();

  // Initialize empty arrays for each symbol
  for (const symbol of normalizedSymbols) {
    newsBySymbol.set(symbol, []);
  }

  // Distribute articles to their respective symbols
  for (const article of allNews) {
    const articleSymbols = Array.isArray(article.symbols) ? article.symbols : [article.symbols];

    for (const symbol of articleSymbols) {
      const upperSymbol = symbol.toUpperCase();
      if (normalizedSymbols.includes(upperSymbol)) {
        const symbolNews = newsBySymbol.get(upperSymbol) || [];
        if (symbolNews.length < limit) {
          symbolNews.push(article);
          newsBySymbol.set(upperSymbol, symbolNews);
        }
      }
    }
  }

  log(`Successfully fetched news for ${newsBySymbol.size} symbols`, { type: 'debug' });

  return newsBySymbol;
}

/**
 * Get average sentiment for a symbol based on recent news
 * @param client - AlpacaClient instance
 * @param symbol - Stock symbol
 * @param limit - Number of articles to analyze (default 10)
 * @returns Average sentiment score between -1 and 1
 */
export async function getSymbolSentiment(
  client: AlpacaClient,
  symbol: string,
  limit: number = 10
): Promise<{ sentiment: number; articleCount: number }> {
  const news = await getLatestNews(client, symbol, limit);

  if (news.length === 0) {
    return {
      sentiment: 0,
      articleCount: 0,
    };
  }

  const totalSentiment = news.reduce((sum, article) => sum + article.sentiment, 0);
  const avgSentiment = totalSentiment / news.length;

  log(`Sentiment for ${symbol}: ${avgSentiment.toFixed(3)} (${news.length} articles)`, { type: 'debug' });

  return {
    sentiment: avgSentiment,
    articleCount: news.length,
  };
}

export default {
  getNews,
  getLatestNews,
  searchNews,
  getNewsForSymbols,
  getSymbolSentiment,
};
