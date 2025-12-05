import { db, schema } from '../db/client';
import { sql, eq, isNotNull, and } from 'drizzle-orm';

async function computeRelayerStats() {
  console.log('Computing relayer stats...');

  // Clear existing data
  await db.delete(schema.relayerStatsDaily);

  // Get all withdrawals with relayer addresses, grouped by date, chain, and relayer
  // The relayer is the transaction sender (msg.sender) who submitted the withdrawal
  const payments = await db
    .select({
      date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`.as('date'),
      chain: schema.events.chain,
      relayerAddress: schema.events.relayerAddress,
      volume: sql<number>`sum(${schema.events.amountNormalized})`,
      txCount: sql<number>`count(*)`,
    })
    .from(schema.events)
    .where(and(
      eq(schema.events.eventType, 'withdrawal'),
      isNotNull(schema.events.relayerAddress)
    ))
    .groupBy(sql`date(${schema.events.blockTimestamp}, 'unixepoch')`, schema.events.chain, schema.events.relayerAddress);

  // Group by date and chain
  const byDateAndChain = new Map<string, Array<{ relayer: string; volume: number; txCount: number }>>();

  for (const p of payments) {
    if (!p.relayerAddress || !p.date || !p.chain) continue;
    const key = `${p.date}|${p.chain}`;
    if (!byDateAndChain.has(key)) {
      byDateAndChain.set(key, []);
    }
    byDateAndChain.get(key)!.push({
      relayer: p.relayerAddress,
      volume: p.volume || 0,
      txCount: p.txCount || 0,
    });
  }

  // Compute stats for each date and chain
  for (const [key, relayers] of byDateAndChain) {
    const [date, chain] = key.split('|');
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
      chain: chain || 'ethereum', // Fallback to ethereum if chain is null
      numActiveRelayers,
      top5Share,
      hhi,
      relayerTxCount: totalTxCount,
    });
  }

  console.log(`Relayer stats computed for ${byDateAndChain.size} date-chain combinations`);
}

computeRelayerStats().catch(console.error);
