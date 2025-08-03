import { createAlpacaTradingAPI } from './index';
import { TradeUpdate, AlpacaCredentials } from './types/alpaca-types';
import { marketDataAPI, AlpacaMarketDataAPI } from './alpaca-market-data-api';
import { formatCurrency, formatNumber } from './format-tools';

const log = (message: string) => {
  console.log(`[${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}] ${message}`);
};

// async function testCreateEquitiesTrade() {
//   try {
//     log('Starting createEquitiesTrade test...');

//     // Create credentials using environment variables
//     const credentials: AlpacaCredentials = {
//       accountName: 'test',
//       apiKey: process.env.ALPACA_API_KEY || '',
//       apiSecret: process.env.ALPACA_SECRET_KEY || '',
//       type: 'PAPER',
//       orderType: 'market',
//       engine: 'quant'
//     };

//     if (!credentials.apiKey || !credentials.apiSecret) {
//       throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables must be set');
//     }

//     // Create a new instance of the trading API
//     const alpacaAPI = createAlpacaTradingAPI(credentials);
    
//     // Get current account details
//     const accountDetails = await alpacaAPI.getAccountDetails();
//     log(`Account equity: $${parseFloat(accountDetails.equity).toFixed(2)}`);
//     log(`Buying power: $${parseFloat(accountDetails.buying_power).toFixed(2)}`);

//     const testSymbols = ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA', 'META', 'AMZN']; // Multiple symbols to avoid wash trade detection
//     const referencePrice = 150.00; // Mock reference price for testing

//     log('=== Testing createEquitiesTrade function ===');

//     // Test 1: Simple market order (long position)
//     log('\n1. Testing simple market order (long)...');
//     try {
//       const order1 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[0], qty: 1, side: 'buy' }
//       );
//       log(`✅ Created simple market buy order: ${order1.id}`);
//     } catch (error) {
//       log(`❌ Failed to create simple market order: ${error}`);
//     }

//     // Test 2: Simple market order (short position)
//     log('\n2. Testing simple market order (short)...');
//     try {
//       const order2 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[1], qty: 1, side: 'sell' }
//       );
//       log(`✅ Created simple market sell order: ${order2.id}`);
//     } catch (error) {
//       log(`❌ Failed to create simple market sell order: ${error}`);
//     }

//     // Test 3: Limit order with percentage-based stop loss (long)
//     log('\n3. Testing limit order with percentage-based stop loss (long)...');
//     try {
//       const order3 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[2], qty: 1, side: 'buy', referencePrice },
//         {
//           type: 'limit',
//           limitPrice: 149.50,
//           useStopLoss: true,
//           stopPercent100: 3.0 // 3% stop loss
//         }
//       );
//       log(`✅ Created limit buy order with stop loss: ${order3.id}`);
//     } catch (error) {
//       log(`❌ Failed to create limit order with stop loss: ${error}`);
//     }

//     // Test 4: Limit order with percentage-based take profit (short)
//     log('\n4. Testing limit order with percentage-based take profit (short)...');
//     try {
//       const order4 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[3], qty: 1, side: 'sell', referencePrice },
//         {
//           type: 'limit',
//           limitPrice: 150.50,
//           useTakeProfit: true,
//           takeProfitPercent100: 2.5 // 2.5% take profit
//         }
//       );
//       log(`✅ Created limit sell order with take profit: ${order4.id}`);
//     } catch (error) {
//       log(`❌ Failed to create limit order with take profit: ${error}`);
//     }

//     // Test 5: Bracket order with both stop loss and take profit (long)
//     log('\n5. Testing bracket order with both stop loss and take profit (long)...');
//     try {
//       const order5 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[4], qty: 1, side: 'buy', referencePrice },
//         {
//           type: 'limit',
//           limitPrice: 149.00,
//           useStopLoss: true,
//           stopPercent100: 4.0, // 4% stop loss
//           useTakeProfit: true,
//           takeProfitPercent100: 6.0 // 6% take profit
//         }
//       );
//       log(`✅ Created bracket order (long): ${order5.id}`);
//     } catch (error) {
//       log(`❌ Failed to create bracket order: ${error}`);
//     }

//     // Test 6: Bracket order with fixed prices (short)
//     log('\n6. Testing bracket order with fixed prices (short)...');
//     try {
//       const order6 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[5], qty: 1, side: 'sell' },
//         {
//           type: 'limit',
//           limitPrice: 151.00,
//           useStopLoss: true,
//           stopPrice: 155.00, // Fixed stop price
//           useTakeProfit: true,
//           takeProfitPrice: 145.00 // Fixed take profit price
//         }
//       );
//       log(`✅ Created bracket order with fixed prices (short): ${order6.id}`);
//     } catch (error) {
//       log(`❌ Failed to create bracket order with fixed prices: ${error}`);
//     }

//     // Test 7: Extended hours limit order
//     log('\n7. Testing extended hours limit order...');
//     try {
//       const order7 = await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[6], qty: 1, side: 'buy' },
//         {
//           type: 'limit',
//           limitPrice: 148.00,
//           extendedHours: true
//         }
//       );
//       log(`✅ Created extended hours limit order: ${order7.id}`);
//     } catch (error) {
//       log(`❌ Failed to create extended hours order: ${error}`);
//     }

//     // Test 8: Error condition - market order with extended hours (should fail)
//     log('\n8. Testing error condition - market order with extended hours (should fail)...');
//     try {
//       await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[0], qty: 1, side: 'buy' },
//         {
//           type: 'market',
//           extendedHours: true // This should trigger an error
//         }
//       );
//       log(`❌ Unexpected success - should have failed!`);
//     } catch (error) {
//       log(`✅ Correctly caught error: ${error instanceof Error ? error.message : error}`);
//     }

