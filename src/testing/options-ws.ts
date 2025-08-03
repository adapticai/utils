import { marketDataAPI } from '../alpaca-market-data-api';
import { AlpacaOptionTradeStream, AlpacaOptionQuoteStream } from '../types/alpaca-types';

async function testOptions() {
  console.log('Starting Options WebSocket test...');

  // NOTE: Replace with a valid and currently trading option symbol
  const optionSymbol = 'SPY251219C00700000'; 

  marketDataAPI.on('option-t', (trade: AlpacaOptionTradeStream) => {
    console.log(`Received option trade for ${trade.S}: Price=${trade.p}, Size=${trade.s}`);
  });

  marketDataAPI.on('option-q', (quote: AlpacaOptionQuoteStream) => {
    console.log(`Received option quote for ${quote.S}: Ask=${quote.ap}, Bid=${quote.bp}`);
  });

  marketDataAPI.connectOptionStream();

  // Need to wait for authentication before subscribing
  setTimeout(() => {
    marketDataAPI.subscribe('option', {
      trades: [optionSymbol],
      quotes: [optionSymbol],
    });
  }, 2000); // Wait 2 seconds for connection and authentication

  // Disconnect after 15 seconds
  setTimeout(() => {
    console.log('Disconnecting from options stream...');
    marketDataAPI.disconnectOptionStream();
  }, 15000);
}

testOptions(); 