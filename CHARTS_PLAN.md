# Railgun Charts Dashboard - Implementation Plan

## Overview

This document contains the complete implementation plan for the `/charts` route in the Railgun Transparency Dashboard. The plan is based on real data analysis from Phase 0 (68,358 events, 209 tokens).

**Status**: Phase 0 ✅ Complete | Phases 1-5 Ready for Implementation

---

## Table of Contents

1. [Phase 0: Database Seeding (COMPLETE)](#phase-0-database-seeding-complete)
2. [Revised Implementation Plan (Phases 1-5)](#revised-implementation-plan-phases-1-5)
3. [Phase 1: Minimal Schema Extensions](#phase-1-minimal-schema-extensions)
4. [Phase 2: Data Access Layer](#phase-2-data-access-layer)
5. [Phase 3: Charts Page UI Implementation](#phase-3-charts-page-ui-implementation)
6. [Phase 4: Performance Optimization](#phase-4-performance-optimization)
7. [Phase 5: Code Quality & Documentation](#phase-5-code-quality--documentation)
8. [Summary & Success Criteria](#summary--success-criteria)

---

## Chart Specifications

### Critical UI Components

1. **Time Range Selector** (dropdown, global):
   - 7 days
   - 30 days
   - 90 days
   - All time (default)

2. **Token Filter** (dropdown for applicable charts):
   - All tokens aggregated (default)
   - Individual token selection

### Charts by Priority

**Priority 1 - Core Metrics:**
1. Mean deposit amount over time (line chart) - supports aggregate + per-token
2. Mean withdrawal amount over time (line chart) - supports aggregate + per-token
3. Daily volume (deposits + withdrawals) (area/stacked line chart)
4. Relayer concentration HHI over time (line chart)

**Priority 2 - Activity Patterns:**
5. Hourly activity heatmap (hour-of-day × day-of-week, transaction count)
6. Activity intensity over time (line chart: daily tx count + 7-day moving average overlay)

**Priority 3 - Token Analytics:**
7. Top 10 tokens by volume (horizontal bar chart for selected time range)
8. Token diversity over time (line chart: unique tokens per day)

**Rendering:**
- Client-side Chart.js (consistent with existing `/charts` implementation)
- Data embedded in page via JSON script tag
- HTML table for heatmap (simpler, more accessible)

---

## Phase 0: Database Seeding (COMPLETE)

### ✅ Completed Tasks

**File Created**: [`src/db/seedFromJson.ts`](src/db/seedFromJson.ts)

**Implementation:**
1. ✅ Read `events-all.json` (41MB, 68,358 events)
2. ✅ Extract unique tokens by (chain, address, symbol)
3. ✅ Calculate decimals: `Math.round(Math.log10(Number(rawAmountWei) / amountNormalized))`
4. ✅ Insert tokens with `onConflictDoNothing()`
5. ✅ Batch insert events (1000 per transaction) with tokenId lookups
6. ✅ Handle checksummed addresses (use viem's `getAddress()`)
7. ✅ Log progress and statistics

**Script Added**: `"db:seed": "bun run src/db/seedFromJson.ts"`

### Key Findings from Real Data

- **Total Events**: 68,358 (Ethereum: 33,538 | Polygon: 34,820)
- **Date Ranges**:
  - Ethereum: 1,018 days (2023-02-24 to 2025-12-08)
  - Polygon: 48 days (2025-07-10 to 2025-08-27)
- **Event Distribution**: 97.8% withdrawals, 2.2% deposits
- **Unique Tokens**: 209 (Ethereum: 177 | Polygon: 32)
- **Analytics Tables**: dailyFlows (1,067 rows), relayerStatsDaily (1,013 rows)

### Architecture Insights

1. ✅ **68K events is manageable** - No need for aggressive pre-computation
2. ⚠️ **Heatmap table flaw confirmed** - Original `hourlyActivityStats` lacks date dimension
3. ✅ **Query performance acceptable** - Direct event queries will be fast enough
4. ⚠️ **Polygon data sparse** - Only 48 days vs Ethereum's 1,018 days

---

## Revised Implementation Plan (Phases 1-5)

### Major Changes from Original Plan

1. **✂️ REMOVE `hourlyActivityStats` table**
   - **Why**: Lacks date dimension, can't support time-filtered heatmaps
   - **Solution**: Query `events` table directly with date filters
   - **Performance**: 68K events is small enough for real-time queries

2. **✅ KEEP `dailyTokenDiversity` table**
   - **Why**: `COUNT(DISTINCT tokenId)` per day is expensive to compute on-the-fly
   - **Benefit**: Pre-computation makes sense for this metric

3. **📊 Account for Data Characteristics**:
   - Handle Ethereum's 1,018 days vs Polygon's 48 days gracefully
   - Charts must work with withdrawal-heavy data (97.8%)
   - Token filter relevance varies (Ethereum: 177 tokens, Polygon: 32 tokens)

### Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| ✂️ **Skip `hourlyActivityStats` table** | Original design lacked date dimension; can't support time-filtered heatmaps |
| ⚡ **Query events directly for heatmap** | 68K events is small enough; query with date filters is fast (<100ms) |
| ✅ **Keep `dailyTokenDiversity` table** | `COUNT(DISTINCT tokenId)` per day is expensive; pre-computation makes sense |
| 📊 **Client-side moving average** | Simple 7-day window computation; no need for SQL window functions |
| 🎯 **Parallel data fetching** | 8 concurrent queries reduce page load time significantly |

---

## Phase 1: Minimal Schema Extensions

**Goal**: Add ONLY the `dailyTokenDiversity` table (skip `hourlyActivityStats`)

**Time Estimate**: 1-2 hours

### 1.1 Schema Update

**File**: [`src/db/schema.ts`](src/db/schema.ts)

**New Table**:
```typescript
export const dailyTokenDiversity = sqliteTable('daily_token_diversity', {
  date: text('date').notNull(), // "YYYY-MM-DD"
  chain: text('chain').notNull(),
  uniqueTokenCount: integer('unique_token_count').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.chain] }),
}));

export type DailyTokenDiversity = typeof dailyTokenDiversity.$inferSelect;
```

### 1.2 Analytics Script

**File**: `src/analytics/tokenDiversity.ts` (NEW)

```typescript
import { db, schema } from '../db/client';
import { sql } from 'drizzle-orm';

async function computeTokenDiversity() {
  console.log('Computing daily token diversity...');

  // Clear existing data
  await db.delete(schema.dailyTokenDiversity);

  // Query events with COUNT(DISTINCT tokenId) per date per chain
  const diversity = await db.select({
    date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`,
    chain: schema.events.chain,
    uniqueTokenCount: sql<number>`count(distinct ${schema.events.tokenId})`,
  })
  .from(schema.events)
  .where(sql`${schema.events.tokenId} is not null`)
  .groupBy(
    sql`date(${schema.events.blockTimestamp}, 'unixepoch')`,
    schema.events.chain
  );

  let inserted = 0;
  for (const row of diversity) {
    await db.insert(schema.dailyTokenDiversity).values({
      date: row.date,
      chain: row.chain || 'ethereum',
      uniqueTokenCount: row.uniqueTokenCount || 0,
    });
    inserted++;
  }

  console.log(`Token diversity computed: ${inserted} rows inserted`);
}

computeTokenDiversity().catch(console.error);
```

### 1.3 Update package.json

```json
"analytics": "bun run analytics:flows && bun run analytics:relayers && bun run analytics:diversity",
"analytics:diversity": "bun run src/analytics/tokenDiversity.ts"
```

### 1.4 Run Commands

```bash
bun run db:generate
bun run db:migrate
bun run analytics:diversity
```

### 1.5 Validation

- Verify `dailyTokenDiversity` has ~1,066 rows (matching dailyFlows row count)
- Sample query to check data quality
- Confirm date ranges match event data

---

## Phase 2: Data Access Layer

**Goal**: Implement 8 chart data fetching functions

**Time Estimate**: 4-5 hours

**File**: `src/analytics/chartData.ts` (NEW)

### 2.1 TypeScript Interfaces

```typescript
import { db, schema } from '../db/client';
import { sql, eq, gte, lte, desc, and } from 'drizzle-orm';

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
```

### 2.2 Helper Function

```typescript
/**
 * Helper to build WHERE conditions for dailyFlows queries
 */
function buildConditions(params: TokenFilterParams) {
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
```

### 2.3 Chart Data Functions

#### Function 1: getMeanDepositAmountsOverTime()

**Data Source**: `dailyFlows` table
**Query Complexity**: Low (simple aggregation)
**Filters**: time range, token, chain

```typescript
/**
 * Fetches mean deposit amounts per day over time
 * @param params - Time range and optional token filter
 * @returns Array of {date, value} for line chart
 */
export async function getMeanDepositAmountsOverTime(
  params: TokenFilterParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = buildConditions(params);

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
```

#### Function 2: getMeanWithdrawalAmountsOverTime()

**Data Source**: `dailyFlows` table
**Query Complexity**: Low
**Filters**: time range, token, chain

```typescript
/**
 * Fetches mean withdrawal amounts per day over time
 * @param params - Time range and optional token filter
 * @returns Array of {date, value} for line chart
 */
export async function getMeanWithdrawalAmountsOverTime(
  params: TokenFilterParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = buildConditions(params);

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
```

#### Function 3: getDailyVolumeOverTime()

**Data Source**: `dailyFlows` table
**Query Complexity**: Low
**Filters**: time range, token, chain

```typescript
/**
 * Fetches total daily volume (deposits + withdrawals) over time
 * @param params - Time range and optional token filter
 * @returns Array of {date, value} for area chart
 */
export async function getDailyVolumeOverTime(
  params: TokenFilterParams
): Promise<TimeSeriesDataPoint[]> {
  const conditions = buildConditions(params);

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
```

#### Function 4: getRelayerHHIOverTime()

**Data Source**: `relayerStatsDaily` table
**Query Complexity**: Low (direct SELECT)
**Filters**: time range, chain
**Note**: No token filter (relayer stats are system-wide)

```typescript
/**
 * Fetches Herfindahl-Hirschman Index (HHI) over time
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
```

#### Function 5: getHourlyActivityHeatmap() ⚡ REVISED

**🔄 MAJOR CHANGE**: Query `events` table directly instead of pre-computed table

**Data Source**: `events` table (68K rows - fast enough)
**Query Complexity**: Medium (requires STRFTIME + GROUP BY)
**Filters**: time range, chain
**Performance**: With 68K events and indexes, query will be <100ms
**Benefit**: Properly respects time range filter!

```typescript
/**
 * Fetches hourly activity heatmap data (hour × day-of-week)
 * @param params - Time range and chain filter
 * @returns Array of {hour, dayOfWeek, txCount} for heatmap table
 */
export async function getHourlyActivityHeatmap(
  params: TimeRangeParams
): Promise<HourlyHeatmapDataPoint[]> {
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
```

#### Function 6: getActivityIntensityOverTime()

**Data Source**: `dailyFlows` table
**Query Complexity**: Low (aggregation) + Client-side moving average
**Filters**: time range, token, chain
**Note**: 7-day moving average computed client-side for simplicity

```typescript
/**
 * Fetches daily transaction count with 7-day moving average
 * @param params - Time range and optional token filter
 * @returns Array of {date, txCount, movingAvg} for line chart
 */
export async function getActivityIntensityOverTime(
  params: TokenFilterParams
): Promise<Array<{ date: string; txCount: number; movingAvg: number }>> {
  const conditions = buildConditions(params);

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
```

#### Function 7: getTopTokensByVolume()

**Data Source**: `tokens` + `dailyFlows` (JOIN)
**Query Complexity**: Medium (JOIN + aggregation)
**Filters**: time range, chain, limit

```typescript
/**
 * Fetches top N tokens by total volume for selected time range
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
```

#### Function 8: getTokenDiversityOverTime()

**Data Source**: `dailyTokenDiversity` table (pre-computed)
**Query Complexity**: Low (direct SELECT)
**Filters**: time range, chain

```typescript
/**
 * Fetches number of unique tokens per day over time
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
```

### 2.4 Validation

- Test each function with various filter combinations
- Verify data accuracy against raw queries
- Test edge cases (empty data, single day, etc.)
- Performance test with full date ranges

---

## Phase 3: Charts Page UI Implementation

**Goal**: Expand `/charts` route with all 8 visualizations

**Time Estimate**: 6-8 hours

**File**: [`src/web/app.tsx`](src/web/app.tsx) (expand `/charts` route)

### 3.1 Query Parameter Parsing

```typescript
app.get('/charts', async (c) => {
  const chain = getChainFromQuery(c);
  const timeRange = (c.req.query('timeRange') as '7d'|'30d'|'90d'|'all') || 'all';
  const tokenIdStr = c.req.query('tokenId');
  const tokenId = tokenIdStr ? parseInt(tokenIdStr) : null;

  // Convert time range to dates
  const dateRange = getDateRangeFromTimeRange(timeRange);
  const commonParams = { chain, ...dateRange };
  const tokenParams = { ...commonParams, tokenId };

  // ... fetch data and render
});

function getDateRangeFromTimeRange(range: string) {
  if (range === 'all') return {};

  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  const daysAgo = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  now.setDate(now.getDate() - daysAgo);

  return {
    startDate: now.toISOString().split('T')[0],
    endDate,
  };
}
```

### 3.2 Parallel Data Fetching

```typescript
const [
  meanDeposits,
  meanWithdrawals,
  dailyVolume,
  relayerHHI,
  hourlyActivity,
  activityIntensity,
  topTokens,
  tokenDiversity,
  allTokens,
] = await Promise.all([
  getMeanDepositAmountsOverTime(tokenParams),
  getMeanWithdrawalAmountsOverTime(tokenParams),
  getDailyVolumeOverTime(tokenParams),
  getRelayerHHIOverTime(commonParams),
  getHourlyActivityHeatmap(commonParams), // ⚡ Now supports time filtering!
  getActivityIntensityOverTime(tokenParams),
  getTopTokensByVolume({ ...commonParams, limit: 10 }),
  getTokenDiversityOverTime(commonParams),
  fetchAllTokensForDropdown(chain),
]);
```

### 3.3 Chart Data Preparation

```typescript
const chartData = {
  meanAmounts: {
    labels: meanDeposits.map(d => d.date),
    deposits: meanDeposits.map(d => d.value),
    withdrawals: meanWithdrawals.map(d => d.value),
  },
  volume: {
    labels: dailyVolume.map(d => d.date),
    values: dailyVolume.map(d => d.value),
  },
  hhi: {
    labels: relayerHHI.map(d => d.date),
    values: relayerHHI.map(d => d.value),
  },
  heatmap: hourlyActivity, // Array of {hour, dayOfWeek, txCount}
  intensity: {
    labels: activityIntensity.map(d => d.date),
    actual: activityIntensity.map(d => d.txCount),
    movingAvg: activityIntensity.map(d => d.movingAvg),
  },
  topTokens: {
    labels: topTokens.map(t => t.symbol),
    values: topTokens.map(t => t.totalVolume),
  },
  diversity: {
    labels: tokenDiversity.map(d => d.date),
    values: tokenDiversity.map(d => d.value),
  },
};
```

### 3.4 Filter Bar Component

```tsx
function ChartsFilterBar({ chain, timeRange, tokenId, tokens }) {
  return (
    <div class="filter-bar">
      <form method="get" action="/charts" class="filter-form">
        <input type="hidden" name="chain" value={chain} />

        <div class="filter-group">
          <label for="timeRange">Time Range:</label>
          <select name="timeRange" id="timeRange" class="filter-select">
            <option value="7d" selected={timeRange==='7d'}>Last 7 Days</option>
            <option value="30d" selected={timeRange==='30d'}>Last 30 Days</option>
            <option value="90d" selected={timeRange==='90d'}>Last 90 Days</option>
            <option value="all" selected={timeRange==='all'}>All Time</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="tokenId">Token Filter (for applicable charts):</label>
          <select name="tokenId" id="tokenId" class="filter-select">
            <option value="" selected={!tokenId}>All Tokens (Aggregated)</option>
            {tokens.map(t => (
              <option value={t.id} selected={t.id===tokenId}>
                {t.symbol || 'Unknown'}
              </option>
            ))}
          </select>
        </div>

        <button type="submit" class="filter-btn">Apply Filters</button>
        <a href={`/charts?chain=${chain}`} class="filter-btn filter-btn-reset">Reset</a>
      </form>
    </div>
  );
}
```

### 3.5 Chart Sections Layout

```tsx
return c.render(
  <section>
    <h2>Charts Dashboard <span class="chain-badge">{getChainLabel(chain)}</span></h2>
    <p>Comprehensive visual analytics for Railgun aggregate flows and metrics.</p>

    <ChartsFilterBar
      chain={chain}
      timeRange={timeRange}
      tokenId={tokenId}
      tokens={allTokens}
    />

    {/* Priority 1: Core Metrics */}
    <h3>Core Metrics</h3>

    <div class="chart-section">
      <h4>Mean Deposit & Withdrawal Amounts Over Time</h4>
      <p class="chart-description">
        {tokenId ? `Filtered to ${allTokens.find(t => t.id === tokenId)?.symbol || 'selected token'}` : 'All tokens aggregated'}
      </p>
      <div class="chart-container">
        <canvas id="meanAmountsChart"></canvas>
      </div>
    </div>

    <div class="chart-section">
      <h4>Daily Volume (Deposits + Withdrawals)</h4>
      <p class="chart-description">
        Total transaction volume per day. {tokenId ? 'Token filtered.' : 'All tokens aggregated.'}
      </p>
      <div class="chart-container">
        <canvas id="volumeChart"></canvas>
      </div>
    </div>

    <div class="chart-section">
      <h4>Relayer Concentration (HHI) Over Time</h4>
      <p class="chart-description">
        Herfindahl-Hirschman Index measures relayer concentration.
        0.15+ = moderate, 0.25+ = high concentration.
      </p>
      <div class="chart-container">
        <canvas id="hhiChart"></canvas>
      </div>
    </div>

    {/* Priority 2: Activity Patterns */}
    <h3>Activity Patterns</h3>

    <div class="chart-section">
      <h4>Hourly Activity Heatmap (Hour × Day of Week)</h4>
      <p class="chart-description">
        Transaction distribution by hour of day and day of week.
        {timeRange === 'all' ? 'Showing all-time data.' : `Filtered to ${timeRange}.`}
      </p>
      <div class="chart-container chart-heatmap">
        {renderHeatmapTable(hourlyActivity)}
      </div>
    </div>

    <div class="chart-section">
      <h4>Activity Intensity Over Time</h4>
      <p class="chart-description">
        Daily transaction count with 7-day moving average overlay.
      </p>
      <div class="chart-container">
        <canvas id="intensityChart"></canvas>
      </div>
    </div>

    {/* Priority 3: Token Analytics */}
    <h3>Token Analytics</h3>

    <div class="chart-section">
      <h4>Top 10 Tokens by Volume</h4>
      <p class="chart-description">
        Tokens ranked by total volume (deposits + withdrawals) in selected time range.
      </p>
      <div class="chart-container">
        <canvas id="topTokensChart"></canvas>
      </div>
    </div>

    <div class="chart-section">
      <h4>Token Diversity Over Time</h4>
      <p class="chart-description">
        Number of unique tokens with activity each day.
      </p>
      <div class="chart-container">
        <canvas id="diversityChart"></canvas>
      </div>
    </div>

    {/* Embed chart data */}
    <script
      id="chart-data"
      type="application/json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(chartData) }}
    />

    {/* Chart rendering scripts */}
    <script dangerouslySetInnerHTML={{ __html: chartRenderingScript }} />
  </section>
);
```

### 3.6 Heatmap Table Rendering

```tsx
function renderHeatmapTable(data: HourlyHeatmapDataPoint[]) {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxCount = Math.max(...data.map(d => d.txCount), 1);

  // Create lookup map
  const dataMap = new Map<string, number>();
  data.forEach(d => {
    dataMap.set(`${d.hour}-${d.dayOfWeek}`, d.txCount);
  });

  return (
    <table class="activity-heatmap">
      <thead>
        <tr>
          <th></th>
          {dayLabels.map(day => <th>{day}</th>)}
        </tr>
      </thead>
      <tbody>
        {[...Array(24)].map((_, hour) => (
          <tr>
            <td class="hour-label">{hour.toString().padStart(2, '0')}:00</td>
            {[...Array(7)].map((_, dow) => {
              const count = dataMap.get(`${hour}-${dow}`) || 0;
              const intensity = count / maxCount;
              const color = getHeatmapColor(intensity);
              return (
                <td
                  class="heatmap-cell"
                  style={`background-color: ${color}`}
                  title={`${dayLabels[dow]} ${hour}:00 - ${count} transactions`}
                >
                  {count > 0 ? count : ''}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function getHeatmapColor(intensity: number): string {
  // Gradient: white (0) → light yellow → orange → red (1)
  if (intensity === 0) return '#ffffff';
  const r = 255;
  const g = Math.round(255 - (intensity * 150));
  const b = Math.round(255 - (intensity * 255));
  return `rgb(${r}, ${g}, ${b})`;
}
```

### 3.7 CSS Styling

```css
.chart-section {
  margin: 2rem 0;
  padding: 1rem;
  background: #f9f9f9;
  border-radius: 8px;
}

.chart-section h4 {
  margin-top: 0;
  color: #333;
}

.chart-description {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 1rem;
}

.chart-container {
  position: relative;
  height: 400px;
  background: white;
  padding: 1rem;
  border-radius: 4px;
}

.chart-heatmap {
  height: auto;
  min-height: 600px;
}

/* Heatmap table */
.activity-heatmap {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
  margin: 1rem 0;
}

.activity-heatmap th, .activity-heatmap td {
  border: 1px solid #ddd;
  padding: 0.5rem;
  text-align: center;
}

.activity-heatmap th {
  background: #f5f5f5;
  font-weight: 600;
}

.hour-label {
  background: #f5f5f5;
  font-weight: 500;
  text-align: right;
  padding-right: 0.75rem;
}

.heatmap-cell {
  min-width: 60px;
  cursor: help;
  transition: outline 0.2s;
}

.heatmap-cell:hover {
  outline: 2px solid #0066cc;
}
```

### 3.8 Color Scheme

- **Deposits**: `rgba(54, 162, 235, 0.6)` (blue)
- **Withdrawals**: `rgba(255, 99, 132, 0.6)` (red)
- **Volume/Combined**: `rgba(75, 192, 192, 0.6)` (teal)
- **Moving average**: `rgba(153, 102, 255, 0.8)` (purple, dashed)

### 3.9 Validation

- All 8 visualizations render correctly
- Time range filter updates all charts (including heatmap!)
- Token filter updates applicable charts (1, 2, 3, 6)
- Chain filter works (ethereum, polygon, all)
- No console errors
- Responsive design
- Data accuracy verified

---

## Phase 4: Performance Optimization

**Goal**: Ensure page loads in <2 seconds with smooth rendering

**Time Estimate**: 2-3 hours

### 4.1 Query Performance

- Monitor heatmap query performance (direct events query)
- Add index if needed: `CREATE INDEX idx_events_timestamp_chain ON events(blockTimestamp, chain);`
- Verify all queries < 500ms

### 4.2 Page Load

- Target: <2 seconds total load time
- Measure data fetching time (8 parallel queries)
- Consider in-memory caching if > 2s (unlikely with 68K events)

### 4.3 Chart Rendering

- Limit data points to 365 days max for line charts
- Use Chart.js `decimation` plugin for >1000 points
- Lazy load charts (render on scroll if needed)

### 4.4 Data Size

- Embedded JSON should be <100KB
- Monitor payload size, compress if needed

### 4.5 Validation

- Page loads in <2 seconds
- Charts render smoothly (60fps)
- No browser lag during interaction
- Reasonable payload sizes (<100KB JSON)
- Heatmap query <100ms

---

## Phase 5: Code Quality & Documentation

**Goal**: Clean, production-ready code with comprehensive documentation

**Time Estimate**: 3-4 hours

### 5.1 Code Review Checklist

- [ ] All TypeScript types explicit (no `any`)
- [ ] JSDoc comments on all public functions
- [ ] Error handling (try/catch where appropriate)
- [ ] Privacy constraints maintained (no per-address data)
- [ ] No unused imports or dead code
- [ ] Consistent code style with existing files
- [ ] No console.log statements

### 5.2 Testing

- Test all time ranges (7d, 30d, 90d, all)
- Test token filter (all tokens, specific token)
- Test chain filter (ethereum, polygon, all)
- Test with empty data sets (if applicable)
- Test responsive design (mobile, tablet, desktop)
- Cross-browser testing (Chrome, Firefox, Safari)

### 5.3 Documentation

- Update README.md:
  - Add `/charts` to routes table
  - Document new analytics script (`analytics:diversity`)
  - Add usage examples
- Add JSDoc to all chart data functions
- Comment complex query logic
- Document heatmap color gradient

### 5.4 Privacy Audit

- Verify all queries use aggregate data only
- Confirm no per-address data exposed
- Verify relayer metrics remain anonymous (only HHI shown)
- Check for any deanonymization vectors

---

## Summary & Success Criteria

### Total Time Estimate

| Phase | Time | Status |
|-------|------|--------|
| Phase 0: Database Seeding | 1-2 hours | ✅ Complete |
| Phase 1: Schema Extensions | 1-2 hours | Pending |
| Phase 2: Data Access Layer | 4-5 hours | Pending |
| Phase 3: Charts Page UI | 6-8 hours | Pending |
| Phase 4: Performance Optimization | 2-3 hours | Pending |
| Phase 5: Code Quality & Documentation | 3-4 hours | Pending |
| **TOTAL** | **16-22 hours** | **Phase 0 Done** |

### Files to Create

1. ✅ `src/db/seedFromJson.ts` - Database seeding script (COMPLETE)
2. ✅ `src/db/analyzeData.ts` - Data analysis script (COMPLETE)
3. `src/analytics/tokenDiversity.ts` - Token diversity analytics (Phase 1)
4. `src/analytics/chartData.ts` - Data access layer with 8 functions (Phase 2)

### Files to Modify

1. `src/db/schema.ts` - Add `dailyTokenDiversity` table (Phase 1)
2. `src/web/app.tsx` - Expand `/charts` route (~500+ lines) (Phase 3)
3. ✅ `package.json` - Add `db:seed` and `analytics:diversity` scripts

### Privacy Compliance ✅

All 8 charts use aggregate data only:

1. Mean deposit/withdrawal amounts - ✅ Aggregate only
2. Daily volume - ✅ Sum of all activity
3. Relayer HHI - ✅ Concentration metric only (no IDs)
4. Hourly heatmap - ✅ Aggregate tx counts (with time filtering!)
5. Activity intensity - ✅ Total counts only
6. Top tokens - ✅ Token-level aggregates
7. Token diversity - ✅ Count of unique tokens
8. All queries use aggregate data, no per-address tracking

### Success Criteria

The feature is complete when:

- ✅ Database seeded with 68,358 events from JSON
- [ ] `dailyTokenDiversity` table created and populated
- [ ] All 8 chart data functions implemented and tested
- [ ] `/charts` route renders all 8 visualizations correctly
- [ ] Time range filter (7d, 30d, 90d, all) works globally
- [ ] Token filter works for applicable charts (1, 2, 3, 6)
- [ ] Chain filter works (ethereum, polygon, all)
- [ ] Page loads in <2 seconds
- [ ] Responsive design works on all devices
- [ ] All TypeScript types explicit (no `any`)
- [ ] Privacy constraints maintained
- [ ] No console errors
- [ ] Code documented with JSDoc

---

## Next Steps

1. **Review this plan** - Ensure all requirements are captured
2. **Proceed with Phase 1** - Add `dailyTokenDiversity` schema and analytics
3. **Continue sequentially** - Each phase builds on the previous one
4. **Validate at each checkpoint** - Test thoroughly before moving forward

**Ready to begin implementation!**
