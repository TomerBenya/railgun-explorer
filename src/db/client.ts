import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

const DB_PATH = process.env.DB_PATH || './railgun_eth.sqlite';

const sqlite = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
sqlite.exec('PRAGMA journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export { schema };
