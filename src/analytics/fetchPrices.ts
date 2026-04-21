import { db, schema } from '../db/client';
import { sql, eq, and } from 'drizzle-orm';

// DeFiLlama historical price endpoint
// GET https://coins.llama.fi/prices/historical/{timestamp}/ethereum:{address}
const DEFILLAMA_BASE = 'https://coins.llama.fi';

// Rate limit: ~300ms between requests to be polite
const RATE_LIMIT_MS = 300;

interface DefiLlamaPrice {
  price: number;
  symbol: string;
  timestamp: number;
  confidence: number;
}

interface DefiLlamaCoinResponse {
  coins: Record<string, DefiLlamaPrice>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Convert "YYYY-MM-DD" to unix timestamp (noon UTC to get mid-day price)
function dateToTimestamp(date: string): number {
  return Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 1000);
}

// Batch fetch prices for multiple tokens at a single timestamp
// DeFiLlama supports comma-separated coin IDs
async function fetchPricesAtTimestamp(
  tokenAddresses: { address: string; chain: string }[],
  timestamp: number
): Promise<Map<string, number>> {
  const coinIds = tokenAddresses.map(t => `${t.chain}:${t.address}`).join(',');
  const url = `${DEFILLAMA_BASE}/prices/historical/${timestamp}/${coinIds}`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`DeFiLlama returned ${res.status} for timestamp ${timestamp}`);
    return new Map();
  }

  const data = (await res.json()) as DefiLlamaCoinResponse;
  const prices = new Map<string, number>();

  for (const [coinId, info] of Object.entries(data.coins)) {
    if (info.price != null && info.confidence > 0.5) {
      // coinId format: "ethereum:0xabc..."
      const address = coinId.split(':')[1];
      prices.set(address.toLowerCase(), info.price);
    }
  }

  return prices;
}

async function fetchAndStorePrices() {
  console.log('Fetching token prices from DeFiLlama...');

  // Get all unique (date, chain, tokenId) combos from daily_flows that don't have prices yet
  const flowDates = await db
    .select({
      date: schema.dailyFlows.date,
      chain: schema.dailyFlows.chain,
      tokenId: schema.dailyFlows.tokenId,
    })
    .from(schema.dailyFlows)
    .groupBy(schema.dailyFlows.date, schema.dailyFlows.chain, schema.dailyFlows.tokenId);

  // Get existing prices to skip
  const existingPrices = await db
    .select({
      date: schema.tokenPricesDaily.date,
      chain: schema.tokenPricesDaily.chain,
      tokenId: schema.tokenPricesDaily.tokenId,
    })
    .from(schema.tokenPricesDaily);

  const existingSet = new Set(
    existingPrices.map(p => `${p.date}|${p.chain}|${p.tokenId}`)
  );

  // Filter to only missing prices
  const missing = flowDates.filter(
    f => !existingSet.has(`${f.date}|${f.chain}|${f.tokenId}`)
  );

  if (missing.length === 0) {
    console.log('All prices already fetched. Nothing to do.');
    return;
  }

  console.log(`Need prices for ${missing.length} (date, chain, token) combos`);

  // Get all token metadata
  const allTokens = await db.select().from(schema.tokens);
  const tokenMap = new Map(allTokens.map(t => [t.id, t]));

  // Group by date so we can batch tokens per timestamp
  const byDate = new Map<string, typeof missing>();
  for (const m of missing) {
    const key = m.date;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(m);
  }

  let fetched = 0;
  let failed = 0;
  const dates = Array.from(byDate.keys()).sort();

  for (const date of dates) {
    const entries = byDate.get(date)!;
    const timestamp = dateToTimestamp(date);

    // Collect unique token addresses for this date
    const tokenAddresses: { address: string; chain: string; tokenId: number }[] = [];
    for (const entry of entries) {
      const token = tokenMap.get(entry.tokenId);
      if (!token?.address) continue;
      tokenAddresses.push({
        address: token.address,
        chain: entry.chain,
        tokenId: entry.tokenId,
      });
    }

    if (tokenAddresses.length === 0) continue;

    // DeFiLlama supports batching up to ~100 coins per request
    // Chunk into batches of 50 to be safe
    const BATCH_SIZE = 50;
    for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
      const batch = tokenAddresses.slice(i, i + BATCH_SIZE);

      try {
        const prices = await fetchPricesAtTimestamp(batch, timestamp);

        for (const item of batch) {
          const price = prices.get(item.address.toLowerCase());
          if (price != null) {
            await db.insert(schema.tokenPricesDaily).values({
              date,
              chain: item.chain,
              tokenId: item.tokenId,
              priceUsd: price,
            }).onConflictDoNothing();
            fetched++;
          } else {
            failed++;
          }
        }
      } catch (err) {
        console.warn(`Error fetching prices for ${date}:`, err);
        failed += batch.length;
      }

      await sleep(RATE_LIMIT_MS);
    }

    // Log progress every 30 dates
    if (dates.indexOf(date) % 30 === 0) {
      console.log(`  Progress: ${date} — ${fetched} prices fetched, ${failed} unavailable`);
    }
  }

  console.log(`Done! ${fetched} prices stored, ${failed} unavailable.`);
}

fetchAndStorePrices().catch(console.error);
