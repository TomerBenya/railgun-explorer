import { createPublicClient, http, erc20Abi, getAddress } from 'viem';
import { polygon } from 'viem/chains';
import { db, schema } from '../db/client';
import { eq, and } from 'drizzle-orm';

const RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.infura.io/v3/4354acaa8fa44b48b106f9596411a10e';

const client = createPublicClient({
  chain: polygon,
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

  // Check database (Polygon chain)
  const existing = await db.select()
    .from(schema.tokens)
    .where(and(eq(schema.tokens.address, checksummed), eq(schema.tokens.chain, 'polygon')))
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
    .values({ chain: 'polygon', address: checksummed, symbol, decimals })
    .onConflictDoNothing();

  // Query to get the ID (handles both new insert and existing)
  const inserted = await db.select()
    .from(schema.tokens)
    .where(and(eq(schema.tokens.address, checksummed), eq(schema.tokens.chain, 'polygon')))
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

