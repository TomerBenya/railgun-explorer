import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { db, schema } from '../db/client';
import { eq } from 'drizzle-orm';
import {
  RPC_URL, START_BLOCK, CONFIRMATION_BLOCKS, BATCH_SIZE,
  BATCH_DELAY_MS, CONTRACTS, RELAY_ABI,
} from './configPolygon';
import { decodeSmartWalletEvent, decodeRelayEvent } from './eventDecoder';
import { resolveTokenId, clearTokenCache } from './tokenResolverPolygon';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;
const RATE_LIMIT_DELAY_MS = 30000; // 30 seconds for rate limit errors

const client = createPublicClient({
  chain: polygon,
  transport: http(RPC_URL),
});

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorMsg = lastError.message.toLowerCase();
      const isRateLimit = errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('too many requests');
      const isSqliteBusy = errorMsg.includes('sqlite_busy') || errorMsg.includes('database is locked');

      console.warn(`${context} failed (attempt ${attempt}/${MAX_RETRIES}): ${lastError.message}`);

      if (attempt < MAX_RETRIES) {
        // Use longer delay for rate limit errors and SQLite busy errors
        let delay = RETRY_DELAY_MS * attempt;
        if (isRateLimit) {
          delay = RATE_LIMIT_DELAY_MS * attempt;
        } else if (isSqliteBusy) {
          delay = 10000 * attempt; // 10s, 20s, 30s, 40s for SQLite busy
        }
        console.log(`  Waiting ${delay}ms before retry...`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

async function getLastIndexedBlock(): Promise<bigint> {
  const row = await db.select()
    .from(schema.metadata)
    .where(eq(schema.metadata.key, 'last_indexed_block_polygon'))
    .get();
  return row?.value ? BigInt(row.value) : START_BLOCK;
}

async function setLastIndexedBlock(block: bigint): Promise<void> {
  await db.insert(schema.metadata)
    .values({ key: 'last_indexed_block_polygon', value: block.toString() })
    .onConflictDoUpdate({
      target: schema.metadata.key,
      set: { value: block.toString() },
    });
}

async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
  const block = await withRetry(
    () => client.getBlock({ blockNumber }),
    `getBlock(${blockNumber})`
  );
  return Number(block.timestamp);
}

async function getTransactionSender(txHash: string): Promise<string | null> {
  try {
    const tx = await withRetry(
      () => client.getTransaction({ hash: txHash as `0x${string}` }),
      `getTransaction(${txHash})`
    );
    return tx.from;
  } catch {
    return null;
  }
}

async function indexBatch(fromBlock: bigint, toBlock: bigint): Promise<void> {
  console.log(`Indexing blocks ${fromBlock} to ${toBlock}...`);

  // Fetch logs from both contracts with retry
  const [smartWalletLogs, relayLogs] = await withRetry(
    () => Promise.all([
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
    ]),
    `getLogs(${fromBlock}-${toBlock})`
  );

  // Block timestamps cache for this batch
  const timestamps = new Map<bigint, number>();
  // Transaction sender cache for this batch (for relayer identification)
  const txSenders = new Map<string, string | null>();

  // Collect all events to insert in a single transaction
  const eventsToInsert: schema.NewEvent[] = [];

  // Process SmartWallet events (currently no events from this contract)
  for (const log of smartWalletLogs) {
    const decodedEvents = decodeSmartWalletEvent(log);
    if (decodedEvents.length === 0) continue;

    // Get timestamp
    if (!timestamps.has(log.blockNumber)) {
      timestamps.set(log.blockNumber, await getBlockTimestamp(log.blockNumber));
    }

    // Process each decoded event (Shield can have multiple commitments)
    for (let i = 0; i < decodedEvents.length; i++) {
      const decoded = decodedEvents[i];

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

      eventsToInsert.push({
        chain: 'polygon',
        txHash: log.transactionHash,
        logIndex: log.logIndex * 100 + i, // Sub-index for multiple events per log
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
      });
    }
  }

  // Process Relay events (Shield/Unshield)
  for (const log of relayLogs) {
    const decodedEvents = decodeRelayEvent(log, RELAY_ABI);
    if (decodedEvents.length === 0) continue;

    if (!timestamps.has(log.blockNumber)) {
      timestamps.set(log.blockNumber, await getBlockTimestamp(log.blockNumber));
    }

    for (let i = 0; i < decodedEvents.length; i++) {
      const decoded = decodedEvents[i];

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

      // For withdrawals, fetch the transaction sender as the relayer
      let relayerAddress = decoded.relayerAddress;
      if (decoded.eventType === 'withdrawal' && !relayerAddress) {
        const txHash = log.transactionHash;
        if (!txSenders.has(txHash)) {
          txSenders.set(txHash, await getTransactionSender(txHash));
        }
        relayerAddress = txSenders.get(txHash) || null;
      }

      eventsToInsert.push({
        chain: 'polygon',
        txHash: log.transactionHash,
        logIndex: log.logIndex * 100 + i,
        blockNumber: Number(log.blockNumber),
        blockTimestamp: timestamps.get(log.blockNumber)!,
        contractName: 'Relay',
        eventName: decoded.eventName,
        eventType: decoded.eventType,
        tokenId,
        rawAmountWei: decoded.rawAmountWei,
        amountNormalized,
        relayerAddress,
        fromAddress: decoded.fromAddress,
        toAddress: decoded.toAddress,
        metadataJson: JSON.stringify(decoded.metadata),
      });
    }
  }

  // Insert all events in a single transaction (reduces lock contention)
  if (eventsToInsert.length > 0) {
    await withRetry(
      async () => {
        await db.transaction(async (tx) => {
          // Insert in chunks of 100 to avoid SQLite variable limits
          const CHUNK_SIZE = 100;
          for (let i = 0; i < eventsToInsert.length; i += CHUNK_SIZE) {
            const chunk = eventsToInsert.slice(i, i + CHUNK_SIZE);
            await tx.insert(schema.events).values(chunk).onConflictDoNothing();
          }
        });
      },
      `insert ${eventsToInsert.length} events`
    );
  }

  console.log(`  Processed: SmartWallet=${smartWalletLogs.length}, Relay=${relayLogs.length}, Decoded=${eventsToInsert.length}`);
}

async function main() {
  console.log('Starting Polygon indexer...');

  const latestBlock = await withRetry(
    () => client.getBlockNumber(),
    'getBlockNumber'
  );
  const safeBlock = latestBlock - CONFIRMATION_BLOCKS;
  let currentBlock = await getLastIndexedBlock();

  console.log(`Latest: ${latestBlock}, Safe: ${safeBlock}, Current: ${currentBlock}`);

  while (currentBlock < safeBlock) {
    const toBlock = currentBlock + BATCH_SIZE > safeBlock
      ? safeBlock
      : currentBlock + BATCH_SIZE;

    try {
      await indexBatch(currentBlock + 1n, toBlock);
      await setLastIndexedBlock(toBlock);
      currentBlock = toBlock;
    } catch (err) {
      console.error(`Failed to index batch ${currentBlock + 1n}-${toBlock}:`, err);
      throw err; // Re-throw after logging; can be changed to continue for resilience
    }

    // Clear token cache periodically to free memory
    clearTokenCache();

    // Delay between batches to avoid rate limiting on public RPCs
    if (BATCH_DELAY_MS > 0) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log('Indexing complete.');
}

main().catch(console.error);

