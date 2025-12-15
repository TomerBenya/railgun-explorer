import { db, schema } from '../db/client';
import { sql } from 'drizzle-orm';

async function computeTokenDiversity() {
  console.log('Computing daily token diversity...');

  // Clear existing data
  await db.delete(schema.dailyTokenDiversity);

  // Query events with COUNT(DISTINCT tokenId) per date per chain
  const diversity = await db.select({
    date: sql<string>`date(${schema.events.blockTimestamp}, 'unixepoch')`,
    chain: schema.events.chain,
    uniqueTokenCount: sql<number>`count(distinct ${schema.events.tokenId})`,
  })
  .from(schema.events)
  .where(sql`${schema.events.tokenId} is not null`)
  .groupBy(
    sql`date(${schema.events.blockTimestamp}, 'unixepoch')`,
    schema.events.chain
  );

  let inserted = 0;
  for (const row of diversity) {
    await db.insert(schema.dailyTokenDiversity).values({
      date: row.date,
      chain: row.chain || 'ethereum',
      uniqueTokenCount: row.uniqueTokenCount || 0,
    });
    inserted++;
  }

  console.log(`Token diversity computed: ${inserted} rows inserted`);
}

computeTokenDiversity().catch(console.error);
