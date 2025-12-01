import { AlpacaAccountDetails, AlpacaCredentials, AlpacaPosition, AssetClass, GetOptionContractsParams, GetOrdersParams, OptionAccountActivity, OptionContract, OptionContractsResponse, AlpacaOrder, OrderLeg, TradeUpdate } from './types/alpaca-types';
/**
Websocket example
  const alpacaAPI = createAlpacaTradingAPI(credentials); // type AlpacaCredentials
  alpacaAPI.onTradeUpdate((update: TradeUpdate) => {
   this.log(`Received trade update: event ${update.event} for an order to ${update.order.side} ${update.order.qty} of ${update.order.symbol}`);
  });
  alpacaAPI.connectWebsocket(); // necessary to connect to the WebSocket
*/
export declare class AlpacaTradingAPI {
    static new(credentials: AlpacaCredentials): AlpacaTradingAPI;
    static getInstance(credentials: AlpacaCredentials): AlpacaTradingAPI;
    private ws;
    private headers;
    private tradeUpdateCallback;
    private credentials;
    private apiBaseUrl;
    private wsUrl;
    private authenticated;
    private connecting;
    private reconnectDelay;
    private reconnectTimeout;
    private messageHandlers;
    private debugLogging;
    /**
     * Constructor for AlpacaTradingAPI
     * @param credentials - Alpaca credentials,
     *   accountName: string; // The account identifier used inthis.logs and tracking
     *   apiKey: string; // Alpaca API key
     *   apiSecret: string; // Alpaca API secret
     *   type: AlpacaAccountType;
     *   orderType: AlpacaOrderType;
     * @param options - Optional options
     *   debugLogging: boolean; // Whether to log messages of type 'debug'
     */
    constructor(credentials: AlpacaCredentials, options?: {
        debugLogging?: boolean;
    });
    private log;
    /**
     * Round a price to the nearest 2 decimal places for Alpaca, or 4 decimal places for prices less than $1
     * @param price - The price to round
     * @returns The rounded price
     */
    private roundPriceForAlpaca;
    private handleAuthMessage;
    private handleListenMessage;
    private handleTradeUpdate;
    private handleMessage;
    connectWebsocket(): void;
    private authenticate;
    private subscribeToTradeUpdates;
    private makeRequest;
    getPositions(assetClass?: AssetClass): Promise<AlpacaPosition[]>;
    /**
     * Get all orders
     * @param params (GetOrdersParams) - optional parameters to filter the orders
     * - status: 'open' | 'closed' | 'all'
     * - limit: number
     * - after: string
     * - until: string
     * - direction: 'asc' | 'desc'
     * - nested: boolean
     * - symbols: string[], an array of all the symbols
     * - side: 'buy' | 'sell'
     * @returns all orders
     */
    getOrders(params?: GetOrdersParams): Promise<AlpacaOrder[]>;
    getAccountDetails(): Promise<AlpacaAccountDetails>;
    /**
     * Create a trailing stop order
     * @param symbol (string) - the symbol of the order
     * @param qty (number) - the quantity of the order
     * @param side (string) - the side of the order
     * @param trailPercent100 (number) - the trail percent of the order (scale 100, i.e. 0.5 = 0.5%)
     * @param position_intent (string) - the position intent of the order
     */
    createTrailingStop(symbol: string, qty: number, side: 'buy' | 'sell', trailPercent100: number, position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close'): Promise<void>;
    /**
     * Create a market order
     * @param symbol (string) - the symbol of the order
     * @param qty (number) - the quantity of the order
     * @param side (string) - the side of the order
     * @param position_intent (string) - the position intent of the order. Important for knowing if a position needs a trailing stop.
     */
    createMarketOrder(symbol: string, qty: number, side: 'buy' | 'sell', position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close', client_order_id?: string): Promise<AlpacaOrder>;
    /**
     * Get the current trail percent for a symbol, assuming that it has an open position and a trailing stop order to close it. Because this relies on an orders request for one symbol, you can't do it too often.
     * @param symbol (string) - the symbol of the order
     * @returns the current trail percent
     */
    getCurrentTrailPercent(symbol: string): Promise<number | null>;
    /**
     * Update the trail percent for a trailing stop order
     * @param symbol (string) - the symbol of the order
     * @param trailPercent100 (number) - the trail percent of the order (scale 100, i.e. 0.5 = 0.5%)
     */
    updateTrailingStop(symbol: string, trailPercent100: number): Promise<void>;
    /**
     * Cancel all open orders
     */
    cancelAllOrders(): Promise<void>;
    /**
     * Cancel a specific order by its ID
     * @param orderId The id of the order to cancel
     * @throws Error if the order is not cancelable (status 422) or if the order doesn't exist
     * @returns Promise that resolves when the order is successfully canceled
     */
    cancelOrder(orderId: string): Promise<void>;
    /**
     * Create a limit order
     * @param symbol (string) - the symbol of the order
     * @param qty (number) - the quantity of the order
     * @param side (string) - the side of the order
     * @param limitPrice (number) - the limit price of the order
     * @param position_intent (string) - the position intent of the order
     * @param extended_hours (boolean) - whether the order is in extended hours
     * @param client_order_id (string) - the client order id of the order
     */
    createLimitOrder(symbol: string, qty: number, side: 'buy' | 'sell', limitPrice: number, position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close', extended_hours?: boolean, client_order_id?: string): Promise<AlpacaOrder>;
    /**
     * Close all equities positions
     * @param options (object) - the options for closing the positions
     * - cancel_orders (boolean) - whether to cancel related orders
     * - useLimitOrders (boolean) - whether to use limit orders to close the positions
     */
    closeAllPositions(options?: {
        cancel_orders: boolean;
        useLimitOrders: boolean;
    }): Promise<void>;
    /**
     * Close all equities positions using limit orders during extended hours trading
     * @param cancelOrders Whether to cancel related orders (default: true)
     * @returns Promise that resolves when all positions are closed
     */
    closeAllPositionsAfterHours(): Promise<void>;
    onTradeUpdate(callback: (update: TradeUpdate) => void): void;
    /**
     * Get portfolio history for the account
     * @param params Parameters for the portfolio history request
     * @returns Portfolio history data
     */
    getPortfolioHistory(params: {
        timeframe?: '1Min' | '5Min' | '15Min' | '1H' | '1D';
        period?: string;
        extended_hours?: boolean;
        date_end?: string;
    }): Promise<{
        timestamp: number[];
        equity: number[];
        profit_loss: number[];
        profit_loss_pct: number[];
        base_value: number;
        timeframe: string;
    }>;
    /**
     * Get option contracts based on specified parameters
     * @param params Parameters to filter option contracts
     * @returns Option contracts matching the criteria
     */
    getOptionContracts(params: GetOptionContractsParams): Promise<OptionContractsResponse>;
    /**
     * Get a specific option contract by symbol or ID
     * @param symbolOrId The symbol or ID of the option contract
     * @returns The option contract details
     */
    getOptionContract(symbolOrId: string): Promise<OptionContract>;
    /**
     * Create a simple option order (market or limit)
     * @param symbol Option contract symbol
     * @param qty Quantity of contracts (must be a whole number)
     * @param side Buy or sell
     * @param position_intent Position intent (buy_to_open, buy_to_close, sell_to_open, sell_to_close)
     * @param type Order type (market or limit)
     * @param limitPrice Limit price (required for limit orders)
     * @returns The created order
     */
    createOptionOrder(symbol: string, qty: number, side: 'buy' | 'sell', position_intent: 'buy_to_open' | 'buy_to_close' | 'sell_to_open' | 'sell_to_close', type: 'market' | 'limit', limitPrice?: number): Promise<AlpacaOrder>;
    /**
     * Create a multi-leg option order
     * @param legs Array of order legs
     * @param qty Quantity of the multi-leg order (must be a whole number)
     * @param type Order type (market or limit)
     * @param limitPrice Limit price (required for limit orders)
     * @returns The created multi-leg order
     */
    createMultiLegOptionOrder(legs: OrderLeg[], qty: number, type: 'market' | 'limit', limitPrice?: number): Promise<AlpacaOrder>;
    /**
     * Exercise an option contract
     * @param symbolOrContractId The symbol or ID of the option contract to exercise
     * @returns Response from the exercise request
     */
    exerciseOption(symbolOrContractId: string): Promise<any>;
    /**
     * Get option positions
     * @returns Array of option positions
     */
    getOptionPositions(): Promise<AlpacaPosition[]>;
    getOptionsOpenSpreadTrades(): Promise<void>;
    /**
     * Get option account activities (exercises, assignments, expirations)
     * @param activityType Type of option activity to filter by
     * @param date Date to filter activities (YYYY-MM-DD format)
     * @returns Array of option account activities
     */
    getOptionActivities(activityType?: 'OPEXC' | 'OPASN' | 'OPEXP', date?: string): Promise<OptionAccountActivity[]>;
    /**
     * Create a long call spread (buy lower strike call, sell higher strike call)
     * @param lowerStrikeCallSymbol Symbol of the lower strike call option
     * @param higherStrikeCallSymbol Symbol of the higher strike call option
     * @param qty Quantity of spreads to create (must be a whole number)
     * @param limitPrice Limit price for the spread
     * @returns The created multi-leg order
     */
    createLongCallSpread(lowerStrikeCallSymbol: string, higherStrikeCallSymbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder>;
    /**
     * Create a long put spread (buy higher strike put, sell lower strike put)
     * @param higherStrikePutSymbol Symbol of the higher strike put option
     * @param lowerStrikePutSymbol Symbol of the lower strike put option
     * @param qty Quantity of spreads to create (must be a whole number)
     * @param limitPrice Limit price for the spread
     * @returns The created multi-leg order
     */
    createLongPutSpread(higherStrikePutSymbol: string, lowerStrikePutSymbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder>;
    /**
     * Create an iron condor (sell call spread and put spread)
     * @param longPutSymbol Symbol of the lower strike put (long)
     * @param shortPutSymbol Symbol of the higher strike put (short)
     * @param shortCallSymbol Symbol of the lower strike call (short)
     * @param longCallSymbol Symbol of the higher strike call (long)
     * @param qty Quantity of iron condors to create (must be a whole number)
     * @param limitPrice Limit price for the iron condor (credit)
     * @returns The created multi-leg order
     */
    createIronCondor(longPutSymbol: string, shortPutSymbol: string, shortCallSymbol: string, longCallSymbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder>;
    /**
     * Create a covered call (sell call option against owned stock)
     * @param stockSymbol Symbol of the underlying stock
     * @param callOptionSymbol Symbol of the call option to sell
     * @param qty Quantity of covered calls to create (must be a whole number)
     * @param limitPrice Limit price for the call option
     * @returns The created order
     */
    createCoveredCall(stockSymbol: string, callOptionSymbol: string, qty: number, limitPrice: number): Promise<AlpacaOrder>;
    /**
     * Roll an option position to a new expiration or strike
     * @param currentOptionSymbol Symbol of the current option position
     * @param newOptionSymbol Symbol of the new option to roll to
     * @param qty Quantity of options to roll (must be a whole number)
     * @param currentPositionSide Side of the current position ('buy' or 'sell')
     * @param limitPrice Net limit price for the roll
     * @returns The created multi-leg order
     */
    rollOptionPosition(currentOptionSymbol: string, newOptionSymbol: string, qty: number, currentPositionSide: 'buy' | 'sell', limitPrice: number): Promise<AlpacaOrder>;
    /**
     * Get option chain for a specific underlying symbol and expiration date
     * @param underlyingSymbol The underlying stock symbol
     * @param expirationDate The expiration date (YYYY-MM-DD format)
     * @returns Option contracts for the specified symbol and expiration date
     */
    getOptionChain(underlyingSymbol: string, expirationDate: string): Promise<OptionContract[]>;
    /**
     * Get all available expiration dates for a specific underlying symbol
     * @param underlyingSymbol The underlying stock symbol
     * @returns Array of available expiration dates
     */
    getOptionExpirationDates(underlyingSymbol: string): Promise<string[]>;
    /**
     * Get the current options trading level for the account
     * @returns The options trading level (0-3)
     */
    getOptionsTradingLevel(): Promise<number>;
    /**
     * Check if the account has options trading enabled
     * @returns Boolean indicating if options trading is enabled
     */
    isOptionsEnabled(): Promise<boolean>;
    /**
     * Close all option positions
     * @param cancelOrders Whether to cancel related orders (default: true)
     * @returns Response from the close positions request
     */
    closeAllOptionPositions(cancelOrders?: boolean): Promise<void>;
    /**
     * Close a specific option position
     * @param symbol The option contract symbol
     * @param qty Optional quantity to close (defaults to entire position)
     * @returns The created order
     */
    closeOptionPosition(symbol: string, qty?: number): Promise<AlpacaOrder>;
    /**
     * Create a complete equities trade with optional stop loss and take profit
     * @param params Trade parameters including symbol, qty, side, and optional referencePrice
     * @param options Trade options including order type, extended hours, stop loss, and take profit settings
     * @returns The created order
     */
    createEquitiesTrade(params: {
        symbol: string;
        qty: number;
        side: 'buy' | 'sell';
        referencePrice?: number;
    }, options?: {
        type?: 'market' | 'limit';
        limitPrice?: number;
        extendedHours?: boolean;
        useStopLoss?: boolean;
        stopPrice?: number;
        stopPercent100?: number;
        useTakeProfit?: boolean;
        takeProfitPrice?: number;
        takeProfitPercent100?: number;
        clientOrderId?: string;
    }): Promise<AlpacaOrder>;
}
//# sourceMappingURL=alpaca-trading-api.d.ts.map