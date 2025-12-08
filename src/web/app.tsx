import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { db, schema } from '../db/client';
import { desc, sql, eq, and } from 'drizzle-orm';

type ChainName = 'ethereum' | 'polygon' | 'all';

// Client-side pagination component (renders placeholder, JS handles logic)
function ClientPagination({ tableId, defaultLimit = 20 }: { tableId: string; defaultLimit?: number }) {
  return (
    <div class="pagination" id={`${tableId}-pagination`} data-table={tableId} data-limit={defaultLimit}>
      <div class="pagination-info"></div>
      <div class="pagination-controls">
        <button class="pagination-btn" data-action="first" disabled>« First</button>
        <button class="pagination-btn" data-action="prev" disabled>‹ Prev</button>
        <div class="pagination-pages"></div>
        <button class="pagination-btn" data-action="next">Next ›</button>
        <button class="pagination-btn" data-action="last">Last »</button>
      </div>
      <div class="pagination-size">
        <label>
          Per page:
          <select data-action="limit">
            {[10, 20, 50, 100].map(size => (
              <option value={size} selected={size === defaultLimit}>{size}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// Client-side pagination JavaScript (included once in layout)
const paginationScript = `
(function() {
  class TablePaginator {
    constructor(tableId, defaultLimit = 20) {
      this.tableId = tableId;
      this.table = document.getElementById(tableId);
      this.pagination = document.getElementById(tableId + '-pagination');
      if (!this.table || !this.pagination) return;

      this.tbody = this.table.querySelector('tbody');
      this.rows = Array.from(this.tbody.querySelectorAll('tr[data-row]'));
      this.totalItems = this.rows.length;
      this.currentPage = 1;
      this.limit = parseInt(this.pagination.dataset.limit) || defaultLimit;

      this.setupControls();
      this.render();
    }

    get totalPages() {
      return Math.ceil(this.totalItems / this.limit);
    }

    setupControls() {
      this.pagination.querySelector('[data-action="first"]').onclick = () => this.goTo(1);
      this.pagination.querySelector('[data-action="prev"]').onclick = () => this.goTo(this.currentPage - 1);
      this.pagination.querySelector('[data-action="next"]').onclick = () => this.goTo(this.currentPage + 1);
      this.pagination.querySelector('[data-action="last"]').onclick = () => this.goTo(this.totalPages);
      this.pagination.querySelector('[data-action="limit"]').onchange = (e) => {
        this.limit = parseInt(e.target.value);
        this.currentPage = 1;
        this.render();
      };
    }

    goTo(page) {
      this.currentPage = Math.max(1, Math.min(page, this.totalPages));
      this.render();
    }

    render() {
      const start = (this.currentPage - 1) * this.limit;
      const end = start + this.limit;

      // Show/hide rows
      this.rows.forEach((row, i) => {
        row.style.display = (i >= start && i < end) ? '' : 'none';
      });

      // Update info
      const info = this.pagination.querySelector('.pagination-info');
      const startItem = this.totalItems > 0 ? start + 1 : 0;
      const endItem = Math.min(end, this.totalItems);
      info.textContent = 'Showing ' + startItem + '–' + endItem + ' of ' + this.totalItems;

      // Update buttons
      const firstBtn = this.pagination.querySelector('[data-action="first"]');
      const prevBtn = this.pagination.querySelector('[data-action="prev"]');
      const nextBtn = this.pagination.querySelector('[data-action="next"]');
      const lastBtn = this.pagination.querySelector('[data-action="last"]');

      firstBtn.disabled = this.currentPage <= 1;
      prevBtn.disabled = this.currentPage <= 1;
      nextBtn.disabled = this.currentPage >= this.totalPages;
      lastBtn.disabled = this.currentPage >= this.totalPages;

      firstBtn.classList.toggle('disabled', this.currentPage <= 1);
      prevBtn.classList.toggle('disabled', this.currentPage <= 1);
      nextBtn.classList.toggle('disabled', this.currentPage >= this.totalPages);
      lastBtn.classList.toggle('disabled', this.currentPage >= this.totalPages);

      // Update page numbers
      this.renderPageNumbers();

      // Hide pagination if only one page
      this.pagination.style.display = this.totalPages <= 1 ? 'none' : '';
    }

    renderPageNumbers() {
      const container = this.pagination.querySelector('.pagination-pages');
      container.innerHTML = '';

      const pages = [];
      for (let i = 1; i <= this.totalPages; i++) {
        if (i === 1 || i === this.totalPages || (i >= this.currentPage - 2 && i <= this.currentPage + 2)) {
          pages.push(i);
        } else if (pages[pages.length - 1] !== '...') {
          pages.push('...');
        }
      }

      pages.forEach(p => {
        if (p === '...') {
          const span = document.createElement('span');
          span.className = 'pagination-ellipsis';
          span.textContent = '…';
          container.appendChild(span);
        } else {
          const btn = document.createElement('button');
          btn.className = 'pagination-btn' + (p === this.currentPage ? ' current' : '');
          btn.textContent = p;
          btn.onclick = () => this.goTo(p);
          container.appendChild(btn);
        }
      });
    }
  }

  // Initialize all paginators when DOM is ready
  window.initPaginator = function(tableId, limit) {
    new TablePaginator(tableId, limit);
  };
})();
`;

function getChainFromQuery(c: any): ChainName {
  const chain = c.req.query('chain') as string;
  if (chain === 'polygon') return 'polygon';
  if (chain === 'all') return 'all';
  return 'ethereum';
}

function getChainLabel(chain: ChainName): string {
  if (chain === 'all') return 'All Networks';
  return chain.charAt(0).toUpperCase() + chain.slice(1);
}

const app = new Hono();

// Error handling middleware
app.onError((err, c) => {
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Error - Railgun Dashboard</title>
      <style>
        body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 1rem; }
        pre { background: #f5f5f5; padding: 1rem; overflow: auto; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <h1>Error</h1>
      <p><strong>An error occurred:</strong> ${err.message}</p>
      <pre>${err.stack || 'No stack trace available'}</pre>
      <p><a href="/">Go back to homepage</a></p>
    </body>
    </html>
  `);
});

// Global layout wrapper with network selector
app.use('*', jsxRenderer(({ children }) => {
  // Get chain from URL - we'll use client-side JS to handle this
  // Default to ethereum if not in URL
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Railgun Transparency Dashboard</title>
        <style>{`
          body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 1rem; }
          nav { display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 1rem; align-items: center; }
          nav a { text-decoration: none; color: #0066cc; }
          .network-selector { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }
          .network-selector label { font-weight: 600; }
          .network-selector select { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem; cursor: pointer; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
          th { background: #f5f5f5; }
          .chart-container { position: relative; height: 400px; margin: 1rem 0; }
          .chain-badge { display: inline-block; padding: 0.25rem 0.5rem; background: #e0e0e0; border-radius: 4px; font-size: 0.85rem; margin-left: 0.5rem; }
          .pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; margin: 1.5rem 0; padding: 1rem 0; border-top: 1px solid #eee; }
          .pagination-info { color: #666; font-size: 0.9rem; }
          .pagination-controls { display: flex; align-items: center; gap: 0.25rem; }
          .pagination-pages { display: flex; align-items: center; gap: 0.25rem; margin: 0 0.5rem; }
          .pagination-btn { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; text-decoration: none; color: #0066cc; font-size: 0.9rem; background: #fff; cursor: pointer; }
          .pagination-btn:hover:not(.disabled):not(.current) { background: #f0f0f0; border-color: #bbb; }
          .pagination-btn.current { background: #0066cc; color: #fff; border-color: #0066cc; }
          .pagination-btn.disabled { color: #999; cursor: not-allowed; background: #f9f9f9; }
          .pagination-ellipsis { padding: 0 0.5rem; color: #666; }
          .pagination-size { margin-left: auto; }
          .pagination-size select { padding: 0.4rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem; }
        `}</style>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script dangerouslySetInnerHTML={{ __html: paginationScript }} />
        <script dangerouslySetInnerHTML={{ __html: `
          // Get chain from URL params
          const urlParams = new URLSearchParams(window.location.search);
          const currentChain = urlParams.get('chain') || 'ethereum';
          document.currentChain = currentChain;
        `}} />
      </head>
      <body>
        <header>
          <h1>Railgun Transparency Dashboard</h1>
          <nav>
            <a href="/?chain=ethereum" id="nav-overview">Overview</a>
            <a href="/tokens?chain=ethereum" id="nav-tokens">Tokens</a>
            <a href="/relayers?chain=ethereum" id="nav-relayers">Relayers</a>
            <a href="/charts?chain=ethereum" id="nav-charts">Charts</a>
            <a href="/export?chain=ethereum" id="nav-export">Export</a>
            <a href="/ethics?chain=ethereum" id="nav-ethics">Ethics &amp; Limitations</a>
            <div class="network-selector">
              <label for="chain-select">Network:</label>
              <select id="chain-select">
                <option value="all">All Networks</option>
                <option value="ethereum">Ethereum</option>
                <option value="polygon">Polygon</option>
              </select>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer style={{ marginTop: '2rem', color: '#666', fontSize: '0.875rem' }}>
          <p>Aggregate analytics only. No individual tracking.</p>
        </footer>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            // Get chain from URL params
            const urlParams = new URLSearchParams(window.location.search);
            let currentChain = urlParams.get('chain') || 'ethereum';
            
            // Update select value
            const select = document.getElementById('chain-select');
            if (select) {
              select.value = currentChain;
              
              // Handle network change
              select.addEventListener('change', function() {
                const newChain = this.value;
                const url = new URL(window.location);
                url.searchParams.set('chain', newChain);
                window.location.href = url.toString();
              });
            }
            
            // Update all nav links with current chain
            const pages = ['overview', 'tokens', 'relayers', 'charts', 'export', 'ethics'];
            pages.forEach(page => {
              const link = document.getElementById('nav-' + page);
              if (link) {
                const currentHref = link.getAttribute('href');
                const basePath = currentHref.split('?')[0];
                link.setAttribute('href', basePath + '?chain=' + currentChain);
              }
            });
          })();
        `}} />
      </body>
    </html>
  );
}));

// GET / - Overview page
app.get('/', async (c) => {
  try {
    const chain = getChainFromQuery(c);

    const baseQuery = db.select({
      date: schema.dailyFlows.date,
      totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
      netFlow: sql<number>`sum(${schema.dailyFlows.netFlow})`,
    })
      .from(schema.dailyFlows);

    // Fetch all data for client-side pagination
    const flows = chain === 'all'
      ? await baseQuery
          .groupBy(schema.dailyFlows.date)
          .orderBy(desc(schema.dailyFlows.date))
      : await baseQuery
          .where(eq(schema.dailyFlows.chain, chain))
          .groupBy(schema.dailyFlows.date)
          .orderBy(desc(schema.dailyFlows.date));

    return c.render(
    <section>
      <h2>Daily Overview (All Tokens) <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <table id="overview-table">
        <thead>
          <tr><th>Date</th><th>Deposits</th><th>Withdrawals</th><th>Net Flow</th></tr>
        </thead>
        <tbody>
          {flows.length === 0 ? (
            <tr><td colSpan={4}>No data yet. Run the indexer and analytics first.</td></tr>
          ) : (
            flows.map((row, idx) => (
              <tr data-row={idx}>
                <td>{row.date}</td>
                <td>{row.totalDeposits?.toFixed(2)}</td>
                <td>{row.totalWithdrawals?.toFixed(2)}</td>
                <td>{row.netFlow?.toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <ClientPagination tableId="overview-table" defaultLimit={20} />
      <script dangerouslySetInnerHTML={{ __html: `initPaginator('overview-table', 20);` }} />
    </section>
    );
  } catch (error) {
    console.error('Error in / route:', error);
    throw error; // Let error handler catch it
  }
});

// GET /tokens - Token list
app.get('/tokens', async (c) => {
  const chain = getChainFromQuery(c);

  // Fetch all tokens for client-side pagination
  const tokenStats = chain === 'all'
    ? await db.select({
        id: schema.tokens.id,
        symbol: schema.tokens.symbol,
        address: schema.tokens.address,
        totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      })
        .from(schema.tokens)
        .leftJoin(schema.dailyFlows, eq(schema.tokens.id, schema.dailyFlows.tokenId))
        .groupBy(schema.tokens.id)
        .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`))
    : await db.select({
        id: schema.tokens.id,
        symbol: schema.tokens.symbol,
        address: schema.tokens.address,
        totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      })
        .from(schema.tokens)
        .leftJoin(schema.dailyFlows, and(
          eq(schema.tokens.id, schema.dailyFlows.tokenId),
          eq(schema.dailyFlows.chain, chain)
        ))
        .where(eq(schema.tokens.chain, chain))
        .groupBy(schema.tokens.id)
        .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`));

  return c.render(
    <section>
      <h2>Tokens by Deposit Volume <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <table id="tokens-table">
        <thead>
          <tr><th>Symbol</th><th>Total Deposits</th><th>Details</th></tr>
        </thead>
        <tbody>
          {tokenStats.length === 0 ? (
            <tr><td colSpan={3}>No data yet. Run the indexer and analytics first.</td></tr>
          ) : (
            tokenStats.map((t, idx) => (
              <tr data-row={idx}>
                <td>{t.symbol || 'Unknown'}</td>
                <td>{t.totalDeposits?.toFixed(2) || '0'}</td>
                <td><a href={`/tokens/${t.id}?chain=${chain}`}>View</a></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <ClientPagination tableId="tokens-table" defaultLimit={20} />
      <script dangerouslySetInnerHTML={{ __html: `initPaginator('tokens-table', 20);` }} />
    </section>
  );
});

// GET /tokens/:id - Token detail
app.get('/tokens/:id', async (c) => {
  const chain = getChainFromQuery(c);
  const tokenId = parseInt(c.req.param('id'));
  const token = await db.select()
    .from(schema.tokens)
    .where(eq(schema.tokens.id, tokenId))
    .get();

  // Fetch all flows for client-side pagination
  const flows = chain === 'all'
    ? await db.select({
        date: schema.dailyFlows.date,
        totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
        totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
        netFlow: sql<number>`sum(${schema.dailyFlows.netFlow})`,
      })
        .from(schema.dailyFlows)
        .where(eq(schema.dailyFlows.tokenId, tokenId))
        .groupBy(schema.dailyFlows.date)
        .orderBy(desc(schema.dailyFlows.date))
    : await db.select()
        .from(schema.dailyFlows)
        .where(and(
          eq(schema.dailyFlows.tokenId, tokenId),
          eq(schema.dailyFlows.chain, chain)
        ))
        .orderBy(desc(schema.dailyFlows.date));

  return c.render(
    <section>
      <h2>{token?.symbol || 'Token'} Daily Flows <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p><a href={`/tokens?chain=${chain}`}>← Back to Tokens</a></p>
      <table id="token-detail-table">
        <thead>
          <tr><th>Date</th><th>Deposits</th><th>Withdrawals</th><th>Net</th></tr>
        </thead>
        <tbody>
          {flows.length === 0 ? (
            <tr><td colSpan={4}>No data for this token.</td></tr>
          ) : (
            flows.map((row, idx) => (
              <tr data-row={idx}>
                <td>{row.date}</td>
                <td>{row.totalDeposits.toFixed(2)}</td>
                <td>{row.totalWithdrawals.toFixed(2)}</td>
                <td>{row.netFlow.toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <ClientPagination tableId="token-detail-table" defaultLimit={20} />
      <script dangerouslySetInnerHTML={{ __html: `initPaginator('token-detail-table', 20);` }} />
    </section>
  );
});

// GET /relayers - Relayer concentration metrics
app.get('/relayers', async (c) => {
  const chain = getChainFromQuery(c);

  // Fetch all stats for client-side pagination
  const stats = chain === 'all'
    ? await db.select({
        date: schema.relayerStatsDaily.date,
        numActiveRelayers: sql<number>`sum(${schema.relayerStatsDaily.numActiveRelayers})`,
        top5Share: sql<number>`avg(${schema.relayerStatsDaily.top5Share})`,
        hhi: sql<number>`avg(${schema.relayerStatsDaily.hhi})`,
        relayerTxCount: sql<number>`sum(${schema.relayerStatsDaily.relayerTxCount})`,
      })
        .from(schema.relayerStatsDaily)
        .groupBy(schema.relayerStatsDaily.date)
        .orderBy(desc(schema.relayerStatsDaily.date))
    : await db.select()
        .from(schema.relayerStatsDaily)
        .where(eq(schema.relayerStatsDaily.chain, chain))
        .orderBy(desc(schema.relayerStatsDaily.date));

  return c.render(
    <section>
      <h2>Relayer Concentration Metrics <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p><em>Aggregate statistics only. No individual relayer data exposed.</em></p>
      <table id="relayers-table">
        <thead>
          <tr><th>Date</th><th>Active Relayers</th><th>Top 5 Share</th><th>HHI</th><th>Tx Count</th></tr>
        </thead>
        <tbody>
          {stats.length === 0 ? (
            <tr><td colSpan={5}>No data yet. Run the indexer and analytics first.</td></tr>
          ) : (
            stats.map((row, idx) => (
              <tr data-row={idx}>
                <td>{row.date}</td>
                <td>{row.numActiveRelayers}</td>
                <td>{(row.top5Share * 100).toFixed(1)}%</td>
                <td>{row.hhi.toFixed(4)}</td>
                <td>{row.relayerTxCount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <ClientPagination tableId="relayers-table" defaultLimit={20} />
      <script dangerouslySetInnerHTML={{ __html: `initPaginator('relayers-table', 20);` }} />
    </section>
  );
});

// GET /status - Indexer status (JSON)
app.get('/status', async (c) => {
  // Ethereum stats
  const lastBlockEth = await db.select()
    .from(schema.metadata)
    .where(eq(schema.metadata.key, 'last_indexed_block_eth'))
    .get();

  const ethEventCount = await db.select({
    count: sql<number>`count(*)`,
  }).from(schema.events)
    .where(eq(schema.events.chain, 'ethereum'))
    .get();

  const latestEthEvent = await db.select({
    blockNumber: schema.events.blockNumber,
    blockTimestamp: schema.events.blockTimestamp,
  })
    .from(schema.events)
    .where(eq(schema.events.chain, 'ethereum'))
    .orderBy(desc(schema.events.blockNumber))
    .limit(1)
    .get();

  const ethTokenCount = await db.select({
    count: sql<number>`count(*)`,
  }).from(schema.tokens)
    .where(eq(schema.tokens.chain, 'ethereum'))
    .get();

  // Polygon stats
  const lastBlockPolygon = await db.select()
    .from(schema.metadata)
    .where(eq(schema.metadata.key, 'last_indexed_block_polygon'))
    .get();

  const polygonEventCount = await db.select({
    count: sql<number>`count(*)`,
  }).from(schema.events)
    .where(eq(schema.events.chain, 'polygon'))
    .get();

  const latestPolygonEvent = await db.select({
    blockNumber: schema.events.blockNumber,
    blockTimestamp: schema.events.blockTimestamp,
  })
    .from(schema.events)
    .where(eq(schema.events.chain, 'polygon'))
    .orderBy(desc(schema.events.blockNumber))
    .limit(1)
    .get();

  const polygonTokenCount = await db.select({
    count: sql<number>`count(*)`,
  }).from(schema.tokens)
    .where(eq(schema.tokens.chain, 'polygon'))
    .get();

  return c.json({
    status: 'ok',
    indexers: {
      ethereum: {
        lastIndexedBlock: lastBlockEth?.value ? parseInt(lastBlockEth.value) : null,
        totalEvents: ethEventCount?.count || 0,
        totalTokens: ethTokenCount?.count || 0,
        latestEventBlock: latestEthEvent?.blockNumber || null,
        latestEventTime: latestEthEvent?.blockTimestamp
          ? new Date(latestEthEvent.blockTimestamp * 1000).toISOString()
          : null,
      },
      polygon: {
        lastIndexedBlock: lastBlockPolygon?.value ? parseInt(lastBlockPolygon.value) : null,
        totalEvents: polygonEventCount?.count || 0,
        totalTokens: polygonTokenCount?.count || 0,
        latestEventBlock: latestPolygonEvent?.blockNumber || null,
        latestEventTime: latestPolygonEvent?.blockTimestamp
          ? new Date(latestPolygonEvent.blockTimestamp * 1000).toISOString()
          : null,
      },
    },
  });
});

// GET /ethics - Ethics page
app.get('/ethics', (c) => {
  return c.render(
    <section>
      <h2>Ethics &amp; Limitations</h2>
      <h3>Data Sources</h3>
      <p>This dashboard indexes only public on-chain events from Railgun smart contracts on Ethereum mainnet and Polygon.</p>

      <h3>What We Do NOT Do</h3>
      <ul>
        <li>No deanonymization attempts</li>
        <li>No transaction flow tracing or linking</li>
        <li>No per-address analytics or search</li>
        <li>No individual relayer identification</li>
        <li>No off-chain identity resolution</li>
      </ul>

      <h3>Privacy Guardrails</h3>
      <ul>
        <li>Minimum cohort size: Daily token aggregates with fewer than 3 transactions are excluded</li>
        <li>Relayer metrics are aggregate only (count, concentration) - no individual addresses shown</li>
        <li>No APIs or pages that accept Ethereum addresses as parameters</li>
      </ul>

      <h3>Limitations</h3>
      <ul>
        <li>Data may lag behind chain tip by ~12 blocks for reorg safety</li>
        <li>Token metadata relies on on-chain calls which may fail for non-standard tokens</li>
        <li>Aggregate volumes are approximations based on decoded event data</li>
      </ul>
    </section>
  );
});

// GET /export/daily-flows.csv - Export daily flows as CSV
app.get('/export/daily-flows.csv', async (c) => {
  const chain = getChainFromQuery(c);

  const flows = chain === 'all'
    ? await db.select({
        date: schema.dailyFlows.date,
        chain: schema.dailyFlows.chain,
        tokenId: schema.dailyFlows.tokenId,
        symbol: schema.tokens.symbol,
        totalDeposits: schema.dailyFlows.totalDeposits,
        totalWithdrawals: schema.dailyFlows.totalWithdrawals,
        netFlow: schema.dailyFlows.netFlow,
        depositTxCount: schema.dailyFlows.depositTxCount,
        withdrawalTxCount: schema.dailyFlows.withdrawalTxCount,
      })
        .from(schema.dailyFlows)
        .leftJoin(schema.tokens, eq(schema.dailyFlows.tokenId, schema.tokens.id))
        .orderBy(desc(schema.dailyFlows.date))
    : await db.select({
        date: schema.dailyFlows.date,
        chain: schema.dailyFlows.chain,
        tokenId: schema.dailyFlows.tokenId,
        symbol: schema.tokens.symbol,
        totalDeposits: schema.dailyFlows.totalDeposits,
        totalWithdrawals: schema.dailyFlows.totalWithdrawals,
        netFlow: schema.dailyFlows.netFlow,
        depositTxCount: schema.dailyFlows.depositTxCount,
        withdrawalTxCount: schema.dailyFlows.withdrawalTxCount,
      })
        .from(schema.dailyFlows)
        .leftJoin(schema.tokens, eq(schema.dailyFlows.tokenId, schema.tokens.id))
        .where(eq(schema.dailyFlows.chain, chain))
        .orderBy(desc(schema.dailyFlows.date));

  const headers = ['date', 'chain', 'token_id', 'symbol', 'total_deposits', 'total_withdrawals', 'net_flow', 'deposit_tx_count', 'withdrawal_tx_count'];
  const rows = flows.map(row => [
    row.date,
    row.chain,
    row.tokenId,
    row.symbol || '',
    row.totalDeposits,
    row.totalWithdrawals,
    row.netFlow,
    row.depositTxCount,
    row.withdrawalTxCount,
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="daily-flows-${chain}.csv"`,
    },
  });
});

// GET /export/relayer-stats.csv - Export relayer stats as CSV
app.get('/export/relayer-stats.csv', async (c) => {
  const chain = getChainFromQuery(c);

  const stats = chain === 'all'
    ? await db.select()
        .from(schema.relayerStatsDaily)
        .orderBy(desc(schema.relayerStatsDaily.date))
    : await db.select()
        .from(schema.relayerStatsDaily)
        .where(eq(schema.relayerStatsDaily.chain, chain))
        .orderBy(desc(schema.relayerStatsDaily.date));

  const headers = ['date', 'chain', 'num_active_relayers', 'top_5_share', 'hhi', 'relayer_tx_count'];
  const rows = stats.map(row => [
    row.date,
    row.chain,
    row.numActiveRelayers,
    row.top5Share,
    row.hhi,
    row.relayerTxCount,
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="relayer-stats-${chain}.csv"`,
    },
  });
});

// GET /export/events.json - Export raw events as JSON
app.get('/export/events.json', async (c) => {
  const chain = getChainFromQuery(c);

  const events = chain === 'all'
    ? await db.select({
        id: schema.events.id,
        chain: schema.events.chain,
        txHash: schema.events.txHash,
        logIndex: schema.events.logIndex,
        blockNumber: schema.events.blockNumber,
        blockTimestamp: schema.events.blockTimestamp,
        contractName: schema.events.contractName,
        eventName: schema.events.eventName,
        eventType: schema.events.eventType,
        tokenSymbol: schema.tokens.symbol,
        tokenAddress: schema.tokens.address,
        rawAmountWei: schema.events.rawAmountWei,
        amountNormalized: schema.events.amountNormalized,
        relayerAddress: schema.events.relayerAddress,
        fromAddress: schema.events.fromAddress,
        toAddress: schema.events.toAddress,
      })
        .from(schema.events)
        .leftJoin(schema.tokens, eq(schema.events.tokenId, schema.tokens.id))
        .orderBy(desc(schema.events.blockNumber))
    : await db.select({
        id: schema.events.id,
        chain: schema.events.chain,
        txHash: schema.events.txHash,
        logIndex: schema.events.logIndex,
        blockNumber: schema.events.blockNumber,
        blockTimestamp: schema.events.blockTimestamp,
        contractName: schema.events.contractName,
        eventName: schema.events.eventName,
        eventType: schema.events.eventType,
        tokenSymbol: schema.tokens.symbol,
        tokenAddress: schema.tokens.address,
        rawAmountWei: schema.events.rawAmountWei,
        amountNormalized: schema.events.amountNormalized,
        relayerAddress: schema.events.relayerAddress,
        fromAddress: schema.events.fromAddress,
        toAddress: schema.events.toAddress,
      })
        .from(schema.events)
        .leftJoin(schema.tokens, eq(schema.events.tokenId, schema.tokens.id))
        .where(eq(schema.events.chain, chain))
        .orderBy(desc(schema.events.blockNumber));

  return new Response(JSON.stringify(events, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="events-${chain}.json"`,
    },
  });
});

// GET /export/events.csv - Export raw events as CSV
app.get('/export/events.csv', async (c) => {
  const chain = getChainFromQuery(c);

  const events = chain === 'all'
    ? await db.select({
        id: schema.events.id,
        chain: schema.events.chain,
        txHash: schema.events.txHash,
        logIndex: schema.events.logIndex,
        blockNumber: schema.events.blockNumber,
        blockTimestamp: schema.events.blockTimestamp,
        contractName: schema.events.contractName,
        eventName: schema.events.eventName,
        eventType: schema.events.eventType,
        tokenSymbol: schema.tokens.symbol,
        tokenAddress: schema.tokens.address,
        rawAmountWei: schema.events.rawAmountWei,
        amountNormalized: schema.events.amountNormalized,
        relayerAddress: schema.events.relayerAddress,
        fromAddress: schema.events.fromAddress,
        toAddress: schema.events.toAddress,
      })
        .from(schema.events)
        .leftJoin(schema.tokens, eq(schema.events.tokenId, schema.tokens.id))
        .orderBy(desc(schema.events.blockNumber))
    : await db.select({
        id: schema.events.id,
        chain: schema.events.chain,
        txHash: schema.events.txHash,
        logIndex: schema.events.logIndex,
        blockNumber: schema.events.blockNumber,
        blockTimestamp: schema.events.blockTimestamp,
        contractName: schema.events.contractName,
        eventName: schema.events.eventName,
        eventType: schema.events.eventType,
        tokenSymbol: schema.tokens.symbol,
        tokenAddress: schema.tokens.address,
        rawAmountWei: schema.events.rawAmountWei,
        amountNormalized: schema.events.amountNormalized,
        relayerAddress: schema.events.relayerAddress,
        fromAddress: schema.events.fromAddress,
        toAddress: schema.events.toAddress,
      })
        .from(schema.events)
        .leftJoin(schema.tokens, eq(schema.events.tokenId, schema.tokens.id))
        .where(eq(schema.events.chain, chain))
        .orderBy(desc(schema.events.blockNumber));

  const headers = ['id', 'chain', 'tx_hash', 'log_index', 'block_number', 'block_timestamp', 'contract_name', 'event_name', 'event_type', 'token_symbol', 'token_address', 'raw_amount_wei', 'amount_normalized', 'relayer_address', 'from_address', 'to_address'];
  const rows = events.map(row => [
    row.id,
    row.chain,
    row.txHash,
    row.logIndex,
    row.blockNumber,
    row.blockTimestamp,
    row.contractName,
    row.eventName,
    row.eventType,
    row.tokenSymbol || '',
    row.tokenAddress || '',
    row.rawAmountWei || '',
    row.amountNormalized || '',
    row.relayerAddress || '',
    row.fromAddress || '',
    row.toAddress || '',
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="events-${chain}.csv"`,
    },
  });
});

// GET /export - Export page with download links
app.get('/export', (c) => {
  const chain = getChainFromQuery(c);
  return c.render(
    <section>
      <h2>Export Data <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p>Download data as CSV or JSON files.</p>

      <h3>Available Downloads</h3>
      <table>
        <thead>
          <tr><th>Dataset</th><th>Description</th><th>CSV</th><th>JSON</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Raw Events</td>
            <td>All indexed Railgun events with full details</td>
            <td><a href={`/export/events.csv?chain=${chain}`}>CSV</a></td>
            <td><a href={`/export/events.json?chain=${chain}`}>JSON</a></td>
          </tr>
          <tr>
            <td>Daily Flows</td>
            <td>Daily deposit/withdrawal volumes per token</td>
            <td><a href={`/export/daily-flows.csv?chain=${chain}`}>CSV</a></td>
            <td>-</td>
          </tr>
          <tr>
            <td>Relayer Stats</td>
            <td>Daily relayer concentration metrics</td>
            <td><a href={`/export/relayer-stats.csv?chain=${chain}`}>CSV</a></td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
});

// GET /charts - Charts dashboard with Chart.js
app.get('/charts', async (c) => {
  const chain = getChainFromQuery(c);
  // Fetch daily flows for the chart (last 30 days)
  const baseQuery = db.select({
    date: schema.dailyFlows.date,
    totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
    totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
  })
    .from(schema.dailyFlows);

  const flows = chain === 'all'
    ? await baseQuery
        .groupBy(schema.dailyFlows.date)
        .orderBy(schema.dailyFlows.date)
        .limit(30)
    : await baseQuery
        .where(eq(schema.dailyFlows.chain, chain))
        .groupBy(schema.dailyFlows.date)
        .orderBy(schema.dailyFlows.date)
        .limit(30);

  // Prepare chart data
  const chartData = {
    labels: flows.map(f => f.date),
    deposits: flows.map(f => f.totalDeposits || 0),
    withdrawals: flows.map(f => f.totalWithdrawals || 0),
  };

  return c.render(
    <section>
      <h2>Charts Dashboard <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p>Visual analytics for Railgun aggregate flows.</p>

      <h3>Daily Deposits vs Withdrawals</h3>
      <div class="chart-container">
        <canvas id="flowsChart"></canvas>
      </div>

      {/* Embed chart data as JSON for client-side Chart.js */}
      <script
        id="chart-data"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(chartData) }}
      />

      {/* Initialize Chart.js */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const dataEl = document.getElementById('chart-data');
          const data = JSON.parse(dataEl.textContent);

          const ctx = document.getElementById('flowsChart').getContext('2d');
          new Chart(ctx, {
            type: 'bar',
            data: {
              labels: data.labels,
              datasets: [
                {
                  label: 'Deposits',
                  data: data.deposits,
                  backgroundColor: 'rgba(54, 162, 235, 0.6)',
                  borderColor: 'rgba(54, 162, 235, 1)',
                  borderWidth: 1
                },
                {
                  label: 'Withdrawals',
                  data: data.withdrawals,
                  backgroundColor: 'rgba(255, 99, 132, 0.6)',
                  borderColor: 'rgba(255, 99, 132, 1)',
                  borderWidth: 1
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: true,
                  title: { display: true, text: 'Volume' }
                },
                x: {
                  title: { display: true, text: 'Date' }
                }
              },
              plugins: {
                legend: { position: 'top' },
                title: { display: false }
              }
            }
          });
        })();
      `}} />
    </section>
  );
});

export default app;
