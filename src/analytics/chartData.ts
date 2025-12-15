import { db, schema } from '../db/client';
import { sql, eq, gte, lte, desc, and } from 'drizzle-orm';

// ============================================================================
// TypeScript Interfaces
// ============================================================================

type ChainName = 'ethereum' | 'polygon' | 'all';

interface TimeRangeParams {
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string;
  chain: ChainName;
}

interface TokenFilterParams extends TimeRangeParams {
  tokenId?: number | null;
}

interface TimeSeriesDataPoint {
  date: string;
  value: number;
}

interface HourlyHeatmapDataPoint {
  hour: number; // 0-23
  dayOfWeek: number; // 0-6 (Sunday=0)
  txCount: number;
}

interface TokenVolumeDataPoint {
  tokenId: number;
  symbol: string;
  totalVolume: number;
}

interface ActivityIntensityDataPoint {
  date: string;
  txCount: number;
  movingAvg: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to build WHERE conditions for dailyFlows queries
 */
function buildDailyFlowsConditions(params: TokenFilterParams) {
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.dailyFlows.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(gte(schema.dailyFlows.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.dailyFlows.date, params.endDate));
  }
  if (params.tokenId) {
    conditions.push(eq(schema.dailyFlows.tokenId, params.tokenId));
  }

  return conditions;
}

/**
 * Helper to build WHERE conditions for events queries
 */
function buildEventsConditions(params: TimeRangeParams) {
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.events.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(
      sql`date(${schema.events.blockTimestamp}, 'unixepoch') >= ${params.startDate}`
    );
  }
  if (params.endDate) {
    conditions.push(
      sql`date(${schema.events.blockTimestamp}, 'unixepoch') <= ${params.endDate}`
    );
  }

  return conditions;
}

// ============================================================================
// Chart Data Functions
// ============================================================================

/**
 * Fetches mean deposit amounts per day over time
 *
 * Data source: dailyFlows table
 * Calculation: SUM(totalDeposits) / SUM(depositTxCount) per day
 * Filters: time range, token, chain
 *
 * @param params - Time range and optional token filter
 * @returns Array of {date, value} for line chart
 */
