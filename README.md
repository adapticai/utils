# Adaptic Utilities

Last updated: 20 Feb 2025

A comprehensive utility library for financial data processing, time manipulation, and formatting.

NPM repo: https://www.npmjs.com/package/@adaptic/utils

## Installation

```bash
npm install @adaptic/utils
```

## Usage

Import the functions from the library:

```typescript
import { adaptic } from '@adaptic/utils';
```

## Environment Variables

- `POLYGON_API_KEY`
- `ALPHA_VANTAGE_API_KEY`
- `ALPACA_API_KEY` - Required for crypto data and news
- `ALPACA_API_SECRET` - Required for crypto data and news
- `GOOGLE_SHEETS_CLIENT_EMAIL` - Required for Google Sheets operations
- `GOOGLE_SHEETS_PRIVATE_KEY` - Required for Google Sheets operations (with newlines preserved)
- `BACKEND_HTTPS_URL`= for the backend functions
- `NODE_ENV`='production' for backend functions to work with a remote server

## Alpaca Functions

### `fetchAccountDetails(accountId: string): Promise<AccountDetails>`

Asynchronously retrieves detailed information about a specific Alpaca trading account.

**Parameters:**
- `accountId: string` - The Alpaca account ID

**Returns:**
- `Promise<AccountDetails>` - Comprehensive account details including:
  ```typescript
  {
    id: string;
    account_number: string;
    status: 'ONBOARDING' | 'SUBMISSION_FAILED' | 'SUBMITTED' | 'ACCOUNT_UPDATED' | 'APPROVAL_PENDING' | 'ACTIVE' | 'REJECTED';
    currency: string;
    cash: string;
    portfolio_value: string;  // deprecated, equivalent to equity
    equity: string;
    buying_power: string;
    initial_margin: string;
    maintenance_margin: string;
    daytrade_count: number;
    daytrading_buying_power: string;
    options_buying_power: string;
    options_approved_level: 0 | 1 | 2 | 3;
    // ... and more fields available
  }
  ```

**Example:**
```typescript
const accountDetails = await adaptic.alpaca.fetchAccountDetails('your-account-id');
console.log(`Account equity: ${accountDetails.equity}`);
```

### `fetchPortfolioHistory({ params, accountId, client, alpacaAccount }: FetchPortfolioHistoryProps): Promise<PortfolioHistoryResponse>`

Asynchronously retrieves historical portfolio data including equity and profit/loss information from either the Adaptic backend or directly from an Alpaca account.

**Parameters:**
- `FetchPortfolioHistoryProps`:
  ```typescript
  {
    params: PortfolioHistoryParams;     // Portfolio history query parameters
    accountId?: string;                 // The Alpaca account ID (required if alpacaAccount not provided)
    client?: ApolloClientType<NormalizedCacheObject>;         // Optional Apollo client for backend queries
    alpacaAccount?: types.AlpacaAccount;// Optional Alpaca account object (if provided, accountId not required)
  }
  ```
- `PortfolioHistoryParams`:
  ```typescript
  {
    period?: string;         // e.g., '1D', '1W', '1M', '1A', 'YTD' (YTD will be converted to '1A')
    timeframe?: '1Min' | '5Min' | '15Min' | '1H' | '1D';
    intraday_reporting?: 'market_hours' | 'extended_hours' | 'continuous';
    start?: string;         // RFC3339 format (if specified with period, period will be ignored)
    end?: string;           // RFC3339 format
    pnl_reset?: 'per_day' | 'no_reset';
  }
  ```

**Returns:**
- `Promise<PortfolioHistoryResponse>`:
  ```typescript
  {
    timestamp: number[];     // UNIX epoch format
    equity: number[];
    profit_loss: number[];
    profit_loss_pct: number[];
    base_value: number;
    base_value_asof?: string;
    timeframe: string;
    cashflow?: Record<string, number>;
  }
  ```

