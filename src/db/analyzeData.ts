import { db, schema } from './client';
import { sql, desc, eq } from 'drizzle-orm';

async function analyzeData() {
  console.log('\n📊 COMPREHENSIVE DATA ANALYSIS\n');
  console.log('================================\n');

  // 1. Event type distribution
  const eventTypes = await db.select({
    eventType: schema.events.eventType,
    chain: schema.events.chain,
    count: sql<number>`count(*)`,
  })
  .from(schema.events)
  .groupBy(schema.events.eventType, schema.events.chain)
  .orderBy(schema.events.chain, desc(sql`count(*)`));

  console.log('1. Event Type Distribution by Chain:');
  eventTypes.forEach(row => {
    console.log(`   ${row.chain.padEnd(10)} | ${row.eventType.padEnd(15)} | ${row.count} events`);
  });

  // 2. Top 10 tokens by volume
  const topTokens = await db.select({
    symbol: schema.tokens.symbol,
    chain: schema.tokens.chain,
    totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
    totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
    txCount: sql<number>`sum(${schema.dailyFlows.depositTxCount} + ${schema.dailyFlows.withdrawalTxCount})`,
  })
  .from(schema.tokens)
  .leftJoin(schema.dailyFlows, eq(schema.tokens.id, schema.dailyFlows.tokenId))
  .groupBy(schema.tokens.id, schema.tokens.symbol, schema.tokens.chain)
  .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`))
  .limit(10);

  console.log('\n2. Top 10 Tokens by Total Deposit Volume:');
  topTokens.forEach((t, i) => {
    const deposits = Number(t.totalDeposits || 0).toFixed(2).padStart(12);
    const withdrawals = Number(t.totalWithdrawals || 0).toFixed(2).padStart(12);
    console.log(`   ${(i+1).toString().padStart(2)}. ${(t.symbol || 'null').padEnd(10)} (${t.chain}) | Deposits: ${deposits} | Withdrawals: ${withdrawals} | ${t.txCount} txs`);
  });

  // 3. Daily activity summary
  const dailyActivity = await db.select({
    date: schema.dailyFlows.date,
    totalVolume: sql<number>`sum(${schema.dailyFlows.totalDeposits} + ${schema.dailyFlows.totalWithdrawals})`,
    uniqueTokens: sql<number>`count(distinct ${schema.dailyFlows.tokenId})`,
    totalTx: sql<number>`sum(${schema.dailyFlows.depositTxCount} + ${schema.dailyFlows.withdrawalTxCount})`,
  })
  .from(schema.dailyFlows)
  .groupBy(schema.dailyFlows.date)
  .orderBy(desc(schema.dailyFlows.date))
  .limit(10);

  console.log('\n3. Recent Daily Activity (Last 10 Days):');
  dailyActivity.forEach(day => {
    const volume = Number(day.totalVolume).toFixed(2).padStart(12);
    console.log(`   ${day.date} | Volume: ${volume} | ${day.uniqueTokens} tokens | ${day.totalTx} txs`);
  });

  // 4. Sample events
  const sampleEvents = await db.select({
    chain: schema.events.chain,
    date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`,
    eventType: schema.events.eventType,
    symbol: schema.tokens.symbol,
    amount: schema.events.amountNormalized,
    txHash: schema.events.txHash,
  })
  .from(schema.events)
  .leftJoin(schema.tokens, eq(schema.events.tokenId, schema.tokens.id))
  .limit(5);

  console.log('\n4. Sample Events:');
  sampleEvents.forEach((e, i) => {
    console.log(`   ${i+1}. [${e.chain}] ${e.date} | ${e.eventType.padEnd(10)} | ${(e.symbol || 'null').padEnd(8)} | ${e.amount} | ${e.txHash.substring(0, 10)}...`);
  });

  // 5. Date range per chain
  const ethDateRange = await db.select({
    minDate: sql<number>`min(${schema.events.blockTimestamp})`,
    maxDate: sql<number>`max(${schema.events.blockTimestamp})`,
  })
  .from(schema.events)
  .where(eq(schema.events.chain, 'ethereum'));

  const polyDateRange = await db.select({
    minDate: sql<number>`min(${schema.events.blockTimestamp})`,
    maxDate: sql<number>`max(${schema.events.blockTimestamp})`,
  })
  .from(schema.events)
  .where(eq(schema.events.chain, 'polygon'));

  console.log('\n5. Date Ranges by Chain:');
  const ethMin = new Date(ethDateRange[0].minDate * 1000).toISOString().split('T')[0];
  const ethMax = new Date(ethDateRange[0].maxDate * 1000).toISOString().split('T')[0];
  const polyMin = new Date(polyDateRange[0].minDate * 1000).toISOString().split('T')[0];
  const polyMax = new Date(polyDateRange[0].maxDate * 1000).toISOString().split('T')[0];
  const ethDays = Math.ceil((ethDateRange[0].maxDate - ethDateRange[0].minDate) / 86400);
  const polyDays = Math.ceil((polyDateRange[0].maxDate - polyDateRange[0].minDate) / 86400);
  console.log(`   Ethereum: ${ethMin} to ${ethMax} (${ethDays} days)`);
  console.log(`   Polygon:  ${polyMin} to ${polyMax} (${polyDays} days)`);

  // 6. Relayer stats summary
  const relayerSummary = await db.select({
    avgActiveRelayers: sql<number>`avg(${schema.relayerStatsDaily.numActiveRelayers})`,
    avgHHI: sql<number>`avg(${schema.relayerStatsDaily.hhi})`,
    avgTop5Share: sql<number>`avg(${schema.relayerStatsDaily.top5Share})`,
    totalRelayerTx: sql<number>`sum(${schema.relayerStatsDaily.relayerTxCount})`,
  })
  .from(schema.relayerStatsDaily);

  console.log('\n6. Relayer Concentration Summary:');
  const summary = relayerSummary[0];
  console.log(`   Avg Active Relayers per Day: ${Number(summary.avgActiveRelayers || 0).toFixed(2)}`);
  console.log(`   Avg HHI (concentration): ${Number(summary.avgHHI || 0).toFixed(4)}`);
  console.log(`   Avg Top 5 Share: ${(Number(summary.avgTop5Share || 0) * 100).toFixed(2)}%`);
  console.log(`   Total Relayer Transactions: ${summary.totalRelayerTx}`);

  console.log('\n================================\n');
}

analyzeData().catch(console.error);
