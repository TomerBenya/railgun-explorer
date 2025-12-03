# Railgun Transparency Dashboard - Implementation Plan

## Overview
Build an Ethereum-only analytics dashboard for Railgun privacy protocol using:
- **Runtime**: Bun
- **Language**: TypeScript
- **Blockchain**: viem
- **Database**: SQLite via Drizzle ORM
- **Web**: Hono with server-side JSX rendering

## Project Structure (per CLAUDE.md)

```
src/
  db/
    schema.ts
    client.ts
    migrate.ts
  indexer/
    config.ts
    indexEthereum.ts
    eventDecoder.ts
    tokenResolver.ts
  analytics/
    dailyFlows.ts
    relayerStats.ts
  web/
    app.tsx
    pages/
      OverviewPage.tsx
      TokensPage.tsx
      RelayersPage.tsx
      EthicsPage.tsx
  server.ts
railgun_eth.sqlite
CLAUDE.md
PLAN.md
package.json
tsconfig.json
drizzle.config.ts
bunfig.toml
```

---

## Phase 1: Project Setup

### 1.1 package.json
```json
{
  "name": "railgun-dashboard",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run src/server.ts",
    "index": "bun run src/indexer/indexEthereum.ts",
    "analytics:flows": "bun run src/analytics/dailyFlows.ts",
    "analytics:relayers": "bun run src/analytics/relayerStats.ts",
    "analytics": "bun run analytics:flows && bun run analytics:relayers",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun run src/db/migrate.ts",
    "db:studio": "drizzle-kit studio"
  }
}
```

### 1.2 Dependencies
```bash
bun add hono drizzle-orm better-sqlite3 viem
bun add -d drizzle-kit @types/better-sqlite3 typescript
```

### 1.3 tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "types": ["bun-types"]
  }
}
```

### 1.4 drizzle.config.ts
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './railgun_eth.sqlite',
  },
});
```

---

## Phase 2: Database Schema (Drizzle)

### src/db/schema.ts

```typescript
import { sqliteTable, text, integer, real, primaryKey, unique } from 'drizzle-orm/sqlite-core';

// Key-value metadata store (for last_indexed_block_eth, etc.)
export const metadata = sqliteTable('metadata', {
  key: text('key').primaryKey(),
  value: text('value'),
});

// ERC-20 token metadata cache
export const tokens = sqliteTable('tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  address: text('address').notNull().unique(), // checksummed
  symbol: text('symbol'),
  decimals: integer('decimals'),
});

// Raw indexed events from Railgun contracts
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
  // Idempotency constraint
  txLogUnique: unique().on(table.txHash, table.logIndex),
}));

// Pre-computed daily aggregates per token
export const dailyFlows = sqliteTable('daily_flows', {
  date: text('date').notNull(), // "YYYY-MM-DD"
  tokenId: integer('token_id').notNull().references(() => tokens.id),
  totalDeposits: real('total_deposits').notNull().default(0),
  totalWithdrawals: real('total_withdrawals').notNull().default(0),
  netFlow: real('net_flow').notNull().default(0),
  depositTxCount: integer('deposit_tx_count').notNull().default(0),
  withdrawalTxCount: integer('withdrawal_tx_count').notNull().default(0),
}, (table) => ({
  pk: primaryKey({ columns: [table.date, table.tokenId] }),
}));

// Pre-computed daily relayer concentration metrics
export const relayerStatsDaily = sqliteTable('relayer_stats_daily', {
  date: text('date').primaryKey(), // "YYYY-MM-DD"
  numActiveRelayers: integer('num_active_relayers').notNull().default(0),
  top5Share: real('top_5_share').notNull().default(0), // 0-1
  hhi: real('hhi').notNull().default(0), // sum of squared shares
  relayerTxCount: integer('relayer_tx_count').notNull().default(0),
});

// Type exports for use in application code
export type Metadata = typeof metadata.$inferSelect;
export type Token = typeof tokens.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type DailyFlow = typeof dailyFlows.$inferSelect;
export type RelayerStatsDaily = typeof relayerStatsDaily.$inferSelect;
```

### src/db/client.ts

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const DB_PATH = process.env.DB_PATH || './railgun_eth.sqlite';

const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export { schema };
```

### src/db/migrate.ts

```typescript
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client';

console.log('Running migrations...');
migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations complete.');
```

---

## Phase 3: Indexer Implementation

### src/indexer/config.ts

```typescript
import { type Abi } from 'viem';

// Environment configuration
export const RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';

// Railgun deployment block (adjust based on actual deployment)
export const START_BLOCK = 15_000_000n; // TODO: Update with actual

// Indexer settings
export const CONFIRMATION_BLOCKS = 12n;
export const BATCH_SIZE = 2000n;

// Contract addresses (PLACEHOLDERS - replace with actual addresses)
export const CONTRACTS = {
  smartWallet: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  relay: '0x0000000000000000000000000000000000000000' as `0x${string}`,
} as const;

// ABI Placeholders - replace with actual Railgun ABIs
// Shield event for deposits
// Unshield event for withdrawals
// Transact event for relayer payments
export const SMART_WALLET_ABI: Abi = [
  {
    type: 'event',
    name: 'Shield',
    inputs: [
      { name: 'treeNumber', type: 'uint256', indexed: false },
      { name: 'startPosition', type: 'uint256', indexed: false },
      { name: 'commitments', type: 'bytes32[]', indexed: false },
      { name: 'shieldCiphertext', type: 'bytes[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Unshield',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Transact',
    inputs: [
      { name: 'treeNumber', type: 'uint256', indexed: false },
      { name: 'startPosition', type: 'uint256', indexed: false },
      { name: 'hash', type: 'bytes32[]', indexed: false },
      { name: 'ciphertext', type: 'bytes[]', indexed: false },
    ],
  },
] as const;

export const RELAY_ABI: Abi = [
  {
    type: 'event',
    name: 'RelayerPayment',
    inputs: [
      { name: 'relayer', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// Event type mapping
export type EventType = 'deposit' | 'withdrawal' | 'relayer_payment' | 'other';
```

### src/indexer/tokenResolver.ts

```typescript
import { createPublicClient, http, erc20Abi, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { db, schema } from '../db/client';
import { eq } from 'drizzle-orm';
import { RPC_URL } from './config';

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

// Cache to avoid repeated DB lookups within a batch
const tokenCache = new Map<string, number>();

export async function resolveTokenId(tokenAddress: string): Promise<number | null> {
  const checksummed = getAddress(tokenAddress);

  // Check cache first
  if (tokenCache.has(checksummed)) {
    return tokenCache.get(checksummed)!;
  }

  // Check database
  const existing = await db.select()
    .from(schema.tokens)
    .where(eq(schema.tokens.address, checksummed))
    .get();

  if (existing) {
    tokenCache.set(checksummed, existing.id);
    return existing.id;
  }

  // Fetch on-chain metadata
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({
        address: checksummed as `0x${string}`,
        abi: erc20Abi,
        functionName: 'symbol',
      }),
      client.readContract({
        address: checksummed as `0x${string}`,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
    ]);

    const result = await db.insert(schema.tokens)
      .values({ address: checksummed, symbol, decimals })
      .returning({ id: schema.tokens.id })
      .get();

    tokenCache.set(checksummed, result.id);
    return result.id;
  } catch (err) {
    // Non-standard token, insert with null metadata
    console.warn(`Failed to fetch metadata for ${checksummed}:`, err);
    const result = await db.insert(schema.tokens)
      .values({ address: checksummed, symbol: null, decimals: null })
      .returning({ id: schema.tokens.id })
      .get();

    tokenCache.set(checksummed, result.id);
    return result.id;
  }
}

export function clearTokenCache() {
  tokenCache.clear();
}
```

### src/indexer/eventDecoder.ts

```typescript
import { decodeEventLog, type Log } from 'viem';
import { SMART_WALLET_ABI, RELAY_ABI, type EventType } from './config';

export interface DecodedEvent {
  eventName: string;
  eventType: EventType;
  tokenAddress: string | null;
  rawAmountWei: string | null;
  relayerAddress: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  metadata: Record<string, unknown>;
}

export function decodeSmartWalletEvent(log: Log): DecodedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: SMART_WALLET_ABI,
      data: log.data,
      topics: log.topics,
    });

    const eventName = decoded.eventName;
    let eventType: EventType = 'other';
    let tokenAddress: string | null = null;
    let rawAmountWei: string | null = null;
    let toAddress: string | null = null;

    if (eventName === 'Shield') {
      eventType = 'deposit';
      // Shield events require parsing ciphertext to extract token/amount
      // TODO: Implement based on actual Railgun format
    } else if (eventName === 'Unshield') {
      eventType = 'withdrawal';
      const args = decoded.args as { to: string; token: string; amount: bigint; fee: bigint };
      tokenAddress = args.token;
      rawAmountWei = args.amount.toString();
      toAddress = args.to;
    } else if (eventName === 'Transact') {
      eventType = 'other'; // Regular private transfers, not relayer payments
    }

    return {
      eventName,
      eventType,
      tokenAddress,
      rawAmountWei,
      relayerAddress: null,
      fromAddress: null,
      toAddress,
      metadata: decoded.args as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function decodeRelayEvent(log: Log): DecodedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: RELAY_ABI,
      data: log.data,
      topics: log.topics,
    });

    if (decoded.eventName === 'RelayerPayment') {
      const args = decoded.args as { relayer: string; token: string; amount: bigint };
      return {
        eventName: 'RelayerPayment',
        eventType: 'relayer_payment',
        tokenAddress: args.token,
        rawAmountWei: args.amount.toString(),
        relayerAddress: args.relayer,
        fromAddress: null,
        toAddress: null,
        metadata: args as Record<string, unknown>,
      };
    }

    return null;
  } catch {
    return null;
  }
}
```

### src/indexer/indexEthereum.ts

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { db, schema } from '../db/client';
import { eq } from 'drizzle-orm';
import {
  RPC_URL, START_BLOCK, CONFIRMATION_BLOCKS, BATCH_SIZE,
  CONTRACTS,
} from './config';
import { decodeSmartWalletEvent, decodeRelayEvent } from './eventDecoder';
import { resolveTokenId, clearTokenCache } from './tokenResolver';

const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

async function getLastIndexedBlock(): Promise<bigint> {
  const row = await db.select()
    .from(schema.metadata)
    .where(eq(schema.metadata.key, 'last_indexed_block_eth'))
    .get();
  return row?.value ? BigInt(row.value) : START_BLOCK;
}

async function setLastIndexedBlock(block: bigint): Promise<void> {
  await db.insert(schema.metadata)
    .values({ key: 'last_indexed_block_eth', value: block.toString() })
    .onConflictDoUpdate({
      target: schema.metadata.key,
      set: { value: block.toString() },
    });
}

async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
  const block = await client.getBlock({ blockNumber });
  return Number(block.timestamp);
}

async function indexBatch(fromBlock: bigint, toBlock: bigint): Promise<void> {
  console.log(`Indexing blocks ${fromBlock} to ${toBlock}...`);

  // Fetch logs from both contracts
  const [smartWalletLogs, relayLogs] = await Promise.all([
    client.getLogs({
      address: CONTRACTS.smartWallet,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: CONTRACTS.relay,
      fromBlock,
      toBlock,
    }),
  ]);

  // Block timestamps cache for this batch
  const timestamps = new Map<bigint, number>();

  // Process SmartWallet events
  for (const log of smartWalletLogs) {
    const decoded = decodeSmartWalletEvent(log);
    if (!decoded) continue;

    // Get timestamp
    if (!timestamps.has(log.blockNumber)) {
      timestamps.set(log.blockNumber, await getBlockTimestamp(log.blockNumber));
    }

    // Resolve token
    const tokenId = decoded.tokenAddress
      ? await resolveTokenId(decoded.tokenAddress)
      : null;

    // Compute normalized amount
    let amountNormalized: number | null = null;
    if (decoded.rawAmountWei && tokenId) {
      const token = await db.select().from(schema.tokens).where(eq(schema.tokens.id, tokenId)).get();
      if (token?.decimals) {
        amountNormalized = Number(BigInt(decoded.rawAmountWei)) / Math.pow(10, token.decimals);
      }
    }

    // Insert event (idempotent)
    await db.insert(schema.events)
      .values({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        blockTimestamp: timestamps.get(log.blockNumber)!,
        contractName: 'SmartWallet',
        eventName: decoded.eventName,
        eventType: decoded.eventType,
        tokenId,
        rawAmountWei: decoded.rawAmountWei,
        amountNormalized,
        relayerAddress: decoded.relayerAddress,
        fromAddress: decoded.fromAddress,
        toAddress: decoded.toAddress,
        metadataJson: JSON.stringify(decoded.metadata),
      })
      .onConflictDoNothing();
  }

  // Process Relay events
  for (const log of relayLogs) {
    const decoded = decodeRelayEvent(log);
    if (!decoded) continue;

    if (!timestamps.has(log.blockNumber)) {
      timestamps.set(log.blockNumber, await getBlockTimestamp(log.blockNumber));
    }

    const tokenId = decoded.tokenAddress
      ? await resolveTokenId(decoded.tokenAddress)
      : null;

    let amountNormalized: number | null = null;
    if (decoded.rawAmountWei && tokenId) {
      const token = await db.select().from(schema.tokens).where(eq(schema.tokens.id, tokenId)).get();
      if (token?.decimals) {
        amountNormalized = Number(BigInt(decoded.rawAmountWei)) / Math.pow(10, token.decimals);
      }
    }

    await db.insert(schema.events)
      .values({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        blockTimestamp: timestamps.get(log.blockNumber)!,
        contractName: 'Relay',
        eventName: decoded.eventName,
        eventType: decoded.eventType,
        tokenId,
        rawAmountWei: decoded.rawAmountWei,
        amountNormalized,
        relayerAddress: decoded.relayerAddress,
        fromAddress: decoded.fromAddress,
        toAddress: decoded.toAddress,
        metadataJson: JSON.stringify(decoded.metadata),
      })
      .onConflictDoNothing();
  }

  console.log(`  Processed ${smartWalletLogs.length + relayLogs.length} events`);
}

async function main() {
  console.log('Starting Ethereum indexer...');

  const latestBlock = await client.getBlockNumber();
  const safeBlock = latestBlock - CONFIRMATION_BLOCKS;
  let currentBlock = await getLastIndexedBlock();

  console.log(`Latest: ${latestBlock}, Safe: ${safeBlock}, Current: ${currentBlock}`);

  while (currentBlock < safeBlock) {
    const toBlock = currentBlock + BATCH_SIZE > safeBlock
      ? safeBlock
      : currentBlock + BATCH_SIZE;

    await indexBatch(currentBlock + 1n, toBlock);
    await setLastIndexedBlock(toBlock);
    currentBlock = toBlock;

    // Clear token cache periodically to free memory
    clearTokenCache();
  }

  console.log('Indexing complete.');
}

main().catch(console.error);
```

---

## Phase 4: Analytics Scripts

### src/analytics/dailyFlows.ts

```typescript
import { db, schema } from '../db/client';
import { sql, eq } from 'drizzle-orm';

const MIN_TX_THRESHOLD = 3;

async function computeDailyFlows() {
  console.log('Computing daily flows...');

  // Clear existing data
  await db.delete(schema.dailyFlows);

  // Query aggregated flows per date per token
  const flows = await db
    .select({
      date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`.as('date'),
      tokenId: schema.events.tokenId,
      totalDeposits: sql<number>`sum(case when ${schema.events.eventType} = 'deposit' then ${schema.events.amountNormalized} else 0 end)`,
      totalWithdrawals: sql<number>`sum(case when ${schema.events.eventType} = 'withdrawal' then ${schema.events.amountNormalized} else 0 end)`,
      depositTxCount: sql<number>`sum(case when ${schema.events.eventType} = 'deposit' then 1 else 0 end)`,
      withdrawalTxCount: sql<number>`sum(case when ${schema.events.eventType} = 'withdrawal' then 1 else 0 end)`,
    })
    .from(schema.events)
    .where(sql`${schema.events.eventType} in ('deposit', 'withdrawal') and ${schema.events.tokenId} is not null`)
    .groupBy(sql`date(${schema.events.blockTimestamp}, 'unixepoch')`, schema.events.tokenId);

  let inserted = 0;
  let skipped = 0;

  for (const flow of flows) {
    if (!flow.tokenId) continue;

    const totalTxCount = (flow.depositTxCount || 0) + (flow.withdrawalTxCount || 0);

    // Privacy guardrail: skip small cohorts
    if (totalTxCount < MIN_TX_THRESHOLD) {
      skipped++;
      continue;
    }

    const totalDeposits = flow.totalDeposits || 0;
    const totalWithdrawals = flow.totalWithdrawals || 0;

    await db.insert(schema.dailyFlows).values({
      date: flow.date,
      tokenId: flow.tokenId,
      totalDeposits,
      totalWithdrawals,
      netFlow: totalDeposits - totalWithdrawals,
      depositTxCount: flow.depositTxCount || 0,
      withdrawalTxCount: flow.withdrawalTxCount || 0,
    });

    inserted++;
  }

  console.log(`Daily flows computed: ${inserted} inserted, ${skipped} skipped (below threshold)`);
}

computeDailyFlows().catch(console.error);
```

### src/analytics/relayerStats.ts

```typescript
import { db, schema } from '../db/client';
import { sql, eq } from 'drizzle-orm';

async function computeRelayerStats() {
  console.log('Computing relayer stats...');

  // Clear existing data
  await db.delete(schema.relayerStatsDaily);

  // Get all relayer payments grouped by date and relayer
  const payments = await db
    .select({
      date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`.as('date'),
      relayerAddress: schema.events.relayerAddress,
      volume: sql<number>`sum(${schema.events.amountNormalized})`,
      txCount: sql<number>`count(*)`,
    })
    .from(schema.events)
    .where(eq(schema.events.eventType, 'relayer_payment'))
    .groupBy(sql`date(${schema.events.blockTimestamp}, 'unixepoch')`, schema.events.relayerAddress);

  // Group by date
  const byDate = new Map<string, Array<{ relayer: string; volume: number; txCount: number }>>();

  for (const p of payments) {
    if (!p.relayerAddress || !p.date) continue;
    if (!byDate.has(p.date)) {
      byDate.set(p.date, []);
    }
    byDate.get(p.date)!.push({
      relayer: p.relayerAddress,
      volume: p.volume || 0,
      txCount: p.txCount || 0,
    });
  }

  // Compute stats for each date
  for (const [date, relayers] of byDate) {
    const numActiveRelayers = relayers.length;
    const totalVolume = relayers.reduce((sum, r) => sum + r.volume, 0);
    const totalTxCount = relayers.reduce((sum, r) => sum + r.txCount, 0);

    // Sort by volume descending
    relayers.sort((a, b) => b.volume - a.volume);

    // Top 5 share
    const top5Volume = relayers.slice(0, 5).reduce((sum, r) => sum + r.volume, 0);
    const top5Share = totalVolume > 0 ? top5Volume / totalVolume : 0;

    // HHI (Herfindahl-Hirschman Index)
    let hhi = 0;
    if (totalVolume > 0) {
      for (const r of relayers) {
        const share = r.volume / totalVolume;
        hhi += share * share;
      }
    }

    await db.insert(schema.relayerStatsDaily).values({
      date,
      numActiveRelayers,
      top5Share,
      hhi,
      relayerTxCount: totalTxCount,
    });
  }

  console.log(`Relayer stats computed for ${byDate.size} days`);
}

computeRelayerStats().catch(console.error);
```

---

## Phase 5: Web Dashboard (Hono + JSX)

### src/server.ts

```typescript
import app from './web/app';

const port = parseInt(process.env.PORT || '3000');

console.log(`Starting server on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
```

### src/web/app.tsx

```tsx
import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { db, schema } from '../db/client';
import { desc, sql, eq } from 'drizzle-orm';

const app = new Hono();

// Global layout wrapper
app.use('*', jsxRenderer(({ children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Railgun Transparency Dashboard</title>
      <style>{`
        body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 1rem; }
        nav { display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 1rem; }
        nav a { text-decoration: none; color: #0066cc; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
        th { background: #f5f5f5; }
      `}</style>
    </head>
    <body>
      <header>
        <h1>Railgun Transparency Dashboard</h1>
        <nav>
          <a href="/">Overview</a>
          <a href="/tokens">Tokens</a>
          <a href="/relayers">Relayers</a>
          <a href="/ethics">Ethics & Limitations</a>
        </nav>
      </header>
      <main>{children}</main>
      <footer style={{ marginTop: '2rem', color: '#666', fontSize: '0.875rem' }}>
        <p>Aggregate analytics only. No individual tracking.</p>
      </footer>
    </body>
  </html>
)));

// GET / - Overview page
app.get('/', async (c) => {
  const flows = await db.select({
    date: schema.dailyFlows.date,
    totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
    totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
    netFlow: sql<number>`sum(${schema.dailyFlows.netFlow})`,
  })
    .from(schema.dailyFlows)
    .groupBy(schema.dailyFlows.date)
    .orderBy(desc(schema.dailyFlows.date))
    .limit(30);

  return c.render(
    <section>
      <h2>Daily Overview (All Tokens)</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Deposits</th><th>Withdrawals</th><th>Net Flow</th></tr>
        </thead>
        <tbody>
          {flows.map((row) => (
            <tr>
              <td>{row.date}</td>
              <td>{row.totalDeposits?.toFixed(2)}</td>
              <td>{row.totalWithdrawals?.toFixed(2)}</td>
              <td>{row.netFlow?.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});

// GET /tokens - Token list
app.get('/tokens', async (c) => {
  const tokenStats = await db.select({
    id: schema.tokens.id,
    symbol: schema.tokens.symbol,
    address: schema.tokens.address,
    totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
  })
    .from(schema.tokens)
    .leftJoin(schema.dailyFlows, eq(schema.tokens.id, schema.dailyFlows.tokenId))
    .groupBy(schema.tokens.id)
    .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`));

  return c.render(
    <section>
      <h2>Tokens by Deposit Volume</h2>
      <table>
        <thead>
          <tr><th>Symbol</th><th>Total Deposits</th><th>Details</th></tr>
        </thead>
        <tbody>
          {tokenStats.map((t) => (
            <tr>
              <td>{t.symbol || 'Unknown'}</td>
              <td>{t.totalDeposits?.toFixed(2) || '0'}</td>
              <td><a href={`/tokens/${t.id}`}>View</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});

// GET /tokens/:id - Token detail
app.get('/tokens/:id', async (c) => {
  const tokenId = parseInt(c.req.param('id'));
  const token = await db.select().from(schema.tokens).where(eq(schema.tokens.id, tokenId)).get();
  const flows = await db.select()
    .from(schema.dailyFlows)
    .where(eq(schema.dailyFlows.tokenId, tokenId))
    .orderBy(desc(schema.dailyFlows.date))
    .limit(30);

  return c.render(
    <section>
      <h2>{token?.symbol || 'Token'} Daily Flows</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Deposits</th><th>Withdrawals</th><th>Net</th></tr>
        </thead>
        <tbody>
          {flows.map((row) => (
            <tr>
              <td>{row.date}</td>
              <td>{row.totalDeposits.toFixed(2)}</td>
              <td>{row.totalWithdrawals.toFixed(2)}</td>
              <td>{row.netFlow.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});

// GET /relayers - Relayer concentration metrics
app.get('/relayers', async (c) => {
  const stats = await db.select()
    .from(schema.relayerStatsDaily)
    .orderBy(desc(schema.relayerStatsDaily.date))
    .limit(30);

  return c.render(
    <section>
      <h2>Relayer Concentration Metrics</h2>
      <p><em>Aggregate statistics only. No individual relayer data exposed.</em></p>
      <table>
        <thead>
          <tr><th>Date</th><th>Active Relayers</th><th>Top 5 Share</th><th>HHI</th><th>Tx Count</th></tr>
        </thead>
        <tbody>
          {stats.map((row) => (
            <tr>
              <td>{row.date}</td>
              <td>{row.numActiveRelayers}</td>
              <td>{(row.top5Share * 100).toFixed(1)}%</td>
              <td>{row.hhi.toFixed(4)}</td>
              <td>{row.relayerTxCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});

// GET /ethics - Ethics page
app.get('/ethics', (c) => {
  return c.render(
    <section>
      <h2>Ethics & Limitations</h2>
      <h3>Data Sources</h3>
      <p>This dashboard indexes only public on-chain events from Railgun smart contracts on Ethereum mainnet.</p>

      <h3>What We Do NOT Do</h3>
      <ul>
        <li>No deanonymization attempts</li>
        <li>No transaction flow tracing or linking</li>
        <li>No per-address analytics or search</li>
        <li>No individual relayer identification</li>
        <li>No off-chain identity resolution</li>
      </ul>

      <h3>Privacy Guardrails</h3>
      <ul>
        <li>Minimum cohort size: Daily token aggregates with fewer than 3 transactions are excluded</li>
        <li>Relayer metrics are aggregate only (count, concentration) - no individual addresses shown</li>
        <li>No APIs or pages that accept Ethereum addresses as parameters</li>
      </ul>

      <h3>Limitations</h3>
      <ul>
        <li>Data may lag behind chain tip by ~12 blocks for reorg safety</li>
        <li>Token metadata relies on on-chain calls which may fail for non-standard tokens</li>
        <li>Aggregate volumes are approximations based on decoded event data</li>
      </ul>
    </section>
  );
});

export default app;
```

---

## Phase 6: Privacy & Ethics Enforcement

### Hard constraints (enforced in code):
1. **No address-based routes**: No `/address/:addr` or similar
2. **No per-relayer history**: Only aggregate metrics in relayer_stats_daily
3. **Minimum cohort size**: daily_flows with <3 combined txs excluded
4. **No linking logic**: No algorithms that attempt to match deposits/withdrawals
5. **No off-chain identity data**: Only on-chain token symbols/decimals

---

## Implementation Order

1. **Project setup** (package.json, tsconfig.json, drizzle.config.ts)
2. **Database schema** (src/db/schema.ts, src/db/client.ts)
3. **Indexer config** (src/indexer/config.ts with placeholders)
4. **Token resolver** (src/indexer/tokenResolver.ts)
5. **Event decoder** (src/indexer/eventDecoder.ts)
6. **Main indexer** (src/indexer/indexEthereum.ts)
7. **Analytics: daily flows** (src/analytics/dailyFlows.ts)
8. **Analytics: relayer stats** (src/analytics/relayerStats.ts)
9. **Web app + server** (src/web/app.tsx, src/server.ts)

---

## Key Files Summary

| File | Purpose |
|------|---------|
| `src/db/schema.ts` | Drizzle schema with all 5 tables |
| `src/db/client.ts` | DB connection + Drizzle instance |
| `src/indexer/config.ts` | RPC, contracts, ABIs (placeholders) |
| `src/indexer/indexEthereum.ts` | Main indexing loop |
| `src/analytics/dailyFlows.ts` | Aggregate daily flows with privacy filter |
| `src/analytics/relayerStats.ts` | Compute relayer concentration metrics |
| `src/web/app.tsx` | Hono routes + JSX renderer |
| `src/server.ts` | Server entry point |

---

## Bun Commands

```bash
# Install dependencies
bun add hono drizzle-orm better-sqlite3 viem
bun add -d drizzle-kit @types/better-sqlite3 typescript

# Generate migrations
bun run db:generate

# Run migrations
bun run db:migrate

# Run indexer
bun run index

# Compute analytics
bun run analytics

# Start web server
bun run dev
```