**Example:**
```typescript
// Using accountId
const history = await adaptic.alpaca.fetchPortfolioHistory({
  accountId: 'your-account-id',
  params: {
    period: '1M',
    timeframe: '1D'
  }
});

// Using direct Alpaca account object
const history = await adaptic.alpaca.fetchPortfolioHistory({
  alpacaAccount: yourAlpacaAccount,
  params: {
    start: '2025-01-01T00:00:00Z',
    end: '2025-01-31T00:00:00Z',
    timeframe: '1D'
  }
});
```

### `adaptic.position.fetchAll(auth: AlpacaAuth): Promise<Position[]>`

Asynchronously fetches all current open positions for an Alpaca trading account.

**Parameters:**
- `auth: AlpacaAuth` - Authentication details:
  ```typescript
  {
    adapticAccountId?: string;  // Either this
    alpacaApiKey?: string;     // Or these two
    alpacaApiSecret?: string;
  }
  ```

**Returns:**
- `Promise<Position[]>` - Array of positions with the following type:
  ```typescript
  {
    asset_id: string;
    symbol: string;
    exchange: string;
    asset_class: string;
    asset_marginable: boolean;
    qty: string;
    qty_available: string;
    avg_entry_price: string;
    side: 'long' | 'short';
    market_value: string;
    cost_basis: string;
    unrealized_pl: string;
    unrealized_plpc: string;
    unrealized_intraday_pl: string;
    unrealized_intraday_plpc: string;
    current_price: string;
    lastday_price: string;
    change_today: string;
  }
  ```

**Example:**
```typescript
// Using adapticAccountId
const positions = await adaptic.position.fetchAll({
  adapticAccountId: 'your-account-id'
});

// Using direct API keys
const positions = await adaptic.position.fetchAll({
  alpacaApiKey: 'your-api-key',
  alpacaApiSecret: 'your-api-secret'
});
```

### `adaptic.position.fetch(symbolOrAssetId: string, auth: AlpacaAuth): Promise<Position>`

Asynchronously fetches a specific position for an Alpaca trading account.

**Parameters:**
- `symbolOrAssetId: string` - The symbol or asset ID to fetch the position for
- `auth: AlpacaAuth` - Authentication details (same as above)

**Returns:**
- `Promise<Position>` - Single position details with the same type as in `fetchAll`

**Example:**
```typescript
const position = await adaptic.position.fetch('AAPL', {
  adapticAccountId: 'your-account-id'
});
```

### `adaptic.position.close(symbolOrAssetId: string, auth: AlpacaAuth, params?: ClosePositionParams): Promise<Order>`

Closes a specific position in an Alpaca trading account.

**Parameters:**
- `symbolOrAssetId: string` - The symbol or asset ID of the position to close
- `auth: AlpacaAuth` - Authentication details (same as above)
- `params?: ClosePositionParams` - Optional closing parameters:
  ```typescript
  {
    qty?: number;        // Quantity of shares to close (up to 9 decimal places)
    percentage?: number; // Percentage of position to close (0-100, up to 9 decimal places)
  }
  ```

**Returns:**
- `Promise<Order>` - The order created to close the position

**Example:**
```typescript
// Close entire position
const order = await adaptic.position.close('AAPL', {
  adapticAccountId: 'your-account-id'
});

// Close 50% of position
const order = await adaptic.position.close('AAPL', {
  adapticAccountId: 'your-account-id'
}, {
  percentage: 50
});
```

### `adaptic.position.closeAll(auth: AlpacaAuth, params?: CloseAllPositionsParams): Promise<Array<{ symbol: string; status: number; body?: Order }>>`

Closes all positions in an Alpaca trading account.

**Parameters:**
- `auth: AlpacaAuth` - Authentication details (same as above)
- `params?: CloseAllPositionsParams` - Optional parameters:
  ```typescript
  {
    cancelOrders?: boolean; // If true, cancels all open orders before closing positions
  }
  ```

