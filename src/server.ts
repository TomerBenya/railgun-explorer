import { Hono } from 'hono';
import { db, schema } from './db/client';
import { desc, sql } from 'drizzle-orm';

const app = new Hono();

// HTML layout helper
const layout = (title: string, content: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Railgun Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f0f0f; color: #e0e0e0; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    nav { background: #1a1a1a; padding: 1rem 2rem; border-bottom: 1px solid #333; }
    nav ul { display: flex; gap: 2rem; list-style: none; max-width: 1200px; margin: 0 auto; }
    nav a { color: #9ca3af; text-decoration: none; transition: color 0.2s; }
    nav a:hover, nav a.active { color: #10b981; }
    h1 { color: #10b981; margin-bottom: 1.5rem; }
    h2 { color: #9ca3af; margin: 2rem 0 1rem; font-size: 1.25rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; background: #1a1a1a; border-radius: 8px; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #333; }
    th { background: #252525; color: #9ca3af; font-weight: 500; }
    tr:hover { background: #252525; }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    .card { background: #1a1a1a; border-radius: 8px; padding: 1.5rem; margin: 1rem 0; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .stat { background: #252525; padding: 1rem; border-radius: 8px; }
    .stat-value { font-size: 1.5rem; font-weight: 600; color: #10b981; }
    .stat-label { color: #9ca3af; font-size: 0.875rem; }
    .ethics-section { background: #1a1a1a; padding: 1.5rem; border-radius: 8px; margin: 1rem 0; }
    .ethics-section h3 { color: #10b981; margin-bottom: 0.5rem; }
    .ethics-section p { color: #9ca3af; }
    footer { text-align: center; padding: 2rem; color: #666; font-size: 0.875rem; }
  </style>
</head>
<body>
  <nav>
    <ul>
      <li><a href="/">Overview</a></li>
      <li><a href="/tokens">Tokens</a></li>
      <li><a href="/relayers">Relayers</a></li>
      <li><a href="/ethics">Ethics</a></li>
    </ul>
  </nav>
  <div class="container">
    ${content}
  </div>
  <footer>
    Railgun Transparency Dashboard - Ethereum Mainnet Only
  </footer>
</body>
</html>
`;

// Overview page - daily flows
app.get('/', async (c) => {
  const flows = await db
    .select({
      date: schema.dailyFlows.date,
      totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
      netFlow: sql<number>`sum(${schema.dailyFlows.netFlow})`,
    })
    .from(schema.dailyFlows)
    .groupBy(schema.dailyFlows.date)
    .orderBy(desc(schema.dailyFlows.date))
    .limit(30);

  const content = `
    <h1>Overview</h1>
    <p>Daily aggregate flows across all tokens (last 30 days)</p>

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Deposits</th>
          <th>Withdrawals</th>
          <th>Net Flow</th>
        </tr>
      </thead>
      <tbody>
        ${flows.length === 0 ? '<tr><td colspan="4">No data yet. Run the indexer and analytics first.</td></tr>' :
          flows.map(f => `
            <tr>
              <td>${f.date}</td>
              <td class="positive">+${(f.totalDeposits || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
              <td class="negative">-${(f.totalWithdrawals || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
              <td class="${(f.netFlow || 0) >= 0 ? 'positive' : 'negative'}">${(f.netFlow || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
            </tr>
          `).join('')
        }
      </tbody>
    </table>
  `;

  return c.html(layout('Overview', content));
});

// Tokens page
app.get('/tokens', async (c) => {
  const tokenFlows = await db
    .select({
      symbol: schema.tokens.symbol,
      address: schema.tokens.address,
      totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
      totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
      txCount: sql<number>`sum(${schema.dailyFlows.depositTxCount} + ${schema.dailyFlows.withdrawalTxCount})`,
    })
    .from(schema.dailyFlows)
    .innerJoin(schema.tokens, sql`${schema.dailyFlows.tokenId} = ${schema.tokens.id}`)
    .groupBy(schema.tokens.id)
    .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`))
    .limit(20);

  const content = `
    <h1>Tokens</h1>
    <p>Top tokens by deposit volume</p>

    <table>
      <thead>
        <tr>
          <th>Token</th>
          <th>Total Deposits</th>
          <th>Total Withdrawals</th>
          <th>Transactions</th>
        </tr>
      </thead>
      <tbody>
        ${tokenFlows.length === 0 ? '<tr><td colspan="4">No data yet. Run the indexer and analytics first.</td></tr>' :
          tokenFlows.map(t => `
            <tr>
              <td>${t.symbol || 'Unknown'}</td>
              <td class="positive">+${(t.totalDeposits || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
              <td class="negative">-${(t.totalWithdrawals || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
              <td>${t.txCount || 0}</td>
            </tr>
          `).join('')
        }
      </tbody>
    </table>
  `;

  return c.html(layout('Tokens', content));
});

// Relayers page - aggregated metrics only
app.get('/relayers', async (c) => {
  const stats = await db
    .select()
    .from(schema.relayerStatsDaily)
    .orderBy(desc(schema.relayerStatsDaily.date))
    .limit(30);

  const content = `
    <h1>Relayer Metrics</h1>
    <p>Aggregated relayer concentration metrics (privacy-preserving)</p>

    <div class="card">
      <p><strong>Note:</strong> Only aggregate metrics are shown. No per-relayer data is displayed to preserve privacy.</p>
    </div>

    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Active Relayers</th>
          <th>Top 5 Share</th>
          <th>HHI</th>
          <th>Transactions</th>
        </tr>
      </thead>
      <tbody>
        ${stats.length === 0 ? '<tr><td colspan="5">No data yet. Run the indexer and analytics first.</td></tr>' :
          stats.map(s => `
            <tr>
              <td>${s.date}</td>
              <td>${s.numActiveRelayers}</td>
              <td>${(s.top5Share * 100).toFixed(1)}%</td>
              <td>${s.hhi.toFixed(4)}</td>
              <td>${s.relayerTxCount}</td>
            </tr>
          `).join('')
        }
      </tbody>
    </table>

    <h2>Metric Definitions</h2>
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-label">Top 5 Share</div>
        <p>Percentage of transactions processed by the top 5 relayers (0-100%)</p>
      </div>
      <div class="stat">
        <div class="stat-label">HHI (Herfindahl-Hirschman Index)</div>
        <p>Market concentration metric. Lower = more decentralized (0-1 scale)</p>
      </div>
    </div>
  `;

  return c.html(layout('Relayers', content));
});

// Ethics page
app.get('/ethics', async (c) => {
  const content = `
    <h1>Privacy & Ethics</h1>
    <p>This dashboard is designed with privacy preservation as a core principle.</p>

    <div class="ethics-section">
      <h3>No Deanonymization</h3>
      <p>This dashboard does NOT implement any heuristics or algorithms to match deposits with withdrawals.
         We do not attempt to correlate timing, amounts, or patterns to identify user behavior.</p>
    </div>

    <div class="ethics-section">
      <h3>No Per-Address Analytics</h3>
      <p>There are no address lookup features. We do not surface per-relayer histories, rankings,
         or any data that could be used to track individual addresses.</p>
    </div>

    <div class="ethics-section">
      <h3>Minimum Cohort Threshold</h3>
      <p>Daily token flows with fewer than 3 transactions are hidden to prevent individual
         transaction identification through small cohort analysis.</p>
    </div>

    <div class="ethics-section">
      <h3>No Identity Enrichment</h3>
      <p>We do not attach known labels, tags, or identity datasets to addresses.
         Only basic token metadata (symbol, decimals) is resolved.</p>
    </div>

    <div class="ethics-section">
      <h3>Ethereum Only</h3>
      <p>This dashboard indexes Ethereum mainnet only. Cross-chain correlation
         analysis is explicitly not supported.</p>
    </div>

    <div class="ethics-section">
      <h3>Data Displayed</h3>
      <p>Only aggregate metrics are shown:</p>
      <ul style="margin-top: 0.5rem; margin-left: 1.5rem; color: #9ca3af;">
        <li>Daily deposit/withdrawal volumes (aggregate)</li>
        <li>Token-level aggregate flows</li>
        <li>Relayer concentration metrics (HHI, top-5 share)</li>
      </ul>
    </div>
  `;

  return c.html(layout('Ethics', content));
});

// Health check endpoint
app.get('/health', (c) => c.json({ status: 'ok' }));

const port = parseInt(process.env.PORT || '3000');
console.log(`Starting Railgun Dashboard on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
