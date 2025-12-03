import { spawn, type Subprocess } from 'bun';

const INDEXER_RESTART_DELAY_MS = 60_000;

async function runAnalytics(): Promise<void> {
  console.log('[start-all] Running analytics...');

  // Run daily flows analytics
  const flowsProc = spawn(['bun', 'run', 'src/analytics/dailyFlows.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });
  await flowsProc.exited;

  // Run relayer stats analytics
  const relayerProc = spawn(['bun', 'run', 'src/analytics/relayerStats.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });
  await relayerProc.exited;

  console.log('[start-all] Analytics complete.');
}

function startIndexer(): Subprocess {
  console.log('[start-all] Starting indexer...');

  const proc = spawn(['bun', 'run', 'src/indexer/indexEthereum.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });

  proc.exited.then(async (code) => {
    console.log(`[start-all] Indexer exited with code ${code}`);

    // Run analytics after indexer completes (regardless of exit code)
    try {
      await runAnalytics();
    } catch (err) {
      console.error('[start-all] Analytics failed:', err);
    }

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

  // Start the web server first (runs migrations on startup)
  console.log('[start-all] Starting web server...');
  await import('./server');

  // Start the indexer in the background after server is ready
  startIndexer();
}

main().catch((err) => {
  console.error('[start-all] Fatal error:', err);
  process.exit(1);
});