**Returns:**
- `Promise<Array<{ symbol: string; status: number; body?: Order }>>` - Status of each position closure attempt:
  - `symbol: string` - The symbol of the position
  - `status: number` - HTTP status code for the attempt
  - `body?: Order` - The order created to close the position (if successful)

**Example:**
```typescript
// Close all positions
const results = await adaptic.position.closeAll({
  adapticAccountId: 'your-account-id'
});

// Close all positions and cancel pending orders
const results = await adaptic.position.closeAll({
  adapticAccountId: 'your-account-id'
}, {
  cancelOrders: true
});
```

### `createOrder(params: CreateOrderParams): Promise<Order>`

Creates a new order for trading.

**Parameters:**
- `params: CreateOrderParams`:
  ```typescript
  {
    symbol: string;
    qty?: string;
    notional?: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
    time_in_force: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
    limit_price?: string;
    stop_price?: string;
    trail_price?: string;
    trail_percent?: string;
    extended_hours?: boolean;
    client_order_id?: string;
    order_class?: 'simple' | 'oco' | 'oto' | 'bracket';
    take_profit?: {
      limit_price: string;
      stop_price?: string;
      order_class?: OrderClass;
    };
    stop_loss?: {
      stop_price: string;
      limit_price?: string;
      order_class?: OrderClass;
    };
    position_intent?: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close';
  }
  ```

**Returns:**
- `Promise<Order>` - Created order details with full order type information

## Crypto Functions

### `fetchBars(params: CryptoBarsParams): Promise<CryptoBarsResponse>`

Fetches historical bar data for crypto trading pairs.

**Parameters:**
- `params: CryptoBarsParams`:
  ```typescript
  {
    symbols: CryptoPair[];
    timeframe: CryptoTimeframe;  // '1Min' | '5Min' | '15Min' | '1Hour' | '1Day' | '1Week' | '1Month'
    start?: Date;
    end?: Date;
    limit?: number;
    page_token?: string;
    sort?: 'asc' | 'desc';
  }
  ```

**Returns:**
- `Promise<CryptoBarsResponse>`:
  ```typescript
  {
    bars: {
      [symbol: string]: CryptoBar[];
    };
    next_page_token?: string;
  }
  ```
  where `CryptoBar` is:
  ```typescript
  {
    t: number;  // timestamp
    o: number;  // open
    h: number;  // high
    l: number;  // low
    c: number;  // close
    v: number;  // volume
  }
  ```

## Market Data Functions

### `fetchPolygonPrices(symbol: string, params: object): Promise<PolygonPriceData[]>`

Fetches historical price data from Polygon.io.

**Parameters:**
- `symbol: string` - The trading symbol
- `params: object` - Query parameters for the data fetch

**Returns:**
- `Promise<PolygonPriceData[]>`:
  ```typescript
  {
    date: string;
    timeStamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    vol: number;
    vwap: number;
  }[]
  ```

## Performance Metrics

### `calculateBeta(returns: number[], benchmarkReturns: number[]): CalculateBetaResult`

Calculates beta and related statistics for a portfolio against a benchmark.

**Parameters:**
- `returns: number[]` - Array of portfolio returns
- `benchmarkReturns: number[]` - Array of benchmark returns

**Returns:**
- `CalculateBetaResult`:
  ```typescript
  {
    beta: number;
    covariance: number;
    variance: number;
    averagePortfolioReturn: number;
    averageBenchmarkReturn: number;
  }
  ```

### `calculateMaxDrawdown(portfolioValues: number[]): number`

Calculates the maximum drawdown from peak for a series of portfolio values.

**Parameters:**
- `portfolioValues: number[]` - Array of portfolio values over time

**Returns:**
- `number` - Maximum drawdown as a decimal (e.g., 0.25 for 25% drawdown)

### `calculateDailyReturns(portfolioValues: number[]): number[]`

Computes daily returns from a series of portfolio values.

**Parameters:**
- `portfolioValues: number[]` - Array of portfolio values

