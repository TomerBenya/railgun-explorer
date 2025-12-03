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

console.log(`Starting server on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