//     // Test 9: Error condition - missing referencePrice for percentage (should fail)
//     log('\n9. Testing error condition - missing referencePrice for percentage (should fail)...');
//     try {
//       await alpacaAPI.createEquitiesTrade(
//         { symbol: testSymbols[0], qty: 1, side: 'buy' }, // No referencePrice
//         {
//           useStopLoss: true,
//           stopPercent100: 3.0 // Requires referencePrice
//         }
//       );
//       log(`❌ Unexpected success - should have failed!`);
//     } catch (error) {
//       log(`✅ Correctly caught error: ${error instanceof Error ? error.message : error}`);
//     }

//     // Wait a moment for all orders to process
//     await new Promise(resolve => setTimeout(resolve, 2000));

//     // Get all orders to see what was created
//     log('\n=== Checking created orders ===');
//     const orders = await alpacaAPI.getOrders({ status: 'open', limit: 20 });
//     log(`Found ${orders.length} open orders`);
    
//     orders.forEach((order, index) => {
//       log(`Order ${index + 1}: ${order.order_class} ${order.type} ${order.side} ${order.qty} ${order.symbol} @ $${order.limit_price || 'market'}`);
//       if (order.legs && order.legs.length > 0) {
//         log(`  Stop Loss: $${order.legs.find(leg => leg.type === 'stop')?.stop_price || 'N/A'}`);
//         log(`  Take Profit: $${order.legs.find(leg => leg.type === 'limit')?.limit_price || 'N/A'}`);
//       }
//     });

//     // Cancel all orders to clean up
//     log('\n=== Cleaning up - canceling all orders ===');
//     await alpacaAPI.cancelAllOrders();
//     log('✅ All orders canceled');

//     log('\n=== Test completed successfully! ===');

//   } catch (error) {
//     log(`❌ Error in createEquitiesTrade test: ${error instanceof Error ? error.message : 'Unknown error'}`);
//     process.exit(1);
//   }
// }

// async function testAlpacaWebSocket() {
//   try {
//     log('Starting Alpaca WebSocket test...');

//     // Create credentials using environment variables
//     const credentials: AlpacaCredentials = {
//       accountName: 'test',
//       apiKey: process.env.ALPACA_API_KEY || '',
//       apiSecret: process.env.ALPACA_SECRET_KEY || '',
//       type: 'PAPER',
//       orderType: 'market',
//       engine: 'quant'
//     };

//     if (!credentials.apiKey || !credentials.apiSecret) {
//       throw new Error('ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables must be set');
//     }

//     // Create a new instance of the trading API
//     const alpacaAPI = createAlpacaTradingAPI(credentials); // type AlpacaCredentials
//     // Set up trade update callback
//     alpacaAPI.onTradeUpdate((update: TradeUpdate) => {
//       log(`Received trade update: event ${update.event} for an order to ${update.order.side} ${update.order.qty} of ${update.order.symbol}`);
//     });
//     // Connect to WebSocket
//     alpacaAPI.connectWebsocket(); // necessary to connect to the WebSocket

//     // create an order
//     const order = await alpacaAPI.createMarketOrder('AAPL', 1, 'buy', 'buy_to_open');
//     // cancel the order
//     await alpacaAPI.cancelAllOrders();

//     // Keep the process running
//     log('WebSocket connected and listening for trade updates...');
//     log('Press Ctrl+C to exit');

//     // Keep the process running
//     await new Promise(() => {});
//   } catch (error) {
//     log(`Error in WebSocket test: ${error instanceof Error ? error.message : 'Unknown error'}`);
//     process.exit(1);
//   }
// }

// // Run the test
// testAlpacaWebSocket();

// Run the createEquitiesTrade test
//testCreateEquitiesTrade();

// testing retrieving pre-market data (just 9:00am to 9:30am on 1 july 2025 for SPY) using the market data api

async function testPreMarketData() {
  try {
    log('Starting pre-market data test for SPY (9:00am-9:30am, July 1, 2025)...');
    // Set up the time range in America/New_York, convert to UTC ISO strings
    const symbol = 'SPY';
    const nyTimeZone = 'America/New_York';
    // 9:00am and 9:30am in NY time
    const startNY = new Date('2025-07-01T09:00:00-04:00');
    const endNY = new Date('2025-07-01T09:30:00-04:00');
    const startUTC = startNY.toISOString();
    const endUTC = endNY.toISOString();

    const barsResponse = await marketDataAPI.getHistoricalBars({
      symbols: [symbol],
      timeframe: '1Min',
      start: startUTC,
      end: endUTC,
      limit: 1000,
    });
    const bars = barsResponse.bars[symbol] || [];
    log(`Fetched ${bars.length} 1-min bars for SPY from 9:00am to 9:30am (NY) on 2025-07-01.`);
    if (bars.length === 0) {
      log('No pre-market bars returned.');
      return;
    }
    // Print each bar
    bars.forEach((bar, i) => {
      const barTime = new Date(bar.t).toLocaleString('en-US', { timeZone: nyTimeZone });
      log(
        `Bar ${i + 1}: ${barTime} | O: ${formatCurrency(bar.o)} H: ${formatCurrency(bar.h)} L: ${formatCurrency(bar.l)} C: ${formatCurrency(bar.c)} V: ${formatNumber(bar.v)} VWAP: ${formatCurrency(bar.vw)} N: ${bar.n}`
      );
    });
    // Print summary
    const summary = AlpacaMarketDataAPI.analyzeBars(bars);
    if (summary) log(`Summary: ${summary}`);
    log('Pre-market data test complete.');
  } catch (error) {
    log(`❌ Error in testPreMarketData: ${error instanceof Error ? error.message : error}`);
  }
}

testPreMarketData();