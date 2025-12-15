import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getAddress } from 'viem';
import { db, schema } from './client';
import { eq, sql } from 'drizzle-orm';

interface JsonEvent {
  id: number;
  chain: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTimestamp: number;
  contractName: string;
  eventName: string;
  eventType: string;
  tokenSymbol: string | null;
  tokenAddress: string | null;
  rawAmountWei: string | null;
  amountNormalized: number | null;
  relayerAddress: string | null;
  fromAddress: string | null;
  toAddress: string | null;
}

interface TokenInfo {
  chain: string;
  address: string;
  symbol: string | null;
  decimals: number | null;
}

/**
 * Calculate token decimals from rawAmountWei and amountNormalized
 * Formula: decimals = log10(rawAmountWei / amountNormalized)
 */
function calculateDecimals(rawAmountWei: string, amountNormalized: number): number | null {
  try {
    if (!rawAmountWei || !amountNormalized || amountNormalized === 0) {
      return null;
    }

    const rawAmount = Number(rawAmountWei);
    if (rawAmount === 0 || !isFinite(rawAmount)) {
      return null;
    }

    const ratio = rawAmount / amountNormalized;
    if (ratio <= 0 || !isFinite(ratio)) {
      return null;
    }

    const decimals = Math.round(Math.log10(ratio));

    // Validate reasonable range (most tokens use 0-18 decimals, some up to 24)
    if (decimals < 0 || decimals > 30) {
      console.warn(`Calculated unusual decimals: ${decimals} for raw=${rawAmountWei}, normalized=${amountNormalized}`);
      return null;
    }

    return decimals;
  } catch (err) {
    console.warn(`Error calculating decimals for raw=${rawAmountWei}, normalized=${amountNormalized}:`, err);
    return null;
  }
}

/**
 * Seed database from events-all.json
 */
