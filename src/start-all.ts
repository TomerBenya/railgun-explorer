import { spawn, type Subprocess } from 'bun';

const INDEXER_RESTART_DELAY_MS = 60_000;
const POLYGON_INDEXER_RESTART_DELAY_MS = 90_000; // Longer delay for Polygon due to rate limits
const ANALYTICS_INTERVAL_MS = 5 * 60 * 1000; // Run analytics every 5 minutes

let analyticsRunning = false;

// Track indexer status for the /status endpoint
export const indexerStatus = {
  ethereum: {
    running: false,
    lastStarted: null as Date | null,
    lastCompleted: null as Date | null,
    lastExitCode: null as number | null,
  },
  polygon: {
    running: false,
    lastStarted: null as Date | null,
    lastCompleted: null as Date | null,
    lastExitCode: null as number | null,
  },
};

async function runAnalytics(): Promise<void> {
  if (analyticsRunning) {
    console.log('[start-all] Analytics already running, skipping...');
    return;
  }

  analyticsRunning = true;
  console.log('[start-all] Running analytics...');

  try {
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
  } finally {
    analyticsRunning = false;
  }
}

function startAnalyticsInterval(): void {
  // Run analytics immediately on startup
  runAnalytics().catch(console.error);

  // Then run periodically
  setInterval(() => {
    runAnalytics().catch(console.error);
  }, ANALYTICS_INTERVAL_MS);
}

function startEthereumIndexer(): Subprocess {
  console.log('[start-all] Starting Ethereum indexer...');
  indexerStatus.ethereum.running = true;
  indexerStatus.ethereum.lastStarted = new Date();

  const proc = spawn(['bun', 'run', 'src/indexer/indexEthereum.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });

  proc.exited.then(async (code) => {
    console.log(`[start-all] Ethereum indexer exited with code ${code}`);
    indexerStatus.ethereum.running = false;
    indexerStatus.ethereum.lastCompleted = new Date();
    indexerStatus.ethereum.lastExitCode = code;

    // Run analytics after indexer completes
    try {
      await runAnalytics();
    } catch (err) {
      console.error('[start-all] Analytics failed:', err);
    }

    if (code !== 0) {
      console.log(`[start-all] Restarting Ethereum indexer in ${INDEXER_RESTART_DELAY_MS / 1000}s...`);
      setTimeout(() => startEthereumIndexer(), INDEXER_RESTART_DELAY_MS);
    } else {
      // Indexer completed successfully (caught up), restart after delay to check for new blocks
      console.log(`[start-all] Ethereum indexer caught up, checking for new blocks in ${INDEXER_RESTART_DELAY_MS / 1000}s...`);
      setTimeout(() => startEthereumIndexer(), INDEXER_RESTART_DELAY_MS);
    }
  });

  return proc;
}

function startPolygonIndexer(): Subprocess {
  console.log('[start-all] Starting Polygon indexer...');
  indexerStatus.polygon.running = true;
  indexerStatus.polygon.lastStarted = new Date();

  const proc = spawn(['bun', 'run', 'src/indexer/indexPolygon.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: process.cwd(),
  });

  proc.exited.then(async (code) => {
    console.log(`[start-all] Polygon indexer exited with code ${code}`);
    indexerStatus.polygon.running = false;
    indexerStatus.polygon.lastCompleted = new Date();
    indexerStatus.polygon.lastExitCode = code;

    // Run analytics after indexer completes
    try {
      await runAnalytics();
    } catch (err) {
      console.error('[start-all] Analytics failed:', err);
    }

    if (code !== 0) {
      console.log(`[start-all] Restarting Polygon indexer in ${POLYGON_INDEXER_RESTART_DELAY_MS / 1000}s...`);
      setTimeout(() => startPolygonIndexer(), POLYGON_INDEXER_RESTART_DELAY_MS);
    } else {
      // Indexer completed successfully (caught up), restart after delay to check for new blocks
      console.log(`[start-all] Polygon indexer caught up, checking for new blocks in ${POLYGON_INDEXER_RESTART_DELAY_MS / 1000}s...`);
      setTimeout(() => startPolygonIndexer(), POLYGON_INDEXER_RESTART_DELAY_MS);
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

  // Start periodic analytics (runs immediately, then every 5 minutes)
  startAnalyticsInterval();

  // Start both indexers in the background after server is ready
  startEthereumIndexer();
  startPolygonIndexer();
}

main().catch((err) => {
  console.error('[start-all] Fatal error:', err);
  process.exit(1);
});