export async function getMeanDepositAmountsOverTime(
  params: TokenFilterParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = buildDailyFlowsConditions(params);

  const results = await db.select({
    date: schema.dailyFlows.date,
    value: sql<number>`
      CAST(SUM(${schema.dailyFlows.totalDeposits}) AS REAL) /
      NULLIF(SUM(${schema.dailyFlows.depositTxCount}), 0)
    `,
  })
  .from(schema.dailyFlows)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(schema.dailyFlows.date)
  .orderBy(schema.dailyFlows.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}

/**
 * Fetches mean withdrawal amounts per day over time
 *
 * Data source: dailyFlows table
 * Calculation: SUM(totalWithdrawals) / SUM(withdrawalTxCount) per day
 * Filters: time range, token, chain
 *
 * @param params - Time range and optional token filter
 * @returns Array of {date, value} for line chart
 */
export async function getMeanWithdrawalAmountsOverTime(
  params: TokenFilterParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = buildDailyFlowsConditions(params);

  const results = await db.select({
    date: schema.dailyFlows.date,
    value: sql<number>`
      CAST(SUM(${schema.dailyFlows.totalWithdrawals}) AS REAL) /
      NULLIF(SUM(${schema.dailyFlows.withdrawalTxCount}), 0)
    `,
  })
  .from(schema.dailyFlows)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(schema.dailyFlows.date)
  .orderBy(schema.dailyFlows.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}

/**
 * Fetches total daily volume (deposits + withdrawals) over time
 *
 * Data source: dailyFlows table
 * Calculation: SUM(totalDeposits + totalWithdrawals) per day
 * Filters: time range, token, chain
 *
 * @param params - Time range and optional token filter
 * @returns Array of {date, value} for area chart
 */
export async function getDailyVolumeOverTime(
  params: TokenFilterParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = buildDailyFlowsConditions(params);

  const results = await db.select({
    date: schema.dailyFlows.date,
    value: sql<number>`SUM(${schema.dailyFlows.totalDeposits} + ${schema.dailyFlows.totalWithdrawals})`,
  })
  .from(schema.dailyFlows)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(schema.dailyFlows.date)
  .orderBy(schema.dailyFlows.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}

/**
 * Fetches Herfindahl-Hirschman Index (HHI) over time
 *
 * Data source: relayerStatsDaily table
 * HHI measures relayer concentration (0 = perfect competition, 1 = monopoly)
 * 0.15+ = moderate concentration, 0.25+ = high concentration
 * Filters: time range, chain (no token filter - system-wide metric)
 *
 * @param params - Time range and chain filter
 * @returns Array of {date, value} for line chart
 */
export async function getRelayerHHIOverTime(
  params: TimeRangeParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.relayerStatsDaily.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(gte(schema.relayerStatsDaily.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.relayerStatsDaily.date, params.endDate));
  }

  const results = await db.select({
    date: schema.relayerStatsDaily.date,
    value: schema.relayerStatsDaily.hhi,
  })
  .from(schema.relayerStatsDaily)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(schema.relayerStatsDaily.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}

/**
 * Fetches hourly activity heatmap data (hour × day-of-week)
 *
 * Data source: events table (queried directly for time-filtered heatmaps)
 * Uses SQLite strftime to extract hour and day-of-week from timestamps
 * Performance: With 68K events, query runs <100ms
 * Filters: time range, chain
 *
 * @param params - Time range and chain filter
 * @returns Array of {hour, dayOfWeek, txCount} for heatmap table
 */
export async function getHourlyActivityHeatmap(
  params: TimeRangeParams
): Promise<HourlyHeatmapDataPoint[]> {
  const conditions = buildEventsConditions(params);

  // Query events directly with hour and day-of-week extraction
  const results = await db.select({
    hour: sql<number>`CAST(strftime('%H', ${schema.events.blockTimestamp}, 'unixepoch') AS INTEGER)`,
    dayOfWeek: sql<number>`CAST(strftime('%w', ${schema.events.blockTimestamp}, 'unixepoch') AS INTEGER)`,
    txCount: sql<number>`count(*)`,
  })
  .from(schema.events)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(
    sql`strftime('%H', ${schema.events.blockTimestamp}, 'unixepoch')`,
    sql`strftime('%w', ${schema.events.blockTimestamp}, 'unixepoch')`
  );

  return results;
}

/**
 * Fetches daily transaction count with 7-day moving average
 *
 * Data source: dailyFlows table
 * Calculation: SUM(depositTxCount + withdrawalTxCount) per day
 * Moving average: Computed client-side for simplicity (7-day window)
 * Filters: time range, token, chain
 *
 * @param params - Time range and optional token filter
 * @returns Array of {date, txCount, movingAvg} for line chart
 */
export async function getActivityIntensityOverTime(
  params: TokenFilterParams
): Promise<ActivityIntensityDataPoint[]> {
  const conditions = buildDailyFlowsConditions(params);

  const results = await db.select({
    date: schema.dailyFlows.date,
    txCount: sql<number>`SUM(${schema.dailyFlows.depositTxCount} + ${schema.dailyFlows.withdrawalTxCount})`,
  })
  .from(schema.dailyFlows)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(schema.dailyFlows.date)
  .orderBy(schema.dailyFlows.date);

  // Compute 7-day moving average client-side
  const withMovingAvg = results.map((row, index) => {
    const window = results.slice(Math.max(0, index - 6), index + 1);
    const movingAvg = window.reduce((sum, r) => sum + r.txCount, 0) / window.length;

    return {
      date: row.date,
      txCount: row.txCount,
      movingAvg,
    };
  });

  return withMovingAvg;
}

/**
 * Fetches top N tokens by total volume for selected time range
 *
 * Data source: tokens JOIN dailyFlows
 * Calculation: SUM(totalDeposits + totalWithdrawals) per token
 * Filters: time range, chain, limit
 *
 * @param params - Time range, chain filter, and optional limit
 * @returns Array of {tokenId, symbol, totalVolume} for bar chart
 */
export async function getTopTokensByVolume(
  params: TimeRangeParams & { limit?: number }
): Promise<TokenVolumeDataPoint[]> {
  const limit = params.limit || 10;
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.dailyFlows.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(gte(schema.dailyFlows.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.dailyFlows.date, params.endDate));
  }

  const results = await db.select({
    tokenId: schema.tokens.id,
    symbol: schema.tokens.symbol,
    totalVolume: sql<number>`SUM(${schema.dailyFlows.totalDeposits} + ${schema.dailyFlows.totalWithdrawals})`,
  })
  .from(schema.tokens)
  .innerJoin(schema.dailyFlows, eq(schema.tokens.id, schema.dailyFlows.tokenId))
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(schema.tokens.id, schema.tokens.symbol)
  .orderBy(desc(sql`SUM(${schema.dailyFlows.totalDeposits} + ${schema.dailyFlows.totalWithdrawals})`))
  .limit(limit);

  return results.map(r => ({
    tokenId: r.tokenId,
    symbol: r.symbol || 'Unknown',
    totalVolume: r.totalVolume || 0,
  }));
}

/**
 * Fetches top N tokens by transaction count for selected time range
 *
 * Data source: tokens JOIN dailyFlows
 * Calculation: SUM(depositTxCount + withdrawalTxCount) per token
 * Filters: time range, chain, limit
 *
 * @param params - Time range, chain filter, and optional limit
 * @returns Array of {tokenId, symbol, totalTxCount} for bar chart
 */
export async function getTopTokensByTransactionCount(
  params: TimeRangeParams & { limit?: number }
): Promise<Array<{ tokenId: number; symbol: string; totalTxCount: number }>> {
  const limit = params.limit || 10;
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.dailyFlows.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(gte(schema.dailyFlows.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.dailyFlows.date, params.endDate));
  }

  const results = await db.select({
    tokenId: schema.tokens.id,
    symbol: schema.tokens.symbol,
    totalTxCount: sql<number>`SUM(${schema.dailyFlows.depositTxCount} + ${schema.dailyFlows.withdrawalTxCount})`,
  })
  .from(schema.tokens)
  .innerJoin(schema.dailyFlows, eq(schema.tokens.id, schema.dailyFlows.tokenId))
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(schema.tokens.id, schema.tokens.symbol)
  .orderBy(desc(sql`SUM(${schema.dailyFlows.depositTxCount} + ${schema.dailyFlows.withdrawalTxCount})`))
  .limit(limit);

  return results.map(r => ({
    tokenId: r.tokenId,
    symbol: r.symbol || 'Unknown',
    totalTxCount: r.totalTxCount || 0,
  }));
}

/**
 * Fetches active relayers count over time
 *
 * Data source: relayerStatsDaily.numActiveRelayers (pre-computed)
 * Shows number of unique relayers processing transactions daily
 * Filters: time range, chain
 *
 * @param params - Time range and chain filter
 * @returns Array of {date, value} for line chart
 */
export async function getActiveRelayersOverTime(
  params: TimeRangeParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.relayerStatsDaily.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(gte(schema.relayerStatsDaily.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.relayerStatsDaily.date, params.endDate));
  }

  const results = await db.select({
    date: schema.relayerStatsDaily.date,
    value: schema.relayerStatsDaily.numActiveRelayers,
  })
  .from(schema.relayerStatsDaily)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(schema.relayerStatsDaily.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}

/**
 * Fetches top 5 relayer market share over time
 *
 * Data source: relayerStatsDaily.top5Share (pre-computed, 0-1 scale)
 * Shows percentage of transaction volume handled by top 5 relayers
 * Filters: time range, chain
 *
 * @param params - Time range and chain filter
 * @returns Array of {date, value} for line chart (values are 0-1, display as percentage)
 */
export async function getTop5RelayerShareOverTime(
  params: TimeRangeParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.relayerStatsDaily.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(gte(schema.relayerStatsDaily.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.relayerStatsDaily.date, params.endDate));
  }

  const results = await db.select({
    date: schema.relayerStatsDaily.date,
    value: schema.relayerStatsDaily.top5Share,
  })
  .from(schema.relayerStatsDaily)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(schema.relayerStatsDaily.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}

/**
 * Fetches net flow (deposits - withdrawals) over time
 *
 * Data source: dailyFlows.netFlow (pre-computed)
 * Positive values indicate privacy pool growth, negative indicate shrinkage
 * Filters: time range, token, chain
 *
 * @param params - Time range and optional token filter
 * @returns Array of {date, value} for area chart
 */
export async function getNetFlowOverTime(
  params: TokenFilterParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = buildDailyFlowsConditions(params);

  const results = await db.select({
    date: schema.dailyFlows.date,
    value: sql<number>`SUM(${schema.dailyFlows.netFlow})`,
  })
  .from(schema.dailyFlows)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .groupBy(schema.dailyFlows.date)
  .orderBy(schema.dailyFlows.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}

/**
 * Fetches number of unique tokens per day over time
 *
 * Data source: dailyTokenDiversity table (pre-computed)
 * Shows ecosystem diversity and activity breadth
 * Filters: time range, chain
 *
 * @param params - Time range and chain filter
 * @returns Array of {date, value} for line chart
 */
export async function getTokenDiversityOverTime(
  params: TimeRangeParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = [];

  if (params.chain !== 'all') {
    conditions.push(eq(schema.dailyTokenDiversity.chain, params.chain));
  }
  if (params.startDate) {
    conditions.push(gte(schema.dailyTokenDiversity.date, params.startDate));
  }
  if (params.endDate) {
    conditions.push(lte(schema.dailyTokenDiversity.date, params.endDate));
  }

  const results = await db.select({
    date: schema.dailyTokenDiversity.date,
    value: schema.dailyTokenDiversity.uniqueTokenCount,
  })
  .from(schema.dailyTokenDiversity)
  .where(conditions.length > 0 ? and(...conditions) : undefined)
  .orderBy(schema.dailyTokenDiversity.date);

  return results.map(r => ({
    date: r.date,
    value: r.value || 0,
  }));
}