**Returns:**
- `number[]` - Array of daily returns as decimals

## News Functions

### `fetchNews(params: NewsParams): Promise<NewsResponse>`

Fetches financial news articles.

**Parameters:**
- `params: NewsParams`:
  ```typescript
  {
    start?: Date | string;
    end?: Date | string;
    symbols?: string | string[];
    limit?: number;
    sort?: 'asc' | 'desc';
    page_token?: string;
  }
  ```

**Returns:**
- `Promise<NewsResponse>`:
  ```typescript
  {
    news: {
      id: number;
      author: string;
      content: string;
      created_at: string;
      updated_at: string;
      headline: string;
      source: string;
      summary: string;
      url: string;
      symbols: string[];
      images: {
        size: 'large' | 'small' | 'thumb';
        url: string;
      }[];
    }[];
    next_page_token?: string;
  }
  ```

## Time Utilities

### Market Time Types

The following types are used throughout the market time utilities:

```typescript
type Period = "1D" | "3D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "YTD";
type Timeframe = "1Min" | "5Min" | "15Min" | "1H" | "1D";
type IntradayReporting = 'market_hours' | 'extended_hours' | 'continuous';
type OutputFormat = 'iso' | 'unix-seconds' | 'unix-ms';

interface MarketTimeParams {
  period?: Period;
  start?: Date;
  end?: Date;
  timezone?: string;
  intraday_reporting?: IntradayReporting;
  outputFormat?: OutputFormat;
}

interface PeriodDates {
  start: string | number;
  end: string | number;
}

interface MarketOpenCloseOptions {
  date?: Date;
}

interface MarketOpenCloseResult {
  marketOpen: boolean;
  open: Date | null;
  close: Date | null;
  openExt: Date | null;
  closeExt: Date | null;
}
```

### `createMarketTimeUtil(timezone?: string, intraday_reporting?: IntradayReporting): MarketTimeUtil`

Creates a utility for market time-related operations.

**Parameters:**
- `timezone?: string` - Optional timezone (default: 'America/New_York')
- `intraday_reporting?: IntradayReporting` - Optional intraday reporting mode:
  - `'market_hours'` - Regular market hours (9:30 AM - 4:00 PM ET)
  - `'extended_hours'` - Extended market hours (4:00 AM - 8:00 PM ET)
  - `'continuous'` - All day, 24/7

**Returns:**
- `MarketTimeUtil` - Market time utility object

### `getMarketOpenClose(options?: MarketOpenCloseOptions): MarketOpenCloseResult`

Gets market open/close times for both regular and extended hours for a given date.

**Parameters:**
- `options?: MarketOpenCloseOptions` - Optional parameters:
  - `date?: Date` - The date to check (default: current date)

**Returns:**
- `MarketOpenCloseResult`:
  ```typescript
  {
    marketOpen: boolean;      // Whether the market is open on this date
    open: Date | null;        // Regular market hours open time
    close: Date | null;       // Regular market hours close time
    openExt: Date | null;     // Extended hours open time
    closeExt: Date | null;    // Extended hours close time
  }
  ```

**Example:**
```typescript
const { marketOpen, open, close, openExt, closeExt } = adaptic.time.getMarketOpenClose({
  date: new Date('2024-12-24')
});
```

### `getMarketStatus(options?: { date?: Date }): MarketStatus`

Gets the current market status and detailed information about market periods.

**Parameters:**
- `options?: object` - Optional parameters:
  - `date?: Date` - The date to check (default: current date)

**Returns:**
- `MarketStatus`:
  ```typescript
  {
    time: Date;                // Current time
    timeString: string;        // Formatted time string
    status: "closed" | "extended hours" | "open";  // Current market status
    nextStatus: "closed" | "extended hours" | "open";  // Next market status
    marketPeriod: "preMarket" | "earlyMarket" | "regularMarket" | "afterMarket" | "closed";  // Detailed market period
    nextStatusTime: Date;      // Time when next status begins
    nextStatusTimeDifference: number;  // Milliseconds until next status
    nextStatusTimeString: string;      // Formatted next status time
  }
  ```

