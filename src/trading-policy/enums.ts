/**
 * Mirror enums for the trading policy preference system.
 * These enums are used by both the trading engine and the frontend app
 * for shared validation and type safety across packages.
 */

/** Controls the level of automation for trade execution decisions. */
export enum AutonomyMode {
  ADVISORY_ONLY = 'ADVISORY_ONLY',
  EXECUTION_ON_APPROVAL = 'EXECUTION_ON_APPROVAL',
  SEMI_AUTONOMOUS = 'SEMI_AUTONOMOUS',
  FULLY_AUTONOMOUS = 'FULLY_AUTONOMOUS',
  EMERGENCY_SAFE_MODE = 'EMERGENCY_SAFE_MODE',
}

/** Categorizes protective overlay triggers that modify trading behavior. */
export enum OverlayType {
  BLACK_SWAN = 'BLACK_SWAN',
  VOLATILITY_REGIME = 'VOLATILITY_REGIME',
  SECTOR_DETERIORATION = 'SECTOR_DETERIORATION',
  DRAWDOWN_BREACH = 'DRAWDOWN_BREACH',
  CORRELATION_SPIKE = 'CORRELATION_SPIKE',
  LIQUIDITY_STRESS = 'LIQUIDITY_STRESS',
  EXCHANGE_DEGRADATION = 'EXCHANGE_DEGRADATION',
  DATA_QUALITY = 'DATA_QUALITY',
  NEWS_EVENT_RISK = 'NEWS_EVENT_RISK',
  RATES_BONDS_STRESS = 'RATES_BONDS_STRESS',
  MANUAL_OVERRIDE = 'MANUAL_OVERRIDE',
  INCIDENT_RESPONSE = 'INCIDENT_RESPONSE',
}

/** Severity level for an active overlay. */
export enum OverlaySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** Lifecycle status of an overlay instance. */
export enum OverlayStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  DEACTIVATED = 'DEACTIVATED',
  SUPERSEDED = 'SUPERSEDED',
}

/** The action outcome chosen by the decision engine for a given signal. */
export enum DecisionOutcome {
  DO_NOTHING = 'DO_NOTHING',
  OPEN_POSITION = 'OPEN_POSITION',
  ADD_TO_POSITION = 'ADD_TO_POSITION',
  REDUCE_POSITION = 'REDUCE_POSITION',
  CLOSE_POSITION = 'CLOSE_POSITION',
  REVERSE_POSITION = 'REVERSE_POSITION',
  MODIFY_ORDERS = 'MODIFY_ORDERS',
  CANCEL_ORDERS = 'CANCEL_ORDERS',
  REBALANCE = 'REBALANCE',
  MUTATE_POLICY = 'MUTATE_POLICY',
  ESCALATE_FOR_APPROVAL = 'ESCALATE_FOR_APPROVAL',
  SKIP_INELIGIBLE = 'SKIP_INELIGIBLE',
}

/** Tracks the execution lifecycle of a decision record. */
export enum DecisionRecordStatus {
  PENDING = 'PENDING',
  EXECUTING = 'EXECUTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  ESCALATED = 'ESCALATED',
}

/** Tracks the P&L outcome of a decision for memory/learning purposes. */
export enum DecisionMemoryOutcome {
  PENDING = 'PENDING',
  PROFITABLE = 'PROFITABLE',
  UNPROFITABLE = 'UNPROFITABLE',
  STOPPED_OUT = 'STOPPED_OUT',
  CANCELLED = 'CANCELLED',
}

/** Supported LLM providers for model-based decision making. */
export enum LlmProvider {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  DEEPSEEK = 'DEEPSEEK',
  KIMI = 'KIMI',
  QWEN = 'QWEN',
  XAI = 'XAI',
  GEMINI = 'GEMINI',
}
