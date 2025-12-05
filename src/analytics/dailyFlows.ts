import { db, schema } from '../db/client';
import { sql, eq } from 'drizzle-orm';

const MIN_TX_THRESHOLD = 3;

async function computeDailyFlows() {
  console.log('Computing daily flows...');

  // Clear existing data
  await db.delete(schema.dailyFlows);

  // Query aggregated flows per date per token per chain
  const flows = await db
    .select({
      date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`.as('date'),
      chain: schema.events.chain,
      tokenId: schema.events.tokenId,
      totalDeposits: sql<number>`sum(case when ${schema.events.eventType} = 'deposit' then ${schema.events.amountNormalized} else 0 end)`,
      totalWithdrawals: sql<number>`sum(case when ${schema.events.eventType} = 'withdrawal' then ${schema.events.amountNormalized} else 0 end)`,
      depositTxCount: sql<number>`sum(case when ${schema.events.eventType} = 'deposit' then 1 else 0 end)`,
      withdrawalTxCount: sql<number>`sum(case when ${schema.events.eventType} = 'withdrawal' then 1 else 0 end)`,
    })
    .from(schema.events)
    .where(sql`${schema.events.eventType} in ('deposit', 'withdrawal') and ${schema.events.tokenId} is not null`)
    .groupBy(sql`date(${schema.events.blockTimestamp}, 'unixepoch')`, schema.events.chain, schema.events.tokenId);

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
      chain: flow.chain || 'ethereum', // Fallback to ethereum if chain is null
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