The `marketPeriod` field indicates the specific trading period:
- `preMarket`: 4:00 AM - 9:30 AM ET
- `earlyMarket`: 9:30 AM - 10:00 AM ET
- `regularMarket`: 10:00 AM - Market Close (typically 4:00 PM ET)
- `afterMarket`: Market Close - 8:00 PM ET
- `closed`: Outside of all trading hours

**Example:**
```typescript
const status = adaptic.time.getMarketStatus();
console.log(`Current market period: ${status.marketPeriod}`);
```

### `toUnixTimestamp(date: Date): number`

Converts a date to Unix timestamp.

**Parameters:**
- `date: Date` - The date to convert

**Returns:**
- `number` - Unix timestamp

### `getTimeAgo(date: Date): string`

Returns a human-readable time difference from now.

**Parameters:**
- `date: Date` - The date to calculate from

**Returns:**
- `string` - Human-readable time difference (e.g., '1 minute ago')

### `normalizeDate(date: Date): string`

Standardizes a date to a consistent format.

**Parameters:**
- `date: Date` - The date to standardize

**Returns:**
- `string` - Standardized date string (e.g., '2024-11-09')

### `getDateInNY(time: number | string | { year: number; month: number; day: number }): Date`

Returns the current date in New York timezone.

**Parameters:**
- `time: number | string | { year: number; month: number; day: number }` - The time or date to convert

**Returns:**
- `Date` - Date in New York timezone

### `getStartAndEndTimestamps(params: MarketTimeParams = {}): PeriodDates`

Generates start and end timestamps for a given period.

**Parameters:**
- `params: MarketTimeParams` - Optional parameters for the period

**Returns:**
- `PeriodDates` - Start and end timestamps for the period

### `getStartAndEndDates(params: MarketTimeParams = {}): { start: Date; end: Date }`

Gets the start and end dates for a given period.

**Parameters:**
- `params: MarketTimeParams` - Optional parameters for the period

**Returns:**
- `{ start: Date; end: Date }` - Start and end dates for the period

### `getLastTradingDateYYYYMMDD(): string`

Gets the last trading date in YYYY-MM-DD format.

**Returns:**
- `string` - Last trading date in YYYY-MM-DD format

### `getLastFullTradingDate(currentDate?: Date): { date: Date; YYYYMMDD: string }`

Gets the last full trading date, considering market hours and holidays.

**Parameters:**
- `currentDate?: Date` - Optional reference date (defaults to current date)

**Returns:**
- Object containing:
  - `date: Date` - The last full trading date
  - `YYYYMMDD: string` - The date formatted as YYYY-MM-DD

### `getNextMarketDay({ referenceDate?: Date }): { date: Date; yyyymmdd: string; dateISOString: string }`

Gets the next market day from a reference date.

**Parameters:**
- `referenceDate?: Date` - Optional reference date (defaults to current date)

**Returns:**
- Object containing:
  - `date: Date` - The next market day (start of day in NY time)
  - `yyyymmdd: string` - The date formatted as YYYY-MM-DD
  - `dateISOString: string` - Full ISO date string

**Example:**
```typescript
const nextMarketDay = adaptic.time.getNextMarketDay();
console.log(`Next market day: ${nextMarketDay.yyyymmdd}`);

// With reference date
const nextMarketDay = adaptic.time.getNextMarketDay({ referenceDate: new Date('2025-01-01') });
```

### `currentTimeET(): Date`

Gets the current time in Eastern Time.

**Returns:**
- `Date` - Current time in Eastern Time

## Formatting Utilities

### `capitalize(string: string): string`

Capitalizes the first letter of a string.

**Parameters:**
- `string: string` - The string to capitalize

**Returns:**
- `string` - Capitalized string

### `formatEnum(enumValue: any): string`

