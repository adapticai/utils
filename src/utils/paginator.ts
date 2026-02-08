/**
 * Generic pagination utility for APIs that support cursor-based or offset-based pagination.
 *
 * Supports:
 * - Cursor-based pagination (Alpaca: `next_page_token` / `page_token`)
 * - URL-based pagination (Polygon: `next_url`)
 * - Offset-based pagination (page numbers or skip/take)
 *
 * Provides both async iterator and collect-all patterns.
 */
import { getLogger } from '../logger';

/**
 * Configuration for cursor-based pagination.
 * Used by Alpaca APIs that return `next_page_token`.
 */
export interface CursorPaginationConfig<TItem, TResponse> {
  /** Pagination strategy type */
  type: 'cursor';
  /**
   * Function that fetches a single page of results.
   * @param cursor - The cursor/page token for the next page (undefined for first page)
   * @returns The API response for that page
   */
  fetchPage: (cursor: string | undefined) => Promise<TResponse>;
  /**
   * Function that extracts items from the API response.
   * @param response - The raw API response
   * @returns Array of items from this page
   */
  getItems: (response: TResponse) => TItem[];
  /**
   * Function that extracts the next cursor/page token from the response.
   * Returns undefined/null/empty string when there are no more pages.
   * @param response - The raw API response
   * @returns The next page token, or a falsy value if no more pages
   */
  getNextCursor: (response: TResponse) => string | undefined | null;
  /** Maximum number of items to collect (optional; defaults to no limit) */
  maxItems?: number;
  /** Maximum number of pages to fetch (safety limit; defaults to 1000) */
  maxPages?: number;
  /** Label for logging purposes */
  label?: string;
}

/**
 * Configuration for URL-based pagination.
 * Used by Polygon APIs that return `next_url`.
 */
export interface UrlPaginationConfig<TItem, TResponse> {
  /** Pagination strategy type */
  type: 'url';
  /**
   * Function that fetches a page from a given URL.
   * For the first page, the URL is the initial request URL.
   * For subsequent pages, the URL comes from the previous response.
   * @param url - The URL to fetch
   * @returns The API response for that page
   */
  fetchPage: (url: string) => Promise<TResponse>;
  /** The initial URL for the first page */
  initialUrl: string;
  /**
   * Function that extracts items from the API response.
   * @param response - The raw API response
   * @returns Array of items from this page
   */
  getItems: (response: TResponse) => TItem[];
  /**
   * Function that extracts the next URL from the response.
   * Returns undefined/null/empty string when there are no more pages.
   * @param response - The raw API response
   * @returns The next page URL, or a falsy value if no more pages
   */
  getNextUrl: (response: TResponse) => string | undefined | null;
  /** Maximum number of items to collect (optional; defaults to no limit) */
  maxItems?: number;
  /** Maximum number of pages to fetch (safety limit; defaults to 1000) */
  maxPages?: number;
  /** Label for logging purposes */
  label?: string;
}

/**
 * Configuration for offset-based pagination.
 * Used by APIs that accept page/offset parameters.
 */
export interface OffsetPaginationConfig<TItem, TResponse> {
  /** Pagination strategy type */
  type: 'offset';
  /**
   * Function that fetches a page at a given offset.
   * @param offset - The current offset (starts at 0)
   * @param limit - The page size
   * @returns The API response for that page
   */
  fetchPage: (offset: number, limit: number) => Promise<TResponse>;
  /**
   * Function that extracts items from the API response.
   * @param response - The raw API response
   * @returns Array of items from this page
   */
  getItems: (response: TResponse) => TItem[];
  /** Number of items per page */
  pageSize: number;
  /**
   * Optional function to determine the total number of items.
   * If not provided, pagination stops when a page returns fewer items than pageSize.
   * @param response - The first API response
   * @returns Total number of items available
   */
  getTotalCount?: (response: TResponse) => number;
  /** Maximum number of items to collect (optional; defaults to no limit) */
  maxItems?: number;
  /** Maximum number of pages to fetch (safety limit; defaults to 1000) */
  maxPages?: number;
  /** Label for logging purposes */
  label?: string;
}

