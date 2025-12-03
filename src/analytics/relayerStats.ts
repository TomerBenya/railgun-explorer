import { db, schema } from '../db/client';
import { sql, eq, isNotNull, and } from 'drizzle-orm';

async function computeRelayerStats() {
  console.log('Computing relayer stats...');

  // Clear existing data
  await db.delete(schema.relayerStatsDaily);

  // Get all withdrawals with relayer addresses, grouped by date and relayer
  // The relayer is the transaction sender (msg.sender) who submitted the withdrawal
  const payments = await db
    .select({
      date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`.as('date'),
      relayerAddress: schema.events.relayerAddress,
      volume: sql<number>`sum(${schema.events.amountNormalized})`,
      txCount: sql<number>`count(*)`,
    })
    .from(schema.events)
    .where(and(
      eq(schema.events.eventType, 'withdrawal'),
      isNotNull(schema.events.relayerAddress)
    ))
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
