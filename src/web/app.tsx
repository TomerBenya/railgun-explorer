import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { db, schema } from '../db/client';
import { desc, sql, eq, and, gte, lte } from 'drizzle-orm';

type ChainName = 'ethereum' | 'polygon' | 'all';
type TimePreset = '7d' | '30d' | '90d' | '1y' | 'all' | 'custom';
type EventTypeFilter = 'all' | 'deposits' | 'withdrawals';

interface FilterParams {
  startDate: string | null;
  endDate: string | null;
  timePreset: TimePreset;
  tokenId: number | null;
  eventType: EventTypeFilter;
  minVolume: number | null;
}

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

// Calculate date range from preset
function getDateRangeFromPreset(preset: TimePreset): { startDate: string | null; endDate: string | null } {
  if (preset === 'all') return { startDate: null, endDate: null };

  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  let startDate: string;

  switch (preset) {
    case '7d':
      now.setDate(now.getDate() - 7);
      break;
    case '30d':
      now.setDate(now.getDate() - 30);
      break;
    case '90d':
      now.setDate(now.getDate() - 90);
      break;
    case '1y':
      now.setFullYear(now.getFullYear() - 1);
      break;
    default:
      return { startDate: null, endDate: null };
  }
  startDate = now.toISOString().split('T')[0];
  return { startDate, endDate };
}

// Parse filter params from query string
function getFiltersFromQuery(c: any): FilterParams {
  const timePreset = (c.req.query('timePreset') as TimePreset) || 'all';
  const customStart = c.req.query('startDate') as string | undefined;
  const customEnd = c.req.query('endDate') as string | undefined;
  const tokenIdStr = c.req.query('tokenId') as string | undefined;
  const eventType = (c.req.query('eventType') as EventTypeFilter) || 'all';
  const minVolumeStr = c.req.query('minVolume') as string | undefined;

  let startDate: string | null = null;
  let endDate: string | null = null;

  if (timePreset === 'custom' && customStart && customEnd) {
    startDate = customStart;
    endDate = customEnd;
  } else if (timePreset !== 'all' && timePreset !== 'custom') {
    const range = getDateRangeFromPreset(timePreset);
    startDate = range.startDate;
    endDate = range.endDate;
  }

  return {
    startDate,
    endDate,
    timePreset,
    tokenId: tokenIdStr ? parseInt(tokenIdStr) : null,
    eventType,
    minVolume: minVolumeStr ? parseFloat(minVolumeStr) : null,
  };
}

// FilterBar component props
interface FilterBarProps {
  chain: ChainName;
  filters: FilterParams;
  basePath: string;
  showTokenFilter?: boolean;
  showEventTypeFilter?: boolean;
  showMinVolumeFilter?: boolean;
  tokens?: Array<{ id: number; symbol: string | null }>;
}

// FilterBar component
function FilterBar({ chain, filters, basePath, showTokenFilter, showEventTypeFilter, showMinVolumeFilter, tokens }: FilterBarProps) {
  const timePresets: { value: TimePreset; label: string }[] = [
    { value: 'all', label: 'All Time' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: '1y', label: 'Last Year' },
    { value: 'custom', label: 'Custom Range' },
  ];

  return (
    <div class="filter-bar">
      <form method="get" action={basePath} class="filter-form">
        <input type="hidden" name="chain" value={chain} />

        <div class="filter-group">
          <label for="timePreset">Time Range:</label>
          <select name="timePreset" id="timePreset" class="filter-select">
            {timePresets.map(p => (
              <option value={p.value} selected={p.value === filters.timePreset}>{p.label}</option>
            ))}
          </select>
        </div>

        <div class="filter-group custom-dates" id="custom-dates" style={{ display: filters.timePreset === 'custom' ? 'flex' : 'none' }}>
          <label for="startDate">From:</label>
          <input type="date" name="startDate" id="startDate" value={filters.startDate || ''} class="filter-input" />
          <label for="endDate">To:</label>
          <input type="date" name="endDate" id="endDate" value={filters.endDate || ''} class="filter-input" />
        </div>

        {showTokenFilter && tokens && (
          <div class="filter-group">
            <label for="tokenId">Token:</label>
            <select name="tokenId" id="tokenId" class="filter-select">
              <option value="" selected={!filters.tokenId}>All Tokens</option>
              {tokens.map(t => (
                <option value={t.id} selected={t.id === filters.tokenId}>{t.symbol || 'Unknown'}</option>
              ))}
            </select>
          </div>
        )}

        {showEventTypeFilter && (
          <div class="filter-group">
            <label for="eventType">Show:</label>
            <select name="eventType" id="eventType" class="filter-select">
              <option value="all" selected={filters.eventType === 'all'}>All Events</option>
              <option value="deposits" selected={filters.eventType === 'deposits'}>Deposits Only</option>
              <option value="withdrawals" selected={filters.eventType === 'withdrawals'}>Withdrawals Only</option>
            </select>
          </div>
        )}

        {showMinVolumeFilter && (
          <div class="filter-group">
            <label for="minVolume">Min Volume:</label>
            <input
              type="number"
              name="minVolume"
              id="minVolume"
              value={filters.minVolume || ''}
              placeholder="0"
              step="0.01"
              min="0"
              class="filter-input"
            />
          </div>
        )}

        <div class="filter-actions">
          <button type="submit" class="filter-btn">Apply Filters</button>
          <a href={`${basePath}?chain=${chain}`} class="filter-btn filter-btn-reset">Reset</a>
        </div>
      </form>
    </div>
  );
}

// Client-side script to toggle custom date inputs
const filterScript = `
document.addEventListener('DOMContentLoaded', function() {
  const timePresetSelect = document.getElementById('timePreset');
  const customDates = document.getElementById('custom-dates');
  if (timePresetSelect && customDates) {
    // Set initial state based on current selection
    customDates.style.display = timePresetSelect.value === 'custom' ? 'flex' : 'none';
    // Listen for changes
    timePresetSelect.addEventListener('change', function() {
      customDates.style.display = this.value === 'custom' ? 'flex' : 'none';
    });
  }
});
`;

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
          .filter-bar { background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
          .filter-form { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; }
          .filter-group { display: flex; flex-direction: column; gap: 0.25rem; }
          .filter-group label { font-size: 0.85rem; font-weight: 500; color: #555; }
          .filter-select, .filter-input { padding: 0.5rem 0.75rem; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem; min-width: 140px; }
          .filter-select:focus, .filter-input:focus { outline: none; border-color: #0066cc; box-shadow: 0 0 0 2px rgba(0,102,204,0.1); }
          .filter-input[type="date"] { min-width: 130px; }
          .filter-input[type="number"] { min-width: 100px; }
          .custom-dates { flex-direction: row; align-items: center; gap: 0.5rem; }
          .custom-dates label { margin: 0; }
          .filter-actions { display: flex; gap: 0.5rem; margin-left: auto; }
          .filter-btn { padding: 0.5rem 1rem; border: 1px solid #0066cc; border-radius: 4px; font-size: 0.9rem; cursor: pointer; text-decoration: none; }
          .filter-btn:not(.filter-btn-reset) { background: #0066cc; color: #fff; }
          .filter-btn:not(.filter-btn-reset):hover { background: #0055aa; }
          .filter-btn-reset { background: #fff; color: #0066cc; }
          .filter-btn-reset:hover { background: #f0f0f0; }
          .active-filters { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #e0e0e0; }
          .active-filter-tag { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.25rem 0.5rem; background: #e8f4fc; border: 1px solid #b3d9f2; border-radius: 4px; font-size: 0.8rem; color: #0066cc; }
        `}</style>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script dangerouslySetInnerHTML={{ __html: paginationScript }} />
        <script dangerouslySetInnerHTML={{ __html: filterScript }} />
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
            <a href="/relayer-fees?chain=ethereum" id="nav-relayer-fees">Relayer Fees</a>
            <a href="/charts?chain=ethereum" id="nav-charts">Charts</a>
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
            const pages = ['overview', 'tokens', 'relayers', 'relayer-fees', 'charts', 'export', 'ethics'];
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
    const filters = getFiltersFromQuery(c);

    // Fetch tokens for the filter dropdown
    const allTokens = chain === 'all'
      ? await db.select({ id: schema.tokens.id, symbol: schema.tokens.symbol })
          .from(schema.tokens)
          .orderBy(schema.tokens.symbol)
      : await db.select({ id: schema.tokens.id, symbol: schema.tokens.symbol })
          .from(schema.tokens)
          .where(eq(schema.tokens.chain, chain))
          .orderBy(schema.tokens.symbol);

    // Build conditions array
    const conditions = [];
    if (chain !== 'all') {
      conditions.push(eq(schema.dailyFlows.chain, chain));
    }
    if (filters.startDate) {
      conditions.push(gte(schema.dailyFlows.date, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(schema.dailyFlows.date, filters.endDate));
    }
    if (filters.tokenId) {
      conditions.push(eq(schema.dailyFlows.tokenId, filters.tokenId));
    }

    // Base select for aggregation
    const baseSelect = {
      date: schema.dailyFlows.date,
      totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
      netFlow: sql<number>`sum(${schema.dailyFlows.netFlow})`,
    };

    // Fetch flows with filters
    const flows = conditions.length > 0
      ? await db.select(baseSelect)
          .from(schema.dailyFlows)
          .where(and(...conditions))
          .groupBy(schema.dailyFlows.date)
          .orderBy(desc(schema.dailyFlows.date))
      : await db.select(baseSelect)
          .from(schema.dailyFlows)
          .groupBy(schema.dailyFlows.date)
          .orderBy(desc(schema.dailyFlows.date));

    // Filter by event type (hide columns in display)
    const showDeposits = filters.eventType === 'all' || filters.eventType === 'deposits';
    const showWithdrawals = filters.eventType === 'all' || filters.eventType === 'withdrawals';

    return c.render(
    <section>
      <h2>Daily Overview {filters.tokenId ? '' : '(All Tokens)'} <span class="chain-badge">{getChainLabel(chain)}</span></h2>

      <FilterBar
        chain={chain}
        filters={filters}
        basePath="/"
        showTokenFilter={true}
        showEventTypeFilter={true}
        tokens={allTokens}
      />

      <table id="overview-table">
        <thead>
          <tr>
            <th>Date</th>
            {showDeposits && <th>Deposits</th>}
            {showWithdrawals && <th>Withdrawals</th>}
            {showDeposits && showWithdrawals && <th>Net Flow</th>}
          </tr>
        </thead>
        <tbody>
          {flows.length === 0 ? (
            <tr><td colSpan={4}>No data found for the selected filters.</td></tr>
          ) : (
            flows.map((row, idx) => (
              <tr data-row={idx}>
                <td>{row.date}</td>
                {showDeposits && <td>{row.totalDeposits?.toFixed(2)}</td>}
                {showWithdrawals && <td>{row.totalWithdrawals?.toFixed(2)}</td>}
                {showDeposits && showWithdrawals && <td>{row.netFlow?.toFixed(2)}</td>}
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
  const filters = getFiltersFromQuery(c);

  // Build join conditions for dailyFlows
  const joinConditions = [eq(schema.tokens.id, schema.dailyFlows.tokenId)];
  if (chain !== 'all') {
    joinConditions.push(eq(schema.dailyFlows.chain, chain));
  }
  if (filters.startDate) {
    joinConditions.push(gte(schema.dailyFlows.date, filters.startDate));
  }
  if (filters.endDate) {
    joinConditions.push(lte(schema.dailyFlows.date, filters.endDate));
  }

  // Fetch all tokens with filtered stats
  const tokenStatsQuery = chain === 'all'
    ? db.select({
        id: schema.tokens.id,
        symbol: schema.tokens.symbol,
        address: schema.tokens.address,
        totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      })
        .from(schema.tokens)
        .leftJoin(schema.dailyFlows, and(...joinConditions))
        .groupBy(schema.tokens.id)
        .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`))
    : db.select({
        id: schema.tokens.id,
        symbol: schema.tokens.symbol,
        address: schema.tokens.address,
        totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      })
        .from(schema.tokens)
        .leftJoin(schema.dailyFlows, and(...joinConditions))
        .where(eq(schema.tokens.chain, chain))
        .groupBy(schema.tokens.id)
        .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`));

  const tokenStats = await tokenStatsQuery;

  // Apply min volume filter (client-side since it's on aggregated data)
  const filteredTokens = filters.minVolume
    ? tokenStats.filter(t => (t.totalDeposits || 0) >= (filters.minVolume || 0))
    : tokenStats;

  return c.render(
    <section>
      <h2>Tokens by Deposit Volume <span class="chain-badge">{getChainLabel(chain)}</span></h2>

      <FilterBar
        chain={chain}
        filters={filters}
        basePath="/tokens"
        showMinVolumeFilter={true}
      />

      <table id="tokens-table">
        <thead>
          <tr><th>Symbol</th><th>Total Deposits</th><th>Details</th></tr>
        </thead>
        <tbody>
          {filteredTokens.length === 0 ? (
            <tr><td colSpan={3}>No tokens found for the selected filters.</td></tr>
          ) : (
            filteredTokens.map((t, idx) => (
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
  const filters = getFiltersFromQuery(c);
  const tokenId = parseInt(c.req.param('id'));
  const token = await db.select()
    .from(schema.tokens)
    .where(eq(schema.tokens.id, tokenId))
    .get();

  // Build conditions array
  const conditions = [eq(schema.dailyFlows.tokenId, tokenId)];
  if (chain !== 'all') {
    conditions.push(eq(schema.dailyFlows.chain, chain));
  }
  if (filters.startDate) {
    conditions.push(gte(schema.dailyFlows.date, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(schema.dailyFlows.date, filters.endDate));
  }

  // Base select for aggregation
  const baseSelect = {
    date: schema.dailyFlows.date,
    totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
    totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
    netFlow: sql<number>`sum(${schema.dailyFlows.netFlow})`,
  };

  // Fetch flows with filters
  const flows = await db.select(baseSelect)
    .from(schema.dailyFlows)
    .where(and(...conditions))
    .groupBy(schema.dailyFlows.date)
    .orderBy(desc(schema.dailyFlows.date));

  return c.render(
    <section>
      <h2>{token?.symbol || 'Token'} Daily Flows <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p><a href={`/tokens?chain=${chain}`}>← Back to Tokens</a></p>

      <FilterBar
        chain={chain}
        filters={filters}
        basePath={`/tokens/${tokenId}`}
      />

      <table id="token-detail-table">
        <thead>
          <tr><th>Date</th><th>Deposits</th><th>Withdrawals</th><th>Net</th></tr>
        </thead>
        <tbody>
          {flows.length === 0 ? (
            <tr><td colSpan={4}>No data found for the selected filters.</td></tr>
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
  const filters = getFiltersFromQuery(c);

  // Build conditions array
  const conditions = [];
  if (chain !== 'all') {
    conditions.push(eq(schema.relayerStatsDaily.chain, chain));
  }
  if (filters.startDate) {
    conditions.push(gte(schema.relayerStatsDaily.date, filters.startDate));
  }
  if (filters.endDate) {
    conditions.push(lte(schema.relayerStatsDaily.date, filters.endDate));
  }

  // Base select for aggregation
  const baseSelect = {
    date: schema.relayerStatsDaily.date,
    numActiveRelayers: sql<number>`sum(${schema.relayerStatsDaily.numActiveRelayers})`,
    top5Share: sql<number>`avg(${schema.relayerStatsDaily.top5Share})`,
    hhi: sql<number>`avg(${schema.relayerStatsDaily.hhi})`,
    relayerTxCount: sql<number>`sum(${schema.relayerStatsDaily.relayerTxCount})`,
  };

  // Fetch stats with filters
  const stats = conditions.length > 0
    ? await db.select(baseSelect)
        .from(schema.relayerStatsDaily)
        .where(and(...conditions))
        .groupBy(schema.relayerStatsDaily.date)
        .orderBy(desc(schema.relayerStatsDaily.date))
    : await db.select(baseSelect)
        .from(schema.relayerStatsDaily)
        .groupBy(schema.relayerStatsDaily.date)
        .orderBy(desc(schema.relayerStatsDaily.date));

  return c.render(
    <section>
      <h2>Relayer Concentration Metrics <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p><em>Aggregate statistics only. No individual relayer data exposed.</em></p>

      <FilterBar
        chain={chain}
        filters={filters}
        basePath="/relayers"
      />

      <table id="relayers-table">
        <thead>
          <tr><th>Date</th><th>Active Relayers</th><th>Top 5 Share</th><th>HHI</th><th>Tx Count</th></tr>
        </thead>
        <tbody>
          {stats.length === 0 ? (
            <tr><td colSpan={5}>No data found for the selected filters.</td></tr>
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

// GET /relayer-fees - Relayer fee revenue dashboard
app.get('/relayer-fees', async (c) => {
  const chain = getChainFromQuery(c);

  // Get daily fee revenue aggregated by relayer and token
  const feeRevenue = chain === 'all'
    ? await db.select({
        date: schema.relayerFeeRevenueDaily.date,
        chain: schema.relayerFeeRevenueDaily.chain,
        relayerAddress: schema.relayerFeeRevenueDaily.relayerAddress,
        tokenSymbol: schema.tokens.symbol,
        totalFeeNormalized: sql<number>`sum(${schema.relayerFeeRevenueDaily.totalFeeNormalized})`,
        txCount: sql<number>`sum(${schema.relayerFeeRevenueDaily.txCount})`,
        avgFeeNormalized: sql<number>`avg(${schema.relayerFeeRevenueDaily.avgFeeNormalized})`,
      })
        .from(schema.relayerFeeRevenueDaily)
        .leftJoin(schema.tokens, eq(schema.relayerFeeRevenueDaily.tokenId, schema.tokens.id))
        .groupBy(
          schema.relayerFeeRevenueDaily.date,
          schema.relayerFeeRevenueDaily.chain,
          schema.relayerFeeRevenueDaily.relayerAddress,
          schema.relayerFeeRevenueDaily.tokenId
        )
        .orderBy(desc(schema.relayerFeeRevenueDaily.date))
        .limit(100)
    : await db.select({
        date: schema.relayerFeeRevenueDaily.date,
        relayerAddress: schema.relayerFeeRevenueDaily.relayerAddress,
        tokenSymbol: schema.tokens.symbol,
        totalFeeNormalized: schema.relayerFeeRevenueDaily.totalFeeNormalized,
        txCount: schema.relayerFeeRevenueDaily.txCount,
        avgFeeNormalized: schema.relayerFeeRevenueDaily.avgFeeNormalized,
      })
        .from(schema.relayerFeeRevenueDaily)
        .leftJoin(schema.tokens, eq(schema.relayerFeeRevenueDaily.tokenId, schema.tokens.id))
        .where(eq(schema.relayerFeeRevenueDaily.chain, chain))
        .orderBy(desc(schema.relayerFeeRevenueDaily.date))
        .limit(100);

  // Get top relayers by total revenue (all time)
  const topRelayers = chain === 'all'
    ? await db.select({
        relayerAddress: schema.relayerFeeRevenueDaily.relayerAddress,
        chain: schema.relayerFeeRevenueDaily.chain,
        totalRevenue: sql<number>`sum(${schema.relayerFeeRevenueDaily.totalFeeNormalized})`,
        totalTxCount: sql<number>`sum(${schema.relayerFeeRevenueDaily.txCount})`,
      })
        .from(schema.relayerFeeRevenueDaily)
        .groupBy(schema.relayerFeeRevenueDaily.relayerAddress, schema.relayerFeeRevenueDaily.chain)
        .orderBy(desc(sql<number>`sum(${schema.relayerFeeRevenueDaily.totalFeeNormalized})`))
        .limit(20)
    : await db.select({
        relayerAddress: schema.relayerFeeRevenueDaily.relayerAddress,
        totalRevenue: sql<number>`sum(${schema.relayerFeeRevenueDaily.totalFeeNormalized})`,
        totalTxCount: sql<number>`sum(${schema.relayerFeeRevenueDaily.txCount})`,
      })
        .from(schema.relayerFeeRevenueDaily)
        .where(eq(schema.relayerFeeRevenueDaily.chain, chain))
        .groupBy(schema.relayerFeeRevenueDaily.relayerAddress)
        .orderBy(desc(sql<number>`sum(${schema.relayerFeeRevenueDaily.totalFeeNormalized})`))
        .limit(20);

  // Get daily totals for chart
  const dailyTotals = chain === 'all'
    ? await db.select({
        date: schema.relayerFeeRevenueDaily.date,
        chain: schema.relayerFeeRevenueDaily.chain,
        totalFees: sql<number>`sum(${schema.relayerFeeRevenueDaily.totalFeeNormalized})`,
        totalTxCount: sql<number>`sum(${schema.relayerFeeRevenueDaily.txCount})`,
      })
        .from(schema.relayerFeeRevenueDaily)
        .groupBy(schema.relayerFeeRevenueDaily.date, schema.relayerFeeRevenueDaily.chain)
        .orderBy(desc(schema.relayerFeeRevenueDaily.date))
        .limit(30)
    : await db.select({
        date: schema.relayerFeeRevenueDaily.date,
        totalFees: sql<number>`sum(${schema.relayerFeeRevenueDaily.totalFeeNormalized})`,
        totalTxCount: sql<number>`sum(${schema.relayerFeeRevenueDaily.txCount})`,
      })
        .from(schema.relayerFeeRevenueDaily)
        .where(eq(schema.relayerFeeRevenueDaily.chain, chain))
        .groupBy(schema.relayerFeeRevenueDaily.date)
        .orderBy(desc(schema.relayerFeeRevenueDaily.date))
        .limit(30);

  return c.render(
    <section>
      <h2>Relayer Fee Revenue <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p><em>Total fees collected by relayers for processing withdrawals. Fees are paid in the same token as the withdrawal.</em></p>

      <h3>Daily Fee Revenue</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            {chain === 'all' && <th>Chain</th>}
            <th>Total Fees</th>
            <th>Transactions</th>
            <th>Avg Fee per Tx</th>
          </tr>
        </thead>
        <tbody>
          {dailyTotals.length === 0 ? (
            <tr><td colSpan={chain === 'all' ? 5 : 4}>No data yet. Run analytics:fees first.</td></tr>
          ) : (
            dailyTotals.map((row) => (
              <tr>
                <td>{row.date}</td>
                {chain === 'all' && <td>{row.chain}</td>}
                <td>{row.totalFees?.toFixed(4) || '0.0000'}</td>
                <td>{row.totalTxCount || 0}</td>
                <td>{row.totalFees && row.totalTxCount ? (row.totalFees / row.totalTxCount).toFixed(6) : '0.000000'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h3>Top Relayers by Revenue</h3>
      <table>
        <thead>
          <tr>
            <th>Relayer Address</th>
            {chain === 'all' && <th>Chain</th>}
            <th>Total Revenue</th>
            <th>Total Transactions</th>
            <th>Avg Fee per Tx</th>
          </tr>
        </thead>
        <tbody>
          {topRelayers.length === 0 ? (
            <tr><td colSpan={chain === 'all' ? 5 : 4}>No data yet. Run analytics:fees first.</td></tr>
          ) : (
            topRelayers.map((row) => (
              <tr>
                <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                  {row.relayerAddress?.substring(0, 10)}...{row.relayerAddress?.substring(34)}
                </td>
                {chain === 'all' && <td>{row.chain}</td>}
                <td>{row.totalRevenue?.toFixed(4) || '0.0000'}</td>
                <td>{row.totalTxCount || 0}</td>
                <td>{row.totalRevenue && row.totalTxCount ? (row.totalRevenue / row.totalTxCount).toFixed(6) : '0.000000'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h3>Recent Fee Revenue by Relayer & Token</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            {chain === 'all' && <th>Chain</th>}
            <th>Relayer</th>
            <th>Token</th>
            <th>Total Fees</th>
            <th>Tx Count</th>
            <th>Avg Fee</th>
          </tr>
        </thead>
        <tbody>
          {feeRevenue.length === 0 ? (
            <tr><td colSpan={chain === 'all' ? 7 : 6}>No data yet. Run analytics:fees first.</td></tr>
          ) : (
            feeRevenue.map((row) => (
              <tr>
                <td>{row.date}</td>
                {chain === 'all' && <td>{row.chain}</td>}
                <td style={{ fontFamily: 'monospace', fontSize: '0.85em' }}>
                  {row.relayerAddress?.substring(0, 8)}...{row.relayerAddress?.substring(36)}
                </td>
                <td>{row.tokenSymbol || 'Unknown'}</td>
                <td>{row.totalFeeNormalized?.toFixed(4) || '0.0000'}</td>
                <td>{row.txCount || 0}</td>
                <td>{row.avgFeeNormalized?.toFixed(6) || '0.000000'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
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
