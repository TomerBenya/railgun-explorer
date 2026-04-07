import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { db } from './db/client';
import { resolve, dirname } from 'path';

// Run migrations on startup
const migrationsFolder = resolve(dirname(import.meta.path), '../drizzle');
console.log('Running migrations...');
migrate(db, { migrationsFolder });
console.log('Migrations complete.');

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
