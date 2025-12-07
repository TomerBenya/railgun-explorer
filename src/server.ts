import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { db, schema } from './db/client';
import { eq } from 'drizzle-orm';
import { resolve, dirname } from 'path';

// Run migrations on startup
const migrationsFolder = resolve(dirname(import.meta.path), '../drizzle');
console.log('Running migrations...');
migrate(db, { migrationsFolder });
console.log('Migrations complete.');

// One-time data migration: Reset Polygon events to re-index with fixed decoder
// This runs once and sets a flag in metadata to prevent re-running
// v3: Re-index with complete SmartWallet + Relay decoder for both deposits and withdrawals
const POLYGON_RESET_KEY = 'polygon_events_reset_v3';
const resetCheck = db.select().from(schema.metadata).where(eq(schema.metadata.key, POLYGON_RESET_KEY)).get();

if (!resetCheck) {
  console.log('[Migration] Resetting Polygon events for decoder fix...');

  // Delete all Polygon events (they'll be re-indexed with correct amounts)
  db.delete(schema.events).where(eq(schema.events.chain, 'polygon')).run();

  // Reset Polygon indexer position
  db.delete(schema.metadata).where(eq(schema.metadata.key, 'last_indexed_block_polygon')).run();

  // Mark migration as complete
  db.insert(schema.metadata).values({ key: POLYGON_RESET_KEY, value: new Date().toISOString() }).run();

  console.log('[Migration] Polygon events cleared. Indexer will re-fetch with fixed decoder.');
} else {
  console.log('[Migration] Polygon reset already applied, skipping.');
}

// Import app after migrations
const { default: app } = await import('./web/app');

const port = parseInt(process.env.PORT || '3000');

console.log(`Starting server on http://0.0.0.0:${port}`);

// Explicitly start the server (required when imported, not just run directly)
const server = Bun.serve({
  port,
  hostname: '0.0.0.0', // Required for Railway/cloud deployment
  fetch: async (req) => {
    try {
      return await app.fetch(req);
    } catch (error) {
      console.error('Unhandled error in fetch:', error);
      return new Response(`Internal Server Error: ${error instanceof Error ? error.message : String(error)}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  },
  error(error) {
    console.error('Server error:', error);
    return new Response(`Server Error: ${error.message}`, { status: 500 });
  },
});

console.log(`Server running on http://0.0.0.0:${server.port}`);

export { server };
export default app;
