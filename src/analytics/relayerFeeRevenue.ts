import { db, schema } from '../db/client';
import { sql, eq, isNotNull, and } from 'drizzle-orm';

async function computeRelayerFeeRevenue() {
  console.log('Computing relayer fee revenue...');

  // Clear existing data
  await db.delete(schema.relayerFeeRevenueDaily);

  // Get all withdrawal events with relayer addresses and fees
  // We'll extract fee from metadataJson in JavaScript since SQLite json_extract can be finicky
  const withdrawals = await db
    .select({
      date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`.as('date'),
      chain: schema.events.chain,
      relayerAddress: schema.events.relayerAddress,
      tokenId: schema.events.tokenId,
      metadataJson: schema.events.metadataJson,
      tokenDecimals: schema.tokens.decimals,
    })
    .from(schema.events)
    .leftJoin(schema.tokens, eq(schema.events.tokenId, schema.tokens.id))
    .where(and(
      eq(schema.events.eventType, 'withdrawal'),
      isNotNull(schema.events.relayerAddress),
      isNotNull(schema.events.tokenId),
      isNotNull(schema.events.metadataJson)
    ));

  // Group by date, chain, relayer, and token
  const grouped = new Map<string, {
    date: string;
    chain: string;
    relayerAddress: string;
    tokenId: number;
    tokenDecimals: number | null;
    fees: string[]; // Array of fee strings in wei
  }>();

  for (const w of withdrawals) {
    if (!w.relayerAddress || !w.date || !w.chain || !w.tokenId || !w.metadataJson) continue;
    
    // Parse metadata JSON to extract fee
    let feeWei: string | null = null;
    try {
      const metadata = JSON.parse(w.metadataJson);
      if (metadata && typeof metadata.fee === 'string') {
        feeWei = metadata.fee;
      }
    } catch (e) {
      // Skip if JSON parsing fails
      continue;
    }
    
    if (!feeWei) continue;
    
    const key = `${w.date}|${w.chain}|${w.relayerAddress}|${w.tokenId}`;
    
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: w.date,
        chain: w.chain,
        relayerAddress: w.relayerAddress,
        tokenId: w.tokenId,
        tokenDecimals: w.tokenDecimals,
        fees: [],
      });
    }
    
    grouped.get(key)!.fees.push(feeWei);
  }

  // Compute aggregates and insert
  for (const [key, data] of grouped) {
    // Sum all fees in wei
    let totalFeeWei = 0n;
    for (const feeStr of data.fees) {
      try {
        totalFeeWei += BigInt(feeStr);
      } catch (e) {
        console.warn(`Invalid fee value: ${feeStr}`);
      }
    }

    // Normalize fee
    const decimals = data.tokenDecimals || 18;
    const totalFeeNormalized = Number(totalFeeWei) / Math.pow(10, decimals);
    const avgFeeNormalized = data.fees.length > 0 ? totalFeeNormalized / data.fees.length : 0;

    await db.insert(schema.relayerFeeRevenueDaily).values({
      date: data.date,
      chain: data.chain,
      relayerAddress: data.relayerAddress,
      tokenId: data.tokenId,
      totalFeeWei: totalFeeWei.toString(),
      totalFeeNormalized,
      txCount: data.fees.length,
      avgFeeNormalized,
    });
  }

  console.log(`Relayer fee revenue computed for ${grouped.size} relayer-token-date combinations`);
}

computeRelayerFeeRevenue().catch(console.error);

