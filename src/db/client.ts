import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { resolve, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

// Resolve DB path - use env var for Railway, otherwise project root
const PROJECT_ROOT = resolve(dirname(import.meta.path), '../..');
const DB_PATH = process.env.DB_PATH || resolve(PROJECT_ROOT, 'railgun_eth.sqlite');

// Ensure parent directory exists (for Railway volume mounts)
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Create database if it doesn't exist
const sqlite = new Database(DB_PATH, { create: true });

// Enable WAL mode for better concurrent read performance
sqlite.exec('PRAGMA journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export { schema };
