import { spawn, type Subprocess } from 'bun';

const INDEXER_RESTART_DELAY_MS = 60_000;

function startIndexer(): Subprocess {
  console.log('[start-all] Starting indexer...');

  const proc = spawn(['bun', 'run', 'src/indexer/indexEthereum.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });

  proc.exited.then((code) => {
    console.log(`[start-all] Indexer exited with code ${code}`);
    if (code !== 0) {
      console.log(`[start-all] Restarting indexer in ${INDEXER_RESTART_DELAY_MS / 1000}s...`);
      setTimeout(() => startIndexer(), INDEXER_RESTART_DELAY_MS);
    } else {
      // Indexer completed successfully (caught up), restart after delay to check for new blocks
      console.log(`[start-all] Indexer caught up, checking for new blocks in ${INDEXER_RESTART_DELAY_MS / 1000}s...`);
      setTimeout(() => startIndexer(), INDEXER_RESTART_DELAY_MS);
    }
  });

  return proc;
}

async function main() {
  const dbPath = process.env.DB_PATH || './railgun_eth.sqlite';
  console.log(`[start-all] Database path: ${dbPath}`);

  // Run migrations first
  console.log('[start-all] Running database migrations...');
  const migrateProc = spawn(['bun', 'run', 'src/db/migrate.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });

  const migrateCode = await migrateProc.exited;
  if (migrateCode !== 0) {
    console.error('[start-all] Migration failed, exiting');
    process.exit(1);
  }

  // Start the indexer in the background
  startIndexer();

  // Start the web server (keeps process alive)
  console.log('[start-all] Starting web server...');
  await import('./server');
}

main().catch((err) => {
  console.error('[start-all] Fatal error:', err);
  process.exit(1);
});
