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
  let symbol: string | null = null;
  let decimals: number | null = null;

  try {
    const [fetchedSymbol, fetchedDecimals] = await Promise.all([
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
    symbol = fetchedSymbol;
    decimals = fetchedDecimals;
  } catch (err) {
    // Non-standard token, continue with null metadata
    console.warn(`Failed to fetch metadata for ${checksummed}:`, err);
  }

  // Insert with onConflictDoNothing to handle race conditions
  await db.insert(schema.tokens)
    .values({ address: checksummed, symbol, decimals })
    .onConflictDoNothing();

  // Query to get the ID (handles both new insert and existing)
  const inserted = await db.select()
    .from(schema.tokens)
    .where(eq(schema.tokens.address, checksummed))
    .get();

  if (inserted) {
    tokenCache.set(checksummed, inserted.id);
    return inserted.id;
  }

  return null;
}

export function clearTokenCache() {
  tokenCache.clear();
}
