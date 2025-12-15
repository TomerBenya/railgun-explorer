import { sqliteTable, text, integer, real, primaryKey, unique } from 'drizzle-orm/sqlite-core';

// Key-value metadata store (for last_indexed_block_eth, last_indexed_block_polygon, etc.)
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// ERC-20 token metadata cache (chain-aware)
export const tokens = sqliteTable('tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chain: text('chain').notNull(), // 'ethereum', 'polygon', 'arbitrum'
  address: text('address').notNull(), // checksummed
  symbol: text('symbol'),
  decimals: integer('decimals'),
}, (table) => ({
  // Unique constraint: same address can exist on different chains
  chainAddressUnique: unique().on(table.chain, table.address),
}));

// Raw indexed events from Railgun contracts
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chain: text('chain').notNull(), // 'ethereum', 'polygon', 'arbitrum'
  txHash: text('tx_hash').notNull(),
  logIndex: integer('log_index').notNull(),
  blockNumber: integer('block_number').notNull(),
  blockTimestamp: integer('block_timestamp').notNull(), // Unix seconds
  contractName: text('contract_name').notNull(), // "SmartWallet" | "Relay"
  eventName: text('event_name').notNull(), // Raw ABI name
  eventType: text('event_type').notNull(), // "deposit" | "withdrawal" | "relayer_payment" | "other"
  tokenId: integer('token_id').references(() => tokens.id),
  rawAmountWei: text('raw_amount_wei'), // bigint as string
  amountNormalized: real('amount_normalized'),
  relayerAddress: text('relayer_address'),
  fromAddress: text('from_address'),
  toAddress: text('to_address'),
  metadataJson: text('metadata_json'), // JSON blob
}, (table) => ({
  // Idempotency constraint: same tx/log can exist on different chains
  txLogUnique: unique().on(table.chain, table.txHash, table.logIndex),
}));

// Pre-computed daily aggregates per token
export const dailyFlows = sqliteTable('daily_flows', {
  date: text('date').notNull(), // "YYYY-MM-DD"
  chain: text('chain').notNull(), // 'ethereum', 'polygon', 'arbitrum'
  tokenId: integer('token_id').notNull().references(() => tokens.id),
  totalDeposits: real('total_deposits').notNull().default(0),
  totalWithdrawals: real('total_withdrawals').notNull().default(0),
  netFlow: real('net_flow').notNull().default(0),
  depositTxCount: integer('deposit_tx_count').notNull().default(0),
  withdrawalTxCount: integer('withdrawal_tx_count').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.chain, table.tokenId] }),
}));

// Pre-computed daily relayer concentration metrics
export const relayerStatsDaily = sqliteTable('relayer_stats_daily', {
  date: text('date').notNull(), // "YYYY-MM-DD"
  chain: text('chain').notNull(), // 'ethereum', 'polygon', 'arbitrum'
  numActiveRelayers: integer('num_active_relayers').notNull().default(0),
  top5Share: real('top_5_share').notNull().default(0), // 0-1
  hhi: real('hhi').notNull().default(0), // sum of squared shares
  relayerTxCount: integer('relayer_tx_count').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.chain] }),
}));

// Pre-computed daily relayer fee revenue per relayer and token
export const relayerFeeRevenueDaily = sqliteTable('relayer_fee_revenue_daily', {
  date: text('date').notNull(), // "YYYY-MM-DD"
  chain: text('chain').notNull(), // 'ethereum', 'polygon', 'arbitrum'
  relayerAddress: text('relayer_address').notNull(),
  tokenId: integer('token_id').notNull().references(() => tokens.id),
  totalFeeWei: text('total_fee_wei').notNull(), // Total fees in wei (as string for bigint)
  totalFeeNormalized: real('total_fee_normalized').notNull().default(0), // Total fees normalized
  txCount: integer('tx_count').notNull().default(0), // Number of transactions
  avgFeeNormalized: real('avg_fee_normalized').notNull().default(0), // Average fee per transaction
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.chain, table.relayerAddress, table.tokenId] }),
}));

// Pre-computed daily token diversity metrics
export const dailyTokenDiversity = sqliteTable('daily_token_diversity', {
  date: text('date').notNull(), // "YYYY-MM-DD"
  chain: text('chain').notNull(),
  uniqueTokenCount: integer('unique_token_count').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.chain] }),
}));

// Type exports for use in application code
export type Metadata = typeof metadata.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type DailyFlow = typeof dailyFlows.$inferSelect;
export type RelayerStatsDaily = typeof relayerStatsDaily.$inferSelect;
export type RelayerFeeRevenueDaily = typeof relayerFeeRevenueDaily.$inferSelect;
export type DailyTokenDiversity = typeof dailyTokenDiversity.$inferSelect;
