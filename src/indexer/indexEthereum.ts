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

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '0'); // 0 for paid RPCs; set to 2000 for public RPCs

const client = createPublicClient({
  chain: mainnet,
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
      console.warn(`${context} failed (attempt ${attempt}/${MAX_RETRIES}): ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastError;
}

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

  // Fetch logs from both contracts in parallel
  const [smartWalletLogs, relayLogs] = await withRetry(
    () => Promise.all([
      client.getLogs({ address: CONTRACTS.smartWallet, fromBlock, toBlock }),
      client.getLogs({ address: CONTRACTS.relay, fromBlock, toBlock }),
    ]),
    `getLogs(${fromBlock}-${toBlock})`
  );

  // Decode all logs first (synchronous)
  type PendingEvent = {
    contractName: string;
    log: typeof smartWalletLogs[number];
    decoded: ReturnType<typeof decodeSmartWalletEvent>[number];
    subIndex: number;
    isWithdrawal: boolean;
  };

  const pending: PendingEvent[] = [];

  for (const log of smartWalletLogs) {
    const decoded = decodeSmartWalletEvent(log);
    decoded.forEach((d, i) => pending.push({ contractName: 'SmartWallet', log, decoded: d, subIndex: i, isWithdrawal: false }));
  }
  for (const log of relayLogs) {
    const decoded = decodeRelayEvent(log);
    decoded.forEach((d, i) => pending.push({ contractName: 'Relay', log, decoded: d, subIndex: i, isWithdrawal: d.eventType === 'withdrawal' }));
  }

  if (pending.length === 0) {
    console.log(`  Processed: SmartWallet=${smartWalletLogs.length}, Relay=${relayLogs.length}, Decoded=0`);
    return;
  }

  // Pre-fetch all unique block timestamps in parallel
  const uniqueBlocks = [...new Set(pending.map(p => p.log.blockNumber))];
  const timestampEntries = await Promise.all(
    uniqueBlocks.map(async bn => [bn, await getBlockTimestamp(bn)] as const)
  );
  const timestamps = new Map<bigint, number>(timestampEntries);

  // Pre-fetch all withdrawal tx senders in parallel
  const withdrawalTxHashes = [...new Set(pending.filter(p => p.isWithdrawal).map(p => p.log.transactionHash))];
  const senderEntries = await Promise.all(
    withdrawalTxHashes.map(async h => [h, await getTransactionSender(h)] as const)
  );
  const txSenders = new Map<string, string | null>(senderEntries);

  // Pre-resolve all unique token addresses in parallel
  const uniqueTokenAddresses = [...new Set(pending.map(p => p.decoded.tokenAddress).filter((a): a is string => a !== null))];
  const tokenIdEntries = await Promise.all(
    uniqueTokenAddresses.map(async addr => [addr, await resolveTokenId(addr)] as const)
  );
  const tokenIdMap = new Map<string, number | null>(tokenIdEntries);

  // Fetch decimals for all resolved tokens in parallel
  const uniqueTokenIds = [...new Set(tokenIdEntries.map(([, id]) => id).filter((id): id is number => id !== null))];
  const tokenDecimalEntries = await Promise.all(
    uniqueTokenIds.map(async id => {
      const token = await db.select().from(schema.tokens).where(eq(schema.tokens.id, id)).get();
      return [id, token?.decimals ?? null] as const;
    })
  );
  const tokenDecimals = new Map<number, number | null>(tokenDecimalEntries);

  // Insert all events in a single transaction
  await db.transaction(async (tx) => {
    for (const { contractName, log, decoded, subIndex, isWithdrawal } of pending) {
      const tokenId = decoded.tokenAddress ? (tokenIdMap.get(decoded.tokenAddress) ?? null) : null;
      const decimals = tokenId !== null ? (tokenDecimals.get(tokenId) ?? null) : null;

      let amountNormalized: number | null = null;
      if (decoded.rawAmountWei && decimals !== null) {
        amountNormalized = Number(BigInt(decoded.rawAmountWei)) / Math.pow(10, decimals);
      }

      const relayerAddress = isWithdrawal
        ? (txSenders.get(log.transactionHash) ?? decoded.relayerAddress)
        : decoded.relayerAddress;

      await tx.insert(schema.events)
        .values({
          chain: 'ethereum',
          txHash: log.transactionHash,
          logIndex: log.logIndex * 100 + subIndex,
          blockNumber: Number(log.blockNumber),
          blockTimestamp: timestamps.get(log.blockNumber)!,
          contractName,
          eventName: decoded.eventName,
          eventType: decoded.eventType,
          tokenId,
          rawAmountWei: decoded.rawAmountWei,
          amountNormalized,
          relayerAddress,
          fromAddress: decoded.fromAddress,
          toAddress: decoded.toAddress,
          metadataJson: JSON.stringify(decoded.metadata),
        })
        .onConflictDoNothing();
    }
  });

  console.log(`  Processed: SmartWallet=${smartWalletLogs.length}, Relay=${relayLogs.length}, Decoded=${pending.length}`);
}

async function main() {
  console.log('Starting Ethereum indexer...');

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