/** Union type of all pagination configurations */
export type PaginationConfig<TItem, TResponse> =
  | CursorPaginationConfig<TItem, TResponse>
  | UrlPaginationConfig<TItem, TResponse>
  | OffsetPaginationConfig<TItem, TResponse>;

/** Default maximum number of pages to prevent infinite loops */
const DEFAULT_MAX_PAGES = 1000;

/**
 * Creates an async iterator that paginates through API results.
 * Yields individual items one at a time across all pages.
 *
 * @param config - Pagination configuration
 * @returns AsyncGenerator that yields items one at a time
 *
 * @example
 * ```typescript
 * // Cursor-based (Alpaca)
 * const iterator = paginate({
 *   type: 'cursor',
 *   fetchPage: (cursor) => alpacaAPI.getOrders({ page_token: cursor }),
 *   getItems: (response) => response.orders,
 *   getNextCursor: (response) => response.next_page_token,
 *   label: 'getOrders',
 * });
 *
 * for await (const order of iterator) {
 *   processOrder(order);
 * }
 * ```
 */
export async function* paginate<TItem, TResponse>(
  config: PaginationConfig<TItem, TResponse>
): AsyncGenerator<TItem, void, undefined> {
  const maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
  const maxItems = config.maxItems ?? Infinity;
  const label = config.label ?? 'paginate';
  let pageCount = 0;
  let itemCount = 0;

  if (config.type === 'cursor') {
    let cursor: string | undefined;

    while (pageCount < maxPages && itemCount < maxItems) {
      pageCount++;
      const response = await config.fetchPage(cursor);
      const items = config.getItems(response);

      for (const item of items) {
        if (itemCount >= maxItems) {
          return;
        }
        yield item;
        itemCount++;
      }

      const nextCursor = config.getNextCursor(response);
      if (!nextCursor) {
        break;
      }
      cursor = nextCursor;
    }
  } else if (config.type === 'url') {
    let url: string | undefined | null = config.initialUrl;

    while (url && pageCount < maxPages && itemCount < maxItems) {
      pageCount++;
      const response = await config.fetchPage(url);
      const items = config.getItems(response);

      for (const item of items) {
        if (itemCount >= maxItems) {
          return;
        }
        yield item;
        itemCount++;
      }

      url = config.getNextUrl(response);
    }
  } else if (config.type === 'offset') {
    let offset = 0;
    let totalCount: number | undefined;

    while (pageCount < maxPages && itemCount < maxItems) {
      pageCount++;
      const response = await config.fetchPage(offset, config.pageSize);
      const items = config.getItems(response);

      // Determine total count on first page if available
      if (totalCount === undefined && config.getTotalCount) {
        totalCount = config.getTotalCount(response);
      }

      for (const item of items) {
        if (itemCount >= maxItems) {
          return;
        }
        yield item;
        itemCount++;
      }

      offset += config.pageSize;

      // Stop if we got fewer items than page size (last page)
      if (items.length < config.pageSize) {
        break;
      }

      // Stop if we have reached the total count
      if (totalCount !== undefined && offset >= totalCount) {
        break;
      }
    }
  }

  if (pageCount >= maxPages) {
    getLogger().warn(`${label}: Stopped pagination after ${pageCount} pages (safety limit)`, {
      source: 'paginator',
      label,
      pageCount,
      itemCount,
    });
  }
}

/**
 * Collects all items from a paginated API into a single array.
 * This is a convenience wrapper around `paginate()`.
 *
 * @param config - Pagination configuration
 * @returns Array of all items collected across all pages
 *
 * @example
 * ```typescript
 * // Collect all orders
 * const allOrders = await paginateAll({
 *   type: 'cursor',
 *   fetchPage: (cursor) => alpacaAPI.getOrders({ page_token: cursor, limit: 100 }),
 *   getItems: (response) => response,
 *   getNextCursor: (response) => response.next_page_token,
 *   maxItems: 500,
 *   label: 'getAllOrders',
 * });
 * ```
 */
export async function paginateAll<TItem, TResponse>(
  config: PaginationConfig<TItem, TResponse>
): Promise<TItem[]> {
  const items: TItem[] = [];

  for await (const item of paginate(config)) {
    items.push(item);
  }

  return items;
}