async function seedFromJson() {
  console.log('Starting database seeding from events-all.json...\n');

  const jsonPath = resolve(process.cwd(), 'events-all.json');
  console.log(`Reading JSON from: ${jsonPath}`);

  // Read and parse JSON file
  const jsonContent = readFileSync(jsonPath, 'utf-8');
  const events: JsonEvent[] = JSON.parse(jsonContent);
  console.log(`Parsed ${events.length} events from JSON\n`);

  // Step 1: Extract unique tokens
  console.log('Step 1: Extracting unique tokens...');
  const tokenMap = new Map<string, TokenInfo>();

  for (const event of events) {
    if (!event.tokenAddress || !event.chain) continue;

    try {
      // Checksum the address
      const checksummedAddress = getAddress(event.tokenAddress);
      const key = `${event.chain}:${checksummedAddress}`;

      if (!tokenMap.has(key)) {
        // Calculate decimals from first occurrence
        const decimals = event.rawAmountWei && event.amountNormalized
          ? calculateDecimals(event.rawAmountWei, event.amountNormalized)
          : null;

        tokenMap.set(key, {
          chain: event.chain,
          address: checksummedAddress,
          symbol: event.tokenSymbol,
          decimals,
        });
      } else {
        // Update decimals if we didn't have one yet
        const existing = tokenMap.get(key)!;
        if (existing.decimals === null && event.rawAmountWei && event.amountNormalized) {
          const decimals = calculateDecimals(event.rawAmountWei, event.amountNormalized);
          if (decimals !== null) {
            existing.decimals = decimals;
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to process token address ${event.tokenAddress}:`, err);
    }
  }

  const uniqueTokens = Array.from(tokenMap.values());
  console.log(`Found ${uniqueTokens.length} unique tokens`);
  console.log(`  - Ethereum: ${uniqueTokens.filter(t => t.chain === 'ethereum').length}`);
  console.log(`  - Polygon: ${uniqueTokens.filter(t => t.chain === 'polygon').length}\n`);

  // Step 2: Insert tokens
  console.log('Step 2: Inserting tokens into database...');
  let tokensInserted = 0;

  for (const token of uniqueTokens) {
    try {
      await db.insert(schema.tokens)
        .values({
          chain: token.chain,
          address: token.address,
          symbol: token.symbol,
          decimals: token.decimals,
        })
        .onConflictDoNothing();
      tokensInserted++;
    } catch (err) {
      console.error(`Failed to insert token ${token.chain}:${token.address}:`, err);
    }
  }

  console.log(`Inserted ${tokensInserted} tokens\n`);

  // Step 3: Build token ID lookup map
  console.log('Step 3: Building token ID lookup map...');
  const tokenIdMap = new Map<string, number>();

  for (const token of uniqueTokens) {
    try {
      const result = await db.select()
        .from(schema.tokens)
        .where(
          sql`${schema.tokens.chain} = ${token.chain} AND ${schema.tokens.address} = ${token.address}`
        )
        .get();

      if (result) {
        const key = `${token.chain}:${token.address}`;
        tokenIdMap.set(key, result.id);
      }
    } catch (err) {
      console.error(`Failed to lookup token ID for ${token.chain}:${token.address}:`, err);
    }
  }

  console.log(`Mapped ${tokenIdMap.size} token IDs\n`);

  // Step 4: Insert events in batches
  console.log('Step 4: Inserting events into database...');
  const BATCH_SIZE = 1000;
  let totalInserted = 0;
  let totalSkipped = 0;
  let batchCount = 0;

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    batchCount++;

    const eventsToInsert: Array<typeof schema.events.$inferInsert> = [];

    for (const event of batch) {
      try {
        // Lookup tokenId
        let tokenId: number | null = null;
        if (event.tokenAddress && event.chain) {
          const checksummedAddress = getAddress(event.tokenAddress);
          const key = `${event.chain}:${checksummedAddress}`;
          tokenId = tokenIdMap.get(key) || null;
        }

        // Prepare event data
        eventsToInsert.push({
          chain: event.chain,
          txHash: event.txHash,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          blockTimestamp: event.blockTimestamp,
          contractName: event.contractName,
          eventName: event.eventName,
          eventType: event.eventType,
          tokenId,
          rawAmountWei: event.rawAmountWei,
          amountNormalized: event.amountNormalized,
          relayerAddress: event.relayerAddress,
          fromAddress: event.fromAddress,
          toAddress: event.toAddress,
          metadataJson: null, // JSON doesn't have additional metadata
        });
      } catch (err) {
        console.warn(`Failed to prepare event ${event.txHash}:${event.logIndex}:`, err);
        totalSkipped++;
      }
    }

    // Insert batch using transaction
    try {
      await db.transaction(async (tx) => {
        for (const eventData of eventsToInsert) {
          await tx.insert(schema.events)
            .values(eventData)
            .onConflictDoNothing();
        }
      });

      totalInserted += eventsToInsert.length;

      // Log progress every batch
      console.log(`  Batch ${batchCount}: Inserted ${eventsToInsert.length} events (total: ${totalInserted}/${events.length})`);
    } catch (err) {
      console.error(`Failed to insert batch ${batchCount}:`, err);
      totalSkipped += eventsToInsert.length;
    }
  }

  console.log(`\nSeeding complete!`);
  console.log(`  Total events processed: ${events.length}`);
  console.log(`  Successfully inserted: ${totalInserted}`);
  console.log(`  Skipped/failed: ${totalSkipped}`);

  // Step 5: Verify and report statistics
  console.log('\nStep 5: Verifying seeded data...');

  const ethereumCount = await db.select({ count: sql<number>`count(*)` })
    .from(schema.events)
    .where(eq(schema.events.chain, 'ethereum'))
    .then(rows => rows[0]?.count || 0);

  const polygonCount = await db.select({ count: sql<number>`count(*)` })
    .from(schema.events)
    .where(eq(schema.events.chain, 'polygon'))
    .then(rows => rows[0]?.count || 0);

  const tokenCount = await db.select({ count: sql<number>`count(*)` })
    .from(schema.tokens)
    .then(rows => rows[0]?.count || 0);

  // Get date range - get min timestamp
  const minDateQuery = await db.select({
    minDate: schema.events.blockTimestamp,
  })
    .from(schema.events)
    .orderBy(schema.events.blockTimestamp)
    .limit(1);

  // Get max timestamp
  const maxDateQuery = await db.select({
    maxDate: schema.events.blockTimestamp,
  })
    .from(schema.events)
    .orderBy(sql`${schema.events.blockTimestamp} DESC`)
    .limit(1);

  console.log('\n========================================');
  console.log('SEEDING STATISTICS');
  console.log('========================================');
  console.log(`Total Events: ${ethereumCount + polygonCount}`);
  console.log(`  - Ethereum: ${ethereumCount}`);
  console.log(`  - Polygon: ${polygonCount}`);
  console.log(`Total Unique Tokens: ${tokenCount}`);

  if (minDateQuery.length > 0) {
    const minTimestamp = minDateQuery[0].minDate;
    const minDate = new Date(minTimestamp * 1000).toISOString().split('T')[0];
    console.log(`Earliest Event: ${minDate} (timestamp: ${minTimestamp})`);
  }

  if (maxDateQuery.length > 0) {
    const maxTimestamp = maxDateQuery[0].maxDate;
    const maxDate = new Date(maxTimestamp * 1000).toISOString().split('T')[0];
    console.log(`Latest Event: ${maxDate} (timestamp: ${maxTimestamp})`);
  }
  console.log('========================================\n');

  console.log('✅ Database seeding completed successfully!');
  console.log('\nNext steps:');
  console.log('  1. Run analytics: bun run analytics');
  console.log('  2. Start server: bun run dev');
}

// Run seeding
seedFromJson()
  .catch((err) => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  });