Formats an enum value for display.

**Parameters:**
- `enumValue: any` - The enum value to format

**Returns:**
- `string` - Formatted enum value

### `formatCurrency(value: number): string`

Formats a number as currency.

**Parameters:**
- `value: number` - The number to format

**Returns:**
- `string` - Formatted currency string

### `formatPercentage(value: number): string`

Formats a number as a percentage.

**Parameters:**
- `value: number` - The number to format

**Returns:**
- `string` - Formatted percentage string

## Misc utilities

### `logIfDebug(message: string, data?: unknown, type: LogType = 'info' | 'warn' | 'error' | 'debug' | 'trace'): void`

Debug logging utility that respects environment debug flags.

**Parameters:**
- `message: string` - The log message
- `data?: unknown` - Optional data to log
- `type: LogType` - Optional log type (default: 'info')

### `fetchWithRetry(url: string, options: RequestInit): Promise<Response>`

Fetches data from a URL with retry logic.

**Parameters:**
- `url: string` - The URL to fetch
- `options: RequestInit` - Optional fetch options

**Returns:**
- `Promise<Response>` - Fetched response

## Alpaca API Utilities

This module provides several utility functions to interact with the Alpaca API, including fetching account details, placing orders, and retrieving market news.

### Fetching News Articles

The `fetchNews` function retrieves news articles for specified symbols from the Alpaca API. It supports pagination and accepts various optional parameters to customize the query.

#### Usage

```typescript
import { fetchNews } from './alpaca';

// Example: Fetch news for a single symbol or multiple symbols (comma-separated)
const symbols = "AAPL,MSFT,GOOG"; // For multiple symbols, use a comma-separated string

(async () => {
  try {
    // Option 1: Pass Alpaca API credentials via the auth parameter
    const newsData = await fetchNews(symbols, {
      auth: {
        alpacaApiKey: "YOUR_API_KEY",
        alpacaApiSecret: "YOUR_API_SECRET",
      },
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Default: last 24 hours
      end: new Date(),
      limit: 10,
      sort: 'desc',
    });
    console.log(newsData.news);

    // Option 2: Rely on environment variables ALPACA_API_KEY and ALPACA_API_SECRET
    const newsDataEnv = await fetchNews(symbols, {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(),
      limit: 10,
      sort: 'desc',
    });
    console.log(newsDataEnv.news);

    // Pagination
    // fetchNews automatically fetches all pages if a next_page_token is provided by the API.
    // The final returned result contains all aggregated news articles along with a `nextPageToken` (if any remain).

  } catch (error) {
    console.error(`Error fetching news: ${error}`);
  }
})();
```

#### Parameter Details

- **symbols**: A required string listing the symbols to fetch news for. For multiple symbols, separate them with commas (e.g., "AAPL,MSFT,GOOG").
- **params.auth**: (Optional) An object of type `AlpacaAuth` containing either:
  - `alpacaApiKey` and `alpacaApiSecret` for direct authentication, or
  - `adapticAccountId` to look up credentials from your backend via Adaptic.

If the `auth` parameter is not provided, the function will fallback to using the environment variables `ALPACA_API_KEY` and `ALPACA_API_SECRET`.

- **params.start** and **params.end**: Specify the date range (as a Date object or string) for the news articles. Defaults to the last 24 hours if not provided.
- **params.limit**: The maximum number of articles to return per page (default is 10).
- **params.sort**: The sort order for articles. Use `'asc'` for ascending order or `'desc'` for descending order (default is `'desc'`).
- **params.page_token**: A token for pagination. This is automatically handled by `fetchNews` if more results are available.

The function consolidates all pages of results and returns an object with a `news` array (of type `SimpleNews[]`) and an optional `nextPageToken`.

## Contributing to the Repository

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## Author

This project is a product of [Lumic.ai](https://lumic.ai).

Thanks for reading this far! Why did the trader bring a ladder to the bar? Because they heard the drinks were on the house!
