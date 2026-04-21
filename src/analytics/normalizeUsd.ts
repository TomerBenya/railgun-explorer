import { db, schema } from '../db/client';
import { sql } from 'drizzle-orm';

// Back-populates USD columns in daily_flows by joining with token_prices_daily.
// Runs after dailyFlows.ts (which wipes and re-inserts rows with null USD) and
// fetchPrices.ts (which populates token_prices_daily from DeFiLlama).
async function normalizeUsd() {
  console.log('Normalizing daily_flows to USD...');

  await db.run(sql`
    UPDATE daily_flows
    SET
      total_deposits_usd    = total_deposits    * p.price_usd,
      total_withdrawals_usd = total_withdrawals * p.price_usd,
      net_flow_usd          = net_flow          * p.price_usd
    FROM token_prices_daily AS p
    WHERE daily_flows.date     = p.date
      AND daily_flows.chain    = p.chain
      AND daily_flows.token_id = p.token_id
  `);

  const [stats] = await db
    .select({
      filled: sql<number>`sum(case when ${schema.dailyFlows.totalDepositsUsd} is not null then 1 else 0 end)`,
      missing: sql<number>`sum(case when ${schema.dailyFlows.totalDepositsUsd} is null then 1 else 0 end)`,
      totalUsd: sql<number>`coalesce(sum(${schema.dailyFlows.totalDepositsUsd}), 0)`,
    })
    .from(schema.dailyFlows);

  console.log(
    `USD normalization complete: ${stats.filled} rows priced, ` +
    `${stats.missing} missing (no price available), ` +
    `total deposit volume $${Math.round(stats.totalUsd).toLocaleString()}.`
  );
}

normalizeUsd().catch(console.error);
