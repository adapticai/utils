import { describe, it, expect, vi } from 'vitest';

// Mock logger before imports
vi.mock('../logger', () => ({
  getLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  paginate,
  paginateAll,
  CursorPaginationConfig,
  UrlPaginationConfig,
  OffsetPaginationConfig,
} from '../utils/paginator';

// ===== Cursor-Based Pagination Tests =====

describe('paginate - cursor-based', () => {
  it('should iterate through all pages using cursor', async () => {
    const pages = [
      { items: [1, 2, 3], next: 'page2' },
      { items: [4, 5, 6], next: 'page3' },
      { items: [7, 8], next: undefined },
    ];
    let pageIndex = 0;

    const config: CursorPaginationConfig<number, typeof pages[0]> = {
      type: 'cursor',
      fetchPage: async (_cursor) => {
        const page = pages[pageIndex];
        pageIndex++;
        return page;
      },
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
      label: 'test-cursor',
    };

    const result: number[] = [];
    for await (const item of paginate(config)) {
      result.push(item);
    }

    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('should pass cursor to fetchPage', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ['a'], next: 'cursor-2' })
      .mockResolvedValueOnce({ items: ['b'], next: undefined });

    const config: CursorPaginationConfig<string, { items: string[]; next: string | undefined }> = {
      type: 'cursor',
      fetchPage,
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
    };

    const result = await paginateAll(config);

    expect(result).toEqual(['a', 'b']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-2');
  });

  it('should stop when next cursor is null', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1], next: null });

    const config: CursorPaginationConfig<number, { items: number[]; next: string | null }> = {
      type: 'cursor',
      fetchPage,
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('should stop when next cursor is empty string', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1], next: '' });

    const config: CursorPaginationConfig<number, { items: number[]; next: string }> = {
      type: 'cursor',
      fetchPage,
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('should respect maxItems limit', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2, 3], next: 'page2' })
      .mockResolvedValueOnce({ items: [4, 5, 6], next: 'page3' })
      .mockResolvedValueOnce({ items: [7, 8, 9], next: undefined });

    const config: CursorPaginationConfig<number, { items: number[]; next: string | undefined }> = {
      type: 'cursor',
      fetchPage,
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
      maxItems: 5,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should respect maxPages limit', async () => {
    let callCount = 0;
    const fetchPage = vi.fn().mockImplementation(async () => {
      callCount++;
      return { items: [callCount], next: `page-${callCount + 1}` };
    });

    const config: CursorPaginationConfig<number, { items: number[]; next: string }> = {
      type: 'cursor',
      fetchPage,
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
      maxPages: 3,
      label: 'test-max-pages',
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('should handle empty first page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [], next: undefined });

    const config: CursorPaginationConfig<number, { items: number[]; next: string | undefined }> = {
      type: 'cursor',
      fetchPage,
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([]);
  });

  it('should handle single item per page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1], next: 'p2' })
      .mockResolvedValueOnce({ items: [2], next: 'p3' })
      .mockResolvedValueOnce({ items: [3], next: undefined });

    const config: CursorPaginationConfig<number, { items: number[]; next: string | undefined }> = {
      type: 'cursor',
      fetchPage,
      getItems: (response) => response.items,
      getNextCursor: (response) => response.next,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1, 2, 3]);
  });
});

// ===== URL-Based Pagination Tests =====

describe('paginate - URL-based', () => {
  it('should iterate through all pages using URLs', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: ['a', 'b'], nextUrl: 'https://api.example.com/page2' })
      .mockResolvedValueOnce({ items: ['c', 'd'], nextUrl: 'https://api.example.com/page3' })
      .mockResolvedValueOnce({ items: ['e'], nextUrl: null });

    const config: UrlPaginationConfig<string, { items: string[]; nextUrl: string | null }> = {
      type: 'url',
      fetchPage,
      initialUrl: 'https://api.example.com/page1',
      getItems: (response) => response.items,
      getNextUrl: (response) => response.nextUrl,
    };

    const result = await paginateAll(config);
    expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 'https://api.example.com/page1');
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'https://api.example.com/page2');
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'https://api.example.com/page3');
  });

  it('should stop when nextUrl is null', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1], nextUrl: null });

    const config: UrlPaginationConfig<number, { items: number[]; nextUrl: string | null }> = {
      type: 'url',
      fetchPage,
      initialUrl: 'https://api.example.com',
      getItems: (response) => response.items,
      getNextUrl: (response) => response.nextUrl,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('should respect maxItems in URL pagination', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2, 3], nextUrl: 'page2' })
      .mockResolvedValueOnce({ items: [4, 5, 6], nextUrl: 'page3' });

    const config: UrlPaginationConfig<number, { items: number[]; nextUrl: string | null }> = {
      type: 'url',
      fetchPage,
      initialUrl: 'page1',
      getItems: (response) => response.items,
      getNextUrl: (response) => response.nextUrl,
      maxItems: 4,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1, 2, 3, 4]);
  });
});

// ===== Offset-Based Pagination Tests =====

describe('paginate - offset-based', () => {
  it('should iterate through all pages using offset', async () => {
    const allItems = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const pageSize = 3;

    const fetchPage = vi.fn().mockImplementation(async (offset: number, limit: number) => ({
      items: allItems.slice(offset, offset + limit),
      total: allItems.length,
    }));

    const config: OffsetPaginationConfig<number, { items: number[]; total: number }> = {
      type: 'offset',
      fetchPage,
      getItems: (response) => response.items,
      pageSize,
      getTotalCount: (response) => response.total,
    };

    const result = await paginateAll(config);
    expect(result).toEqual(allItems);
    expect(fetchPage).toHaveBeenCalledTimes(4); // ceil(10/3) = 4
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 3);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 3, 3);
    expect(fetchPage).toHaveBeenNthCalledWith(3, 6, 3);
    expect(fetchPage).toHaveBeenNthCalledWith(4, 9, 3);
  });

  it('should stop when page returns fewer items than pageSize', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2, 3] })
      .mockResolvedValueOnce({ items: [4, 5, 6] })
      .mockResolvedValueOnce({ items: [7] }); // Less than pageSize of 3

    const config: OffsetPaginationConfig<number, { items: number[] }> = {
      type: 'offset',
      fetchPage,
      getItems: (response) => response.items,
      pageSize: 3,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('should stop when total count is reached', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2], total: 4 })
      .mockResolvedValueOnce({ items: [3, 4], total: 4 });

    const config: OffsetPaginationConfig<number, { items: number[]; total: number }> = {
      type: 'offset',
      fetchPage,
      getItems: (response) => response.items,
      pageSize: 2,
      getTotalCount: (response) => response.total,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('should respect maxItems in offset pagination', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2, 3] })
      .mockResolvedValueOnce({ items: [4, 5, 6] });

    const config: OffsetPaginationConfig<number, { items: number[] }> = {
      type: 'offset',
      fetchPage,
      getItems: (response) => response.items,
      pageSize: 3,
      maxItems: 4,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('should handle empty first page', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [] });

    const config: OffsetPaginationConfig<number, { items: number[] }> = {
      type: 'offset',
      fetchPage,
      getItems: (response) => response.items,
      pageSize: 10,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

// ===== Async Iterator Tests =====

describe('paginate - async iterator behavior', () => {
  it('should support for-await-of iteration', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ items: [1, 2], next: 'p2' })
      .mockResolvedValueOnce({ items: [3], next: undefined });

    const config: CursorPaginationConfig<number, { items: number[]; next: string | undefined }> = {
      type: 'cursor',
      fetchPage,
      getItems: (r) => r.items,
      getNextCursor: (r) => r.next,
    };

    const items: number[] = [];
    for await (const item of paginate(config)) {
      items.push(item);
    }
    expect(items).toEqual([1, 2, 3]);
  });

  it('should support early break from iteration', async () => {
    let fetchCount = 0;
    const fetchPage = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return { items: [fetchCount * 10 + 1, fetchCount * 10 + 2], next: `p${fetchCount + 1}` };
    });

    const config: CursorPaginationConfig<number, { items: number[]; next: string }> = {
      type: 'cursor',
      fetchPage,
      getItems: (r) => r.items,
      getNextCursor: (r) => r.next,
    };

    const items: number[] = [];
    for await (const item of paginate(config)) {
      items.push(item);
      if (items.length >= 3) {
        break;
      }
    }
    expect(items).toEqual([11, 12, 21]);
  });
});

// ===== paginateAll Tests =====

describe('paginateAll', () => {
  it('should collect all items into an array', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ data: ['alpha', 'bravo'], cursor: 'c2' })
      .mockResolvedValueOnce({ data: ['charlie'], cursor: null });

    const config: CursorPaginationConfig<string, { data: string[]; cursor: string | null }> = {
      type: 'cursor',
      fetchPage,
      getItems: (r) => r.data,
      getNextCursor: (r) => r.cursor,
    };

    const result = await paginateAll(config);
    expect(result).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('should return empty array for empty result set', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ data: [], cursor: null });

    const config: CursorPaginationConfig<string, { data: string[]; cursor: string | null }> = {
      type: 'cursor',
      fetchPage,
      getItems: (r) => r.data,
      getNextCursor: (r) => r.cursor,
    };

    const result = await paginateAll(config);
    expect(result).toEqual([]);
  });

  it('should propagate errors from fetchPage', async () => {
    const fetchPage = vi.fn()
      .mockRejectedValueOnce(new Error('API error'));

    const config: CursorPaginationConfig<string, { data: string[]; cursor: string | null }> = {
      type: 'cursor',
      fetchPage,
      getItems: (r) => r.data,
      getNextCursor: (r) => r.cursor,
    };

    await expect(paginateAll(config)).rejects.toThrow('API error');
  });
});

// ===== Alpaca-Specific Pagination Pattern Tests =====

describe('Alpaca pagination patterns', () => {
  it('should support Alpaca news response pagination pattern', async () => {
    interface AlpacaNewsPage {
      news: Array<{ id: number; headline: string }>;
      next_page_token: string | null;
    }

    const page1: AlpacaNewsPage = {
      news: [{ id: 1, headline: 'News 1' }, { id: 2, headline: 'News 2' }],
      next_page_token: 'token-2',
    };
    const page2: AlpacaNewsPage = {
      news: [{ id: 3, headline: 'News 3' }],
      next_page_token: null,
    };

    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const config: CursorPaginationConfig<{ id: number; headline: string }, AlpacaNewsPage> = {
      type: 'cursor',
      fetchPage,
      getItems: (r) => r.news,
      getNextCursor: (r) => r.next_page_token,
      label: 'Alpaca.getNews',
    };

    const result = await paginateAll(config);
    expect(result).toHaveLength(3);
    expect(result.map(n => n.id)).toEqual([1, 2, 3]);
  });

  it('should support Polygon next_url pagination pattern', async () => {
    interface PolygonTradesPage {
      results: Array<{ price: number }>;
      next_url: string | null;
    }

    const page1: PolygonTradesPage = {
      results: [{ price: 150 }, { price: 151 }],
      next_url: 'https://api.polygon.io/v3/trades/AAPL?cursor=abc',
    };
    const page2: PolygonTradesPage = {
      results: [{ price: 152 }],
      next_url: null,
    };

    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const config: UrlPaginationConfig<{ price: number }, PolygonTradesPage> = {
      type: 'url',
      fetchPage,
      initialUrl: 'https://api.polygon.io/v3/trades/AAPL',
      getItems: (r) => r.results,
      getNextUrl: (r) => r.next_url,
      label: 'Polygon.getTrades',
    };

    const result = await paginateAll(config);
    expect(result).toHaveLength(3);
    expect(result.map(t => t.price)).toEqual([150, 151, 152]);
  });
});
