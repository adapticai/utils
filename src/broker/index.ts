/**
 * Broker Module
 * Provider-agnostic broker client factory and contracts (SP2 multi-broker
 * seam). Only ALPACA is implemented today.
 *
 * @module @adaptic/utils/broker
 */

export {
  createBrokerClient,
  type BrokerClientConfig,
  type BrokerTradingClient,
  type BrokerValidatedCredentials,
} from "./factory";
