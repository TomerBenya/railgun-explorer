import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { db, schema } from '../db/client';
import { desc, sql, eq, and, gte, lte } from 'drizzle-orm';
import {
  getMeanDepositAmountsOverTime,
  getMeanWithdrawalAmountsOverTime,
  getDailyVolumeOverTime,
  getRelayerHHIOverTime,
  getHourlyActivityHeatmap,
  getActivityIntensityOverTime,
  getTopTokensByVolume,
  getTopTokensByTransactionCount,
  getTokenDiversityOverTime,
  getActiveRelayersOverTime,
  getTop5RelayerShareOverTime,
  getNetFlowOverTime,
} from '../analytics/chartData';

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

// Calculate date range from time range string (for charts)
function getDateRangeFromTimeRange(range: string): { startDate?: string; endDate?: string } {
  if (range === 'all') return {};

  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  const daysAgo = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  now.setDate(now.getDate() - daysAgo);

  return {
    startDate: now.toISOString().split('T')[0],
    endDate,
  };
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
          /* Dark Mode Theme */
          body {
            font-family: system-ui, sans-serif;
            max-width: 1400px;
            margin: 0 auto;
            padding: 1rem;
            background: #0f1419;
            color: #e6edf3;
          }
          nav {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
            border-bottom: 1px solid #30363d;
            padding-bottom: 1rem;
            align-items: center;
          }
          nav a { text-decoration: none; color: #58a6ff; }
          nav a:hover { color: #79c0ff; }
          .network-selector { margin-left: auto; display: flex; gap: 0.5rem; align-items: center; }
          .network-selector label { font-weight: 600; color: #e6edf3; }
          .network-selector select {
            padding: 0.5rem;
            border: 1px solid #30363d;
            border-radius: 6px;
            font-size: 0.9rem;
            cursor: pointer;
            background: #161b22;
            color: #e6edf3;
          }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #30363d; }
          th { background: #161b22; color: #e6edf3; }
          .chart-container { position: relative; height: 400px; margin: 1rem 0; }
          .chain-badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 6px;
            font-size: 0.85rem;
            margin-left: 0.5rem;
            color: #7d8590;
          }
          .pagination { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; margin: 1.5rem 0; padding: 1rem 0; border-top: 1px solid #30363d; }
          .pagination-info { color: #7d8590; font-size: 0.9rem; }
          .pagination-controls { display: flex; align-items: center; gap: 0.25rem; }
          .pagination-pages { display: flex; align-items: center; gap: 0.25rem; margin: 0 0.5rem; }
          .pagination-btn { padding: 0.4rem 0.75rem; border: 1px solid #30363d; border-radius: 6px; text-decoration: none; color: #58a6ff; font-size: 0.9rem; background: #161b22; cursor: pointer; }
          .pagination-btn:hover:not(.disabled):not(.current) { background: #21262d; border-color: #58a6ff; }
          .pagination-btn.current { background: #1f6feb; color: #fff; border-color: #1f6feb; }
          .pagination-btn.disabled { color: #484f58; cursor: not-allowed; background: #0d1117; }
          .pagination-ellipsis { padding: 0 0.5rem; color: #7d8590; }
          .pagination-size { margin-left: auto; }
          .pagination-size select { padding: 0.4rem; border: 1px solid #30363d; border-radius: 6px; font-size: 0.9rem; background: #161b22; color: #e6edf3; }

          /* Sticky Filter Bar */
          .filter-bar {
            position: sticky;
            top: 0;
            z-index: 100;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 8px 16px rgba(0,0,0,0.4);
          }
          .filter-form { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; }
          .filter-group { display: flex; flex-direction: column; gap: 0.25rem; }
          .filter-group label { font-size: 0.85rem; font-weight: 500; color: #7d8590; }
          .filter-select, .filter-input {
            padding: 0.5rem 0.75rem;
            border: 1px solid #30363d;
            border-radius: 6px;
            font-size: 0.9rem;
            min-width: 140px;
            background: #0d1117;
            color: #e6edf3;
          }
          .filter-select:focus, .filter-input:focus { outline: none; border-color: #1f6feb; box-shadow: 0 0 0 2px rgba(31,111,235,0.3); }
          .filter-input[type="date"] { min-width: 130px; }
          .filter-input[type="number"] { min-width: 100px; }
          .custom-dates { flex-direction: row; align-items: center; gap: 0.5rem; }
          .custom-dates label { margin: 0; }
          .filter-actions { display: flex; gap: 0.5rem; margin-left: auto; }
          .filter-btn {
            padding: 0.5rem 1rem;
            border: 1px solid #30363d;
            border-radius: 6px;
            font-size: 0.9rem;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s;
          }
          .filter-btn:not(.filter-btn-reset) { background: #1f6feb; color: #fff; border-color: #1f6feb; }
          .filter-btn:not(.filter-btn-reset):hover { background: #388bfd; }
          .filter-btn-reset { background: #21262d; color: #58a6ff; }
          .filter-btn-reset:hover { background: #30363d; }

          /* Active Filter Badges */
          .active-filters {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-top: 0.75rem;
            padding-top: 0.75rem;
            border-top: 1px solid #30363d;
          }
          .active-filter-tag {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.25rem 0.5rem;
            background: #1f6feb;
            border: 1px solid #388bfd;
            border-radius: 6px;
            font-size: 0.8rem;
            color: #fff;
          }

          /* Card-Based Grid Layout */
          .charts-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1.5rem;
            margin: 2rem 0;
          }
          @media (max-width: 1024px) {
            .charts-grid { grid-template-columns: 1fr; }
          }
          .chart-section {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: transform 0.2s, box-shadow 0.2s;
          }
          .chart-section:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.4);
          }
          .chart-section h4 { margin-top: 0; color: #e6edf3; font-size: 1.1rem; }
          .chart-description { font-size: 0.9rem; color: #7d8590; margin-bottom: 1rem; }
          .chart-section.full-width { grid-column: 1 / -1; }

          /* Heatmap Dark Theme */
          .chart-heatmap { height: auto; min-height: 600px; }
          .activity-heatmap { border-collapse: collapse; width: 100%; font-size: 0.85rem; margin: 1rem 0; }
          .activity-heatmap th, .activity-heatmap td { border: 1px solid #30363d; padding: 0.5rem; text-align: center; }
          .activity-heatmap th { background: #0d1117; font-weight: 600; color: #e6edf3; }
          .hour-label { background: #0d1117; font-weight: 500; text-align: right; padding-right: 0.75rem; color: #7d8590; }
          .heatmap-cell { min-width: 60px; cursor: help; transition: all 0.2s; color: #e6edf3; font-weight: 500; }
          .heatmap-cell:hover {
            outline: 2px solid #58a6ff;
            transform: scale(1.05);
            z-index: 10;
          }
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
            const pages = ['overview', 'tokens', 'relayers', 'charts', 'ethics'];
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

// Helper function to render heatmap table
function renderHeatmapTable(data: Array<{ hour: number; dayOfWeek: number; txCount: number }>) {
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const maxCount = Math.max(...data.map(d => d.txCount), 1);

  // Create lookup map
  const dataMap = new Map<string, number>();
  data.forEach(d => {
    dataMap.set(`${d.hour}-${d.dayOfWeek}`, d.txCount);
  });

  // Helper to format hour (12am, 6am, 12pm, 6pm format)
  const formatHour = (hour: number): string => {
    if (hour === 0) return '12am';
    if (hour < 12) return `${hour}am`;
    if (hour === 12) return '12pm';
    return `${hour - 12}pm`;
  };

  // Helper to get vibrant dark-mode heatmap color
  const getHeatmapColor = (intensity: number): string => {
    if (intensity === 0) return '#0d1117';
    // Vibrant gradient: dark blue -> cyan -> yellow -> orange -> red
    if (intensity < 0.2) {
      const t = intensity / 0.2;
      return `rgb(${Math.round(10 + t * 30)}, ${Math.round(20 + t * 80)}, ${Math.round(60 + t * 140)})`;
    } else if (intensity < 0.4) {
      const t = (intensity - 0.2) / 0.2;
      return `rgb(${Math.round(40 + t * 20)}, ${Math.round(100 + t * 120)}, ${Math.round(200 - t * 50)})`;
    } else if (intensity < 0.6) {
      const t = (intensity - 0.4) / 0.2;
      return `rgb(${Math.round(60 + t * 100)}, ${Math.round(220 - t * 20)}, ${Math.round(150 - t * 100)})`;
    } else if (intensity < 0.8) {
      const t = (intensity - 0.6) / 0.2;
      return `rgb(${Math.round(160 + t * 80)}, ${Math.round(200 - t * 100)}, ${Math.round(50 - t * 30)})`;
    } else {
      const t = (intensity - 0.8) / 0.2;
      return `rgb(${Math.round(240 + t * 15)}, ${Math.round(100 - t * 80)}, ${Math.round(20 - t * 20)})`;
    }
  };

  return (
    <table class="activity-heatmap">
      <tbody>
        {/* Reversed so 12am is at top, 11pm at bottom */}
        {[...Array(24)].reverse().map((_, reverseIdx) => {
          const hour = 23 - reverseIdx; // 23, 22, 21, ..., 0
          return (
            <tr>
              <td class="hour-label">{formatHour(hour)}</td>
              {[...Array(7)].map((_, dow) => {
                const count = dataMap.get(`${hour}-${dow}`) || 0;
                const intensity = count / maxCount;
                const color = getHeatmapColor(intensity);
                return (
                  <td
                    class="heatmap-cell"
                    style={`background-color: ${color}`}
                    title={`${dayLabels[dow]} ${formatHour(hour)} - ${count} transactions`}
                  >
                    {count > 0 ? count : ''}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
      {/* Day labels at bottom */}
      <tfoot>
        <tr>
          <th></th>
          {dayLabels.map(day => <th>{day}</th>)}
        </tr>
      </tfoot>
    </table>
  );
}

// GET /charts - Charts dashboard with Chart.js
app.get('/charts', async (c) => {
  const chain = getChainFromQuery(c);
  const timeRange = (c.req.query('timeRange') as '7d'|'30d'|'90d'|'all') || 'all';
  const tokenIdStr = c.req.query('tokenId');
  const tokenId = tokenIdStr ? parseInt(tokenIdStr) : null;

  // Token A and Token B for comparison (amount/volume charts)
  const tokenAStr = c.req.query('tokenA');
  const tokenBStr = c.req.query('tokenB');
  const tokenA = tokenAStr ? parseInt(tokenAStr) : null;
  const tokenB = tokenBStr ? parseInt(tokenBStr) : null;

  // Convert time range to dates
  const dateRange = getDateRangeFromTimeRange(timeRange);
  const commonParams = { chain, ...dateRange };
  const tokenParams = { ...commonParams, tokenId };

  // Fetch tokens for dropdowns with chain info
  const allTokensRaw = chain === 'all'
    ? await db.select({ id: schema.tokens.id, symbol: schema.tokens.symbol, chain: schema.tokens.chain })
        .from(schema.tokens)
        .orderBy(schema.tokens.symbol)
    : await db.select({ id: schema.tokens.id, symbol: schema.tokens.symbol, chain: schema.tokens.chain })
        .from(schema.tokens)
        .where(eq(schema.tokens.chain, chain))
        .orderBy(schema.tokens.symbol);

  // Build token dropdown options with "SYMBOL (chain)" format and aggregate options
  interface TokenOption {
    id: number | string;
    displayName: string;
    isAggregate: boolean;
  }

  const tokenOptionsMap = new Map<string, { chains: Set<string>; ids: number[] }>();

  // Group tokens by symbol
  allTokensRaw.forEach(token => {
    const symbol = token.symbol || 'Unknown';
    if (!tokenOptionsMap.has(symbol)) {
      tokenOptionsMap.set(symbol, { chains: new Set(), ids: [] });
    }
    const entry = tokenOptionsMap.get(symbol)!;
    entry.chains.add(token.chain);
    entry.ids.push(token.id);
  });

  // Build final token options list
  const tokenOptions: TokenOption[] = [];

  // Add chain-wide aggregates at the top (if chain='all')
  if (chain === 'all') {
    const hasEthereum = allTokensRaw.some(t => t.chain === 'ethereum');
    const hasPolygon = allTokensRaw.some(t => t.chain === 'polygon');

    if (hasEthereum) {
      tokenOptions.push({
        id: 'chain_ethereum',
        displayName: 'All Ethereum Tokens',
        isAggregate: true,
      });
    }
    if (hasPolygon) {
      tokenOptions.push({
        id: 'chain_polygon',
        displayName: 'All Polygon Tokens',
        isAggregate: true,
      });
    }
  }

  // Add symbol-level aggregates and individual tokens
  const symbolEntries = Array.from(tokenOptionsMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  symbolEntries.forEach(([symbol, data]) => {
    if (data.chains.size > 1) {
      // Add aggregate option first
      tokenOptions.push({
        id: `agg_${symbol}`,
        displayName: `${symbol} (all)`,
        isAggregate: true,
      });
    }
    // Add per-chain options
    const chainsSorted = Array.from(data.chains).sort();
    chainsSorted.forEach(chainName => {
      const token = allTokensRaw.find(t => t.symbol === symbol && t.chain === chainName);
      if (token) {
        tokenOptions.push({
          id: token.id,
          displayName: `${symbol} (${chainName})`,
          isAggregate: false,
        });
      }
    });
  });

  // Default tokenA to first non-aggregate token if not specified
  const defaultTokenA = tokenA || (tokenOptions.find(opt => !opt.isAggregate)?.id as number) || null;
  const tokenAParams = { ...commonParams, tokenId: defaultTokenA };
  const tokenBParams = tokenB ? { ...commonParams, tokenId: tokenB } : null;

  // Fetch data for all charts in parallel
  const fetchPromises = [
    getMeanDepositAmountsOverTime(tokenAParams),
    getMeanWithdrawalAmountsOverTime(tokenAParams),
    getDailyVolumeOverTime(tokenAParams),
    getRelayerHHIOverTime(commonParams),
    getHourlyActivityHeatmap(commonParams),
    getActivityIntensityOverTime(tokenParams),
    getTopTokensByVolume({ ...commonParams, limit: 10 }),
    getTopTokensByTransactionCount({ ...commonParams, limit: 10 }),
    getTokenDiversityOverTime(commonParams),
    // Chain comparison: fetch both ethereum and polygon for these charts
    getActiveRelayersOverTime({ ...commonParams, chain: 'ethereum' }),
    getActiveRelayersOverTime({ ...commonParams, chain: 'polygon' }),
    getTop5RelayerShareOverTime({ ...commonParams, chain: 'ethereum' }),
    getTop5RelayerShareOverTime({ ...commonParams, chain: 'polygon' }),
    getNetFlowOverTime({ ...tokenParams, chain: 'ethereum' }),
    getNetFlowOverTime({ ...tokenParams, chain: 'polygon' }),
  ];

  // Add Token B data if comparing
  if (tokenBParams) {
    fetchPromises.push(
      getMeanDepositAmountsOverTime(tokenBParams),
      getMeanWithdrawalAmountsOverTime(tokenBParams),
      getDailyVolumeOverTime(tokenBParams)
    );
  }

  const results = await Promise.all(fetchPromises);

  const meanDepositsA = results[0] as Awaited<ReturnType<typeof getMeanDepositAmountsOverTime>>;
  const meanWithdrawalsA = results[1] as Awaited<ReturnType<typeof getMeanWithdrawalAmountsOverTime>>;
  const dailyVolumeA = results[2] as Awaited<ReturnType<typeof getDailyVolumeOverTime>>;
  const relayerHHI = results[3] as Awaited<ReturnType<typeof getRelayerHHIOverTime>>;
  const hourlyActivity = results[4] as Awaited<ReturnType<typeof getHourlyActivityHeatmap>>;
  const activityIntensity = results[5] as Awaited<ReturnType<typeof getActivityIntensityOverTime>>;
  const topTokens = results[6] as Awaited<ReturnType<typeof getTopTokensByVolume>>;
  const topTokensByTxCount = results[7] as Awaited<ReturnType<typeof getTopTokensByTransactionCount>>;
  const tokenDiversity = results[8] as Awaited<ReturnType<typeof getTokenDiversityOverTime>>;
  const activeRelayersEth = results[9] as Awaited<ReturnType<typeof getActiveRelayersOverTime>>;
  const activeRelayersPolygon = results[10] as Awaited<ReturnType<typeof getActiveRelayersOverTime>>;
  const top5RelayerShareEth = results[11] as Awaited<ReturnType<typeof getTop5RelayerShareOverTime>>;
  const top5RelayerSharePolygon = results[12] as Awaited<ReturnType<typeof getTop5RelayerShareOverTime>>;
  const netFlowEth = results[13] as Awaited<ReturnType<typeof getNetFlowOverTime>>;
  const netFlowPolygon = results[14] as Awaited<ReturnType<typeof getNetFlowOverTime>>;
  const meanDepositsB = tokenB ? results[15] as Awaited<ReturnType<typeof getMeanDepositAmountsOverTime>> : undefined;
  const meanWithdrawalsB = tokenB ? results[16] as Awaited<ReturnType<typeof getMeanWithdrawalAmountsOverTime>> : undefined;
  const dailyVolumeB = tokenB ? results[17] as Awaited<ReturnType<typeof getDailyVolumeOverTime>> : undefined;

  // Get token display names for chart legends
  const tokenAName = tokenOptions.find(opt => opt.id === defaultTokenA)?.displayName || 'Token A';
  const tokenBName = tokenB ? tokenOptions.find(opt => opt.id === tokenB)?.displayName || 'Token B' : null;

  // Prepare chart data
  const chartData = {
    meanAmounts: {
      labels: meanDepositsA.map(d => d.date),
      depositsA: meanDepositsA.map(d => d.value),
      withdrawalsA: meanWithdrawalsA.map(d => d.value),
      depositsB: meanDepositsB ? meanDepositsB.map(d => d.value) : [],
      withdrawalsB: meanWithdrawalsB ? meanWithdrawalsB.map(d => d.value) : [],
      tokenAName,
      tokenBName,
      isComparing: !!tokenB,
    },
    volume: {
      labels: dailyVolumeA.map(d => d.date),
      valuesA: dailyVolumeA.map(d => d.value),
      valuesB: dailyVolumeB ? dailyVolumeB.map(d => d.value) : [],
      tokenAName,
      tokenBName,
      isComparing: !!tokenB,
    },
    hhi: {
      labels: relayerHHI.map(d => d.date),
      values: relayerHHI.map(d => d.value),
    },
    intensity: {
      labels: activityIntensity.map(d => d.date),
      actual: activityIntensity.map(d => d.txCount),
      movingAvg: activityIntensity.map(d => d.movingAvg),
    },
    topTokens: {
      labels: topTokens.map(t => t.symbol),
      values: topTokens.map(t => t.totalVolume),
    },
    topTokensByTxCount: {
      labels: topTokensByTxCount.map(t => t.symbol),
      values: topTokensByTxCount.map(t => t.totalTxCount),
    },
    diversity: {
      labels: tokenDiversity.map(d => d.date),
      values: tokenDiversity.map(d => d.value),
    },
    activeRelayers: {
      labels: activeRelayersEth.map(d => d.date),
      ethereum: activeRelayersEth.map(d => d.value),
      polygon: activeRelayersPolygon.map(d => d.value),
    },
    top5Share: {
      labels: top5RelayerShareEth.map(d => d.date),
      ethereum: top5RelayerShareEth.map(d => d.value),
      polygon: top5RelayerSharePolygon.map(d => d.value),
    },
    netFlow: {
      labels: netFlowEth.map(d => d.date),
      ethereum: netFlowEth.map(d => d.value),
      polygon: netFlowPolygon.map(d => d.value),
    },
  };

  return c.render(
    <section>
      <h2>Charts Dashboard <span class="chain-badge">{getChainLabel(chain)}</span></h2>
      <p style="color: #7d8590;">Comprehensive visual analytics for Railgun aggregate flows and metrics.</p>

      {/* Global Filter Bar */}
      <div class="filter-bar">
        <form method="get" action="/charts" class="filter-form">
          <input type="hidden" name="chain" value={chain} />

          <div class="filter-group">
            <label for="timeRange">Time Range:</label>
            <select name="timeRange" id="timeRange" class="filter-select">
              <option value="7d" selected={timeRange==='7d'}>Last 7 Days</option>
              <option value="30d" selected={timeRange==='30d'}>Last 30 Days</option>
              <option value="90d" selected={timeRange==='90d'}>Last 90 Days</option>
              <option value="all" selected={timeRange==='all'}>All Time</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="tokenId">Token Filter:</label>
            <select name="tokenId" id="tokenId" class="filter-select">
              <option value="" selected={!tokenId}>All Tokens</option>
              {tokenOptions.map(opt => (
                <option value={typeof opt.id === 'string' ? '' : opt.id} selected={opt.id===tokenId}>
                  {opt.displayName}
                </option>
              ))}
            </select>
          </div>

          <div class="filter-actions">
            <button type="submit" class="filter-btn">Apply Filters</button>
            <a href={`/charts?chain=${chain}`} class="filter-btn filter-btn-reset">Reset</a>
          </div>
        </form>

        {/* Active Filter Indicators */}
        {(timeRange !== 'all' || tokenId) && (
          <div class="active-filters">
            {timeRange !== 'all' && (
              <span class="active-filter-tag">
                Time: {timeRange === '7d' ? 'Last 7 Days' : timeRange === '30d' ? 'Last 30 Days' : 'Last 90 Days'}
              </span>
            )}
            {tokenId && (
              <span class="active-filter-tag">
                Token: {tokenOptions.find(opt => opt.id === tokenId)?.displayName || 'Unknown'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Token Analytics */}
      <h3 style="color: #e6edf3; margin-top: 2rem;">Token Analytics</h3>

      <div class="charts-grid">
        <div class="chart-section">
          <h4>Top Tokens by Transaction Volume (tokens)</h4>
          <p class="chart-description">
            Tokens ranked by total units transferred (deposits + withdrawals). Note: Shows token amounts, not USD value—1M SHIB ≠ 1M USDC.
          </p>
          <div class="chart-container">
            <canvas id="topTokensChart"></canvas>
          </div>
        </div>

        <div class="chart-section">
          <h4>Top Tokens by Transaction Count</h4>
          <p class="chart-description">
            Tokens ranked by number of transactions. Measures activity independent of transfer size or token value.
          </p>
          <div class="chart-container">
            <canvas id="topTokensByTxCountChart"></canvas>
          </div>
        </div>

        <div class="chart-section">
          <h4>Token Diversity</h4>
          <p class="chart-description">
            Number of unique tokens active per day. Higher diversity suggests broader protocol adoption.
          </p>
          <div class="chart-container">
            <canvas id="diversityChart"></canvas>
          </div>
        </div>
      </div>

      {/* Amount & Volume Charts - Combined Tile with Comparison */}
      <h3 style="color: #e6edf3; margin-top: 2rem;">Amount & Volume Analytics</h3>

      <div class="charts-grid">
        <div class="chart-section full-width">
          {/* Token Comparison Selector */}
          <div style="background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 1rem; margin-bottom: 1.5rem;">
            <form method="get" action="/charts" style="display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap;">
              <input type="hidden" name="chain" value={chain} />
              <input type="hidden" name="timeRange" value={timeRange} />
              {tokenId && <input type="hidden" name="tokenId" value={tokenId} />}

              <div class="filter-group" style="flex: 1; min-width: 200px;">
                <label for="tokenA" style="font-size: 0.85rem; font-weight: 500; color: #7d8590;">Token A (Primary):</label>
                <select name="tokenA" id="tokenA" class="filter-select" required>
                  {tokenOptions.filter(opt => !opt.isAggregate || (typeof opt.id === 'string' && opt.id.startsWith('agg_'))).map(opt => (
                    <option value={opt.id} selected={opt.id===defaultTokenA}>
                      {opt.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div class="filter-group" style="flex: 1; min-width: 200px;">
                <label for="tokenB" style="font-size: 0.85rem; font-weight: 500; color: #7d8590;">Compare with (Optional):</label>
                <select name="tokenB" id="tokenB" class="filter-select">
                  <option value="" selected={!tokenB}>None</option>
                  {tokenOptions.filter(opt => (!opt.isAggregate || (typeof opt.id === 'string' && opt.id.startsWith('agg_'))) && opt.id !== defaultTokenA).map(opt => (
                    <option value={opt.id} selected={opt.id===tokenB}>
                      {opt.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div class="filter-actions">
                <button type="submit" class="filter-btn">Update</button>
              </div>
            </form>
          </div>

          {/* Mean Amounts Chart */}
          <h4>Mean Deposit & Withdrawal Amounts Over Time</h4>
          <p class="chart-description">
            Average deposit and withdrawal size in token units. {tokenB ? 'Comparing two tokens side by side.' : 'Shows typical transaction sizes over time.'}
          </p>
          <div class="chart-container">
            <canvas id="meanAmountsChart"></canvas>
          </div>

          {/* Daily Volume Chart */}
          <h4 style="margin-top: 2rem;">Daily Volume (Deposits + Withdrawals)</h4>
          <p class="chart-description">
            Total token units deposited and withdrawn per day. {tokenB ? 'Comparing volumes for both tokens.' : ''}
          </p>
          <div class="chart-container">
            <canvas id="volumeChart"></canvas>
          </div>
        </div>
      </div>

      {/* Relayer Metrics */}
      <h3 style="color: #e6edf3; margin-top: 2rem;">Relayer Metrics</h3>

      <div class="charts-grid">
        <div class="chart-section full-width">
          <h4>Relayer Concentration (HHI) Over Time</h4>
          <p class="chart-description">
            Herfindahl-Hirschman Index measuring relayer market concentration. Ranges from 0 (perfectly distributed) to 1 (single relayer monopoly). Values above 0.25 indicate high concentration.
          </p>
          <div class="chart-container">
            <canvas id="hhiChart"></canvas>
          </div>
        </div>

        <div class="chart-section">
          <h4>Active Relayers Over Time</h4>
          <p class="chart-description">
            Number of unique relayers processing transactions daily. More relayers indicates healthier decentralization of relay infrastructure.
          </p>
          <div class="chart-container">
            <canvas id="activeRelayersChart"></canvas>
          </div>
        </div>

        <div class="chart-section">
          <h4>Top 5 Relayer Market Share</h4>
          <p class="chart-description">
            Percentage of transaction volume handled by the top 5 relayers. Lower values indicate more distributed relay activity.
          </p>
          <div class="chart-container">
            <canvas id="top5ShareChart"></canvas>
          </div>
        </div>
      </div>

      {/* Protocol Health */}
      <h3 style="color: #e6edf3; margin-top: 2rem;">Protocol Health</h3>

      <div class="charts-grid">
        <div class="chart-section full-width">
          <h4>Net Flow Over Time</h4>
          <p class="chart-description">
            Deposits minus withdrawals. Positive values (green) indicate privacy pool growth; negative values (red) indicate shrinkage. Larger pools provide stronger privacy guarantees.
          </p>
          <div class="chart-container">
            <canvas id="netFlowChart"></canvas>
          </div>
        </div>
      </div>

      {/* Activity Patterns */}
      <h3 style="color: #e6edf3; margin-top: 2rem;">Activity Patterns</h3>

      <div class="charts-grid">
        <div class="chart-section full-width">
          <h4>Hourly Activity Heatmap</h4>
          <p class="chart-description">
            Transaction distribution by hour and day of week. Darker colors indicate higher activity periods.
          </p>
          <div class="chart-container chart-heatmap">
            {renderHeatmapTable(hourlyActivity)}
          </div>
        </div>

        <div class="chart-section">
          <h4>Activity Intensity</h4>
          <p class="chart-description">
            Daily transaction count with 7-day moving average overlay. Shows overall protocol usage trends.
          </p>
          <div class="chart-container">
            <canvas id="intensityChart"></canvas>
          </div>
        </div>
      </div>

      {/* Embed chart data */}
      <script
        id="chart-data"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(chartData) }}
      />

      {/* Chart rendering scripts */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const dataEl = document.getElementById('chart-data');
          const data = JSON.parse(dataEl.textContent);

          // Helper: Format large numbers (1.2M, 450K, etc.)
          const formatNumber = (num) => {
            if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
            if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
            if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
            return num.toFixed(2);
          };

          // Helper: Format dates (Mar 15 instead of 2025-03-15)
          const formatDate = (dateStr) => {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          };

          // Common dark theme chart options
          const darkThemeOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: { color: '#e6edf3', font: { size: 12 } }
              }
            },
            scales: {
              x: {
                ticks: {
                  color: '#7d8590',
                  maxRotation: 45,
                  minRotation: 0,
                  callback: function(value, index) {
                    const label = this.getLabelForValue(value);
                    return formatDate(label);
                  }
                },
                grid: { color: '#30363d', lineWidth: 0.5 },
                title: { display: false }
              },
              y: {
                ticks: {
                  color: '#7d8590',
                  callback: function(value) {
                    return formatNumber(value);
                  }
                },
                grid: { color: '#30363d', lineWidth: 0.5 },
                title: { display: false }
              }
            }
          };

          // Chart 1: Mean Amounts (Line Chart with Comparison Support)
          const ctx1 = document.getElementById('meanAmountsChart').getContext('2d');
          const meanAmountsDatasets = [
            {
              label: data.meanAmounts.tokenAName + ' Deposits',
              data: data.meanAmounts.depositsA,
              borderColor: '#58a6ff',
              backgroundColor: 'rgba(88, 166, 255, 0.1)',
              borderWidth: 2,
              borderDash: [],
              fill: false,
              tension: 0.3,
              pointRadius: 2,
              pointHoverRadius: 5
            },
            {
              label: data.meanAmounts.tokenAName + ' Withdrawals',
              data: data.meanAmounts.withdrawalsA,
              borderColor: '#f85149',
              backgroundColor: 'rgba(248, 81, 73, 0.1)',
              borderWidth: 2,
              borderDash: [],
              fill: false,
              tension: 0.3,
              pointRadius: 2,
              pointHoverRadius: 5
            }
          ];

          if (data.meanAmounts.isComparing) {
            meanAmountsDatasets.push(
              {
                label: data.meanAmounts.tokenBName + ' Deposits',
                data: data.meanAmounts.depositsB,
                borderColor: '#56d364',
                backgroundColor: 'rgba(86, 211, 100, 0.1)',
                borderWidth: 2,
                borderDash: [],
                fill: false,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5
              },
              {
                label: data.meanAmounts.tokenBName + ' Withdrawals',
                data: data.meanAmounts.withdrawalsB,
                borderColor: '#ffa657',
                backgroundColor: 'rgba(255, 166, 87, 0.1)',
                borderWidth: 2,
                borderDash: [],
                fill: false,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5
              }
            );
          }

          new Chart(ctx1, {
            type: 'line',
            data: {
              labels: data.meanAmounts.labels,
              datasets: meanAmountsDatasets
            },
            options: { ...darkThemeOptions, scales: { ...darkThemeOptions.scales, y: { ...darkThemeOptions.scales.y, beginAtZero: true } } }
          });

          // Chart 2: Daily Volume (Area Chart with Comparison Support)
          const ctx2 = document.getElementById('volumeChart').getContext('2d');
          const volumeDatasets = [
            {
              label: data.volume.tokenAName + ' Volume',
              data: data.volume.valuesA,
              borderColor: '#56d364',
              backgroundColor: 'rgba(86, 211, 100, 0.2)',
              borderWidth: 2,
              borderDash: [],
              fill: true,
              tension: 0.3,
              pointRadius: 0
            }
          ];

          if (data.volume.isComparing) {
            volumeDatasets.push({
              label: data.volume.tokenBName + ' Volume',
              data: data.volume.valuesB,
              borderColor: '#a371f7',
              backgroundColor: 'rgba(163, 113, 247, 0.2)',
              borderWidth: 2,
              borderDash: [],
              fill: true,
              tension: 0.3,
              pointRadius: 0
            });
          }

          new Chart(ctx2, {
            type: 'line',
            data: {
              labels: data.volume.labels,
              datasets: volumeDatasets
            },
            options: { ...darkThemeOptions, scales: { ...darkThemeOptions.scales, y: { ...darkThemeOptions.scales.y, beginAtZero: true } } }
          });

          // Chart 3: Relayer HHI (Line Chart)
          const ctx3 = document.getElementById('hhiChart').getContext('2d');
          new Chart(ctx3, {
            type: 'line',
            data: {
              labels: data.hhi.labels,
              datasets: [
                {
                  label: 'HHI',
                  data: data.hhi.values,
                  borderColor: '#a371f7',
                  backgroundColor: 'rgba(163, 113, 247, 0.1)',
                  borderWidth: 2,
                  fill: false,
                  tension: 0.3,
                  pointRadius: 2,
                  pointHoverRadius: 5
                }
              ]
            },
            options: darkThemeOptions
          });

          // Chart 4: Activity Intensity (Line Chart with Moving Average)
          const ctx4 = document.getElementById('intensityChart').getContext('2d');
          new Chart(ctx4, {
            type: 'line',
            data: {
              labels: data.intensity.labels,
              datasets: [
                {
                  label: 'Daily Tx Count',
                  data: data.intensity.actual,
                  borderColor: '#ffa657',
                  backgroundColor: 'rgba(255, 166, 87, 0.1)',
                  borderWidth: 2,
                  fill: false,
                  tension: 0.3,
                  pointRadius: 1
                },
                {
                  label: '7-Day MA',
                  data: data.intensity.movingAvg,
                  borderColor: '#a371f7',
                  backgroundColor: 'rgba(163, 113, 247, 0.1)',
                  borderWidth: 2,
                  borderDash: [5, 5],
                  fill: false,
                  tension: 0.3,
                  pointRadius: 0
                }
              ]
            },
            options: { ...darkThemeOptions, scales: { ...darkThemeOptions.scales, y: { ...darkThemeOptions.scales.y, beginAtZero: true } } }
          });

          // Chart 5: Top Tokens (Horizontal Bar Chart)
          const ctx5 = document.getElementById('topTokensChart').getContext('2d');
          new Chart(ctx5, {
            type: 'bar',
            data: {
              labels: data.topTokens.labels,
              datasets: [
                {
                  label: 'Total Volume',
                  data: data.topTokens.values,
                  backgroundColor: '#58a6ff',
                  borderColor: '#1f6feb',
                  borderWidth: 1
                }
              ]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              },
              scales: {
                x: {
                  beginAtZero: true,
                  ticks: { color: '#7d8590', callback: function(value) { return formatNumber(value); } },
                  grid: { color: '#30363d', lineWidth: 0.5 }
                },
                y: {
                  ticks: { color: '#7d8590' },
                  grid: { display: false }
                }
              }
            }
          });

          // Chart 6: Top Tokens by Transaction Count (Horizontal Bar Chart)
          const ctx6 = document.getElementById('topTokensByTxCountChart').getContext('2d');
          new Chart(ctx6, {
            type: 'bar',
            data: {
              labels: data.topTokensByTxCount.labels,
              datasets: [
                {
                  label: 'Transaction Count',
                  data: data.topTokensByTxCount.values,
                  backgroundColor: '#56d364',
                  borderColor: '#2ea043',
                  borderWidth: 1
                }
              ]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              },
              scales: {
                x: {
                  beginAtZero: true,
                  ticks: { color: '#7d8590', callback: function(value) { return formatNumber(value); } },
                  grid: { color: '#30363d', lineWidth: 0.5 }
                },
                y: {
                  ticks: { color: '#7d8590' },
                  grid: { display: false }
                }
              }
            }
          });

          // Chart 7: Token Diversity (Line Chart)
          const ctx7 = document.getElementById('diversityChart').getContext('2d');
          new Chart(ctx7, {
            type: 'line',
            data: {
              labels: data.diversity.labels,
              datasets: [
                {
                  label: 'Unique Tokens',
                  data: data.diversity.values,
                  borderColor: '#f85149',
                  backgroundColor: 'rgba(248, 81, 73, 0.2)',
                  borderWidth: 2,
                  fill: true,
                  tension: 0.3,
                  pointRadius: 2,
                  pointHoverRadius: 5
                }
              ]
            },
            options: { ...darkThemeOptions, scales: { ...darkThemeOptions.scales, y: { ...darkThemeOptions.scales.y, beginAtZero: true } } }
          });

          // Chart 8: Active Relayers Over Time (Chain Comparison)
          const ctx8 = document.getElementById('activeRelayersChart').getContext('2d');
          new Chart(ctx8, {
            type: 'line',
            data: {
              labels: data.activeRelayers.labels,
              datasets: [
                {
                  label: 'Ethereum',
                  data: data.activeRelayers.ethereum,
                  borderColor: '#a371f7',
                  backgroundColor: 'rgba(163, 113, 247, 0.1)',
                  borderWidth: 2,
                  borderDash: [],
                  fill: false,
                  tension: 0.3,
                  pointRadius: 2,
                  pointHoverRadius: 5
                },
                {
                  label: 'Polygon',
                  data: data.activeRelayers.polygon,
                  borderColor: '#56d364',
                  backgroundColor: 'rgba(86, 211, 100, 0.1)',
                  borderWidth: 2,
                  borderDash: [5, 5],
                  fill: false,
                  tension: 0.3,
                  pointRadius: 2,
                  pointHoverRadius: 5
                }
              ]
            },
            options: { ...darkThemeOptions, scales: { ...darkThemeOptions.scales, y: { ...darkThemeOptions.scales.y, beginAtZero: true } } }
          });

          // Chart 9: Top 5 Relayer Share Over Time (Chain Comparison with Percentage)
          const ctx9 = document.getElementById('top5ShareChart').getContext('2d');
          new Chart(ctx9, {
            type: 'line',
            data: {
              labels: data.top5Share.labels,
              datasets: [
                {
                  label: 'Ethereum',
                  data: data.top5Share.ethereum,
                  borderColor: '#ffa657',
                  backgroundColor: 'rgba(255, 166, 87, 0.1)',
                  borderWidth: 2,
                  borderDash: [],
                  fill: false,
                  tension: 0.3,
                  pointRadius: 2,
                  pointHoverRadius: 5
                },
                {
                  label: 'Polygon',
                  data: data.top5Share.polygon,
                  borderColor: '#58a6ff',
                  backgroundColor: 'rgba(88, 166, 255, 0.1)',
                  borderWidth: 2,
                  borderDash: [5, 5],
                  fill: false,
                  tension: 0.3,
                  pointRadius: 2,
                  pointHoverRadius: 5
                }
              ]
            },
            options: {
              ...darkThemeOptions,
              scales: {
                ...darkThemeOptions.scales,
                y: {
                  ...darkThemeOptions.scales.y,
                  beginAtZero: true,
                  max: 1,
                  ticks: {
                    color: '#7d8590',
                    callback: function(value) {
                      return (value * 100).toFixed(0) + '%';
                    }
                  }
                }
              }
            }
          });

          // Chart 10: Net Flow Over Time (Chain Comparison with Positive/Negative Coloring)
          const ctx10 = document.getElementById('netFlowChart').getContext('2d');

          // Split ethereum data into positive and negative
          const ethPositive = data.netFlow.ethereum.map(v => v >= 0 ? v : null);
          const ethNegative = data.netFlow.ethereum.map(v => v < 0 ? v : null);

          // Split polygon data into positive and negative
          const polyPositive = data.netFlow.polygon.map(v => v >= 0 ? v : null);
          const polyNegative = data.netFlow.polygon.map(v => v < 0 ? v : null);

          new Chart(ctx10, {
            type: 'line',
            data: {
              labels: data.netFlow.labels,
              datasets: [
                {
                  label: 'Ethereum (Positive)',
                  data: ethPositive,
                  borderColor: '#56d364',
                  backgroundColor: 'rgba(86, 211, 100, 0.2)',
                  borderWidth: 2,
                  borderDash: [],
                  fill: true,
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: false
                },
                {
                  label: 'Ethereum (Negative)',
                  data: ethNegative,
                  borderColor: '#f85149',
                  backgroundColor: 'rgba(248, 81, 73, 0.2)',
                  borderWidth: 2,
                  borderDash: [],
                  fill: true,
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: false
                },
                {
                  label: 'Polygon (Positive)',
                  data: polyPositive,
                  borderColor: '#56d364',
                  backgroundColor: 'rgba(86, 211, 100, 0.1)',
                  borderWidth: 2,
                  borderDash: [5, 5],
                  fill: true,
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: false
                },
                {
                  label: 'Polygon (Negative)',
                  data: polyNegative,
                  borderColor: '#f85149',
                  backgroundColor: 'rgba(248, 81, 73, 0.1)',
                  borderWidth: 2,
                  borderDash: [5, 5],
                  fill: true,
                  tension: 0.3,
                  pointRadius: 0,
                  spanGaps: false
                }
              ]
            },
            options: {
              ...darkThemeOptions,
              scales: {
                ...darkThemeOptions.scales,
                y: {
                  ...darkThemeOptions.scales.y,
                  ticks: {
                    color: '#7d8590',
                    callback: function(value) {
                      return formatNumber(value);
                    }
                  }
                }
              }
            }
          });
        })();
      `}} />
    </section>
  );
});

export default app;
