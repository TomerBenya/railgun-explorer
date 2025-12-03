import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';
import { resolve, dirname } from 'path';

// Resolve DB path relative to project root (two levels up from src/db/)
const PROJECT_ROOT = resolve(dirname(import.meta.path), '../..');
const DB_PATH = process.env.DB_PATH || resolve(PROJECT_ROOT, 'railgun_eth.sqlite');

const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.exec('PRAGMA journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export { schema };
