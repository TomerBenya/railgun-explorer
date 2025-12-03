import { Hono } from 'hono';
import { jsxRenderer } from 'hono/jsx-renderer';
import { db, schema } from '../db/client';
import { desc, sql, eq } from 'drizzle-orm';

const app = new Hono();

// Global layout wrapper
app.use('*', jsxRenderer(({ children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Railgun Transparency Dashboard</title>
      <style>{`
        body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 1rem; }
        nav { display: flex; gap: 1rem; margin-bottom: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 1rem; }
        nav a { text-decoration: none; color: #0066cc; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
        th { background: #f5f5f5; }
      `}</style>
    </head>
    <body>
      <header>
        <h1>Railgun Transparency Dashboard</h1>
        <nav>
          <a href="/">Overview</a>
          <a href="/tokens">Tokens</a>
          <a href="/relayers">Relayers</a>
          <a href="/ethics">Ethics &amp; Limitations</a>
        </nav>
      </header>
      <main>{children}</main>
      <footer style={{ marginTop: '2rem', color: '#666', fontSize: '0.875rem' }}>
        <p>Aggregate analytics only. No individual tracking.</p>
      </footer>
    </body>
  </html>
)));

// GET / - Overview page
app.get('/', async (c) => {
  const flows = await db.select({
    date: schema.dailyFlows.date,
    totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
    totalWithdrawals: sql<number>`sum(${schema.dailyFlows.totalWithdrawals})`,
    netFlow: sql<number>`sum(${schema.dailyFlows.netFlow})`,
  })
    .from(schema.dailyFlows)
    .groupBy(schema.dailyFlows.date)
    .orderBy(desc(schema.dailyFlows.date))
    .limit(30);

  return c.render(
    <section>
      <h2>Daily Overview (All Tokens)</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Deposits</th><th>Withdrawals</th><th>Net Flow</th></tr>
        </thead>
        <tbody>
          {flows.length === 0 ? (
            <tr><td colSpan={4}>No data yet. Run the indexer and analytics first.</td></tr>
          ) : (
            flows.map((row) => (
              <tr>
                <td>{row.date}</td>
                <td>{row.totalDeposits?.toFixed(2)}</td>
                <td>{row.totalWithdrawals?.toFixed(2)}</td>
                <td>{row.netFlow?.toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
});

// GET /tokens - Token list
app.get('/tokens', async (c) => {
  const tokenStats = await db.select({
    id: schema.tokens.id,
    symbol: schema.tokens.symbol,
    address: schema.tokens.address,
    totalDeposits: sql<number>`sum(${schema.dailyFlows.totalDeposits})`,
  })
    .from(schema.tokens)
    .leftJoin(schema.dailyFlows, eq(schema.tokens.id, schema.dailyFlows.tokenId))
    .groupBy(schema.tokens.id)
    .orderBy(desc(sql`sum(${schema.dailyFlows.totalDeposits})`));

  return c.render(
    <section>
      <h2>Tokens by Deposit Volume</h2>
      <table>
        <thead>
          <tr><th>Symbol</th><th>Total Deposits</th><th>Details</th></tr>
        </thead>
        <tbody>
          {tokenStats.length === 0 ? (
            <tr><td colSpan={3}>No data yet. Run the indexer and analytics first.</td></tr>
          ) : (
            tokenStats.map((t) => (
              <tr>
                <td>{t.symbol || 'Unknown'}</td>
                <td>{t.totalDeposits?.toFixed(2) || '0'}</td>
                <td><a href={`/tokens/${t.id}`}>View</a></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
});

// GET /tokens/:id - Token detail
app.get('/tokens/:id', async (c) => {
  const tokenId = parseInt(c.req.param('id'));
  const token = await db.select().from(schema.tokens).where(eq(schema.tokens.id, tokenId)).get();
  const flows = await db.select()
    .from(schema.dailyFlows)
    .where(eq(schema.dailyFlows.tokenId, tokenId))
    .orderBy(desc(schema.dailyFlows.date))
    .limit(30);

  return c.render(
    <section>
      <h2>{token?.symbol || 'Token'} Daily Flows</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Deposits</th><th>Withdrawals</th><th>Net</th></tr>
        </thead>
        <tbody>
          {flows.length === 0 ? (
            <tr><td colSpan={4}>No data for this token.</td></tr>
          ) : (
            flows.map((row) => (
              <tr>
                <td>{row.date}</td>
                <td>{row.totalDeposits.toFixed(2)}</td>
                <td>{row.totalWithdrawals.toFixed(2)}</td>
                <td>{row.netFlow.toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
});

// GET /relayers - Relayer concentration metrics
app.get('/relayers', async (c) => {
  const stats = await db.select()
    .from(schema.relayerStatsDaily)
    .orderBy(desc(schema.relayerStatsDaily.date))
    .limit(30);

  return c.render(
    <section>
      <h2>Relayer Concentration Metrics</h2>
      <p><em>Aggregate statistics only. No individual relayer data exposed.</em></p>
      <table>
        <thead>
          <tr><th>Date</th><th>Active Relayers</th><th>Top 5 Share</th><th>HHI</th><th>Tx Count</th></tr>
        </thead>
        <tbody>
          {stats.length === 0 ? (
            <tr><td colSpan={5}>No data yet. Run the indexer and analytics first.</td></tr>
          ) : (
            stats.map((row) => (
              <tr>
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
    </section>
  );
});

// GET /ethics - Ethics page
app.get('/ethics', (c) => {
  return c.render(
    <section>
      <h2>Ethics &amp; Limitations</h2>
      <h3>Data Sources</h3>
      <p>This dashboard indexes only public on-chain events from Railgun smart contracts on Ethereum mainnet.</p>

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

export default app;
