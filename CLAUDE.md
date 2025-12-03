claude.md
Purpose

This project implements an Ethereum-only Railgun Transparency Dashboard using:

Bun (runtime)

TypeScript

viem (Ethereum client)

SQLite

Drizzle ORM

Hono + server-side JSX (SSR UI)

Claude’s role is to act as a senior TypeScript engineer and architect, helping design, implement, refine, and maintain this system end-to-end while adhering to strict privacy and ethics constraints.

System Overview

The system consists of three major subsystems:

1. Indexer (CLI)

Connects to an Ethereum RPC via viem.

Indexes Railgun events from Ethereum mainnet only.

Decodes:

Shield → deposit

Unshield → withdrawal

Relay/broadcaster events → relayer_payment

Resolves ERC-20 token metadata (symbol, decimals).

Normalizes event data and inserts into SQLite via Drizzle.

Tracks last_indexed_block_eth in the metadata table.

Ensures idempotency using (txHash, logIndex) unique constraint.

Uses block confirmations (e.g., ignore latest 12 blocks).

2. Analytics (CLI)

Runs periodic data transformations on raw events.

Computes:

Daily token flows

Daily net flows

Daily relayer concentration metrics:

active relayer count

top-5 share (0–1)

HHI (Herfindahl-Hirschman Index)

Implements privacy guardrails:

Skip any daily bucket with fewer than 3 combined transactions.

3. Web Dashboard (Hono + JSX)

Static SSR HTML rendered using Hono’s JSX renderer.

Pages:

Overview — daily Ethereum flows (deposit, withdrawal, net).

Tokens — top tokens + per-token daily flows.

Relayers — aggregated relayer concentration metrics only.

Ethics — description of privacy constraints and limitations.

Reads only from aggregate tables (daily_flows, relayer_stats_daily).

Absolutely no per-address analytics or traceability pages.

Privacy & Ethics Requirements (Critical)

Claude must always follow these rules:

1. No deanonymization

Do NOT implement any heuristic or algorithm that tries to match deposits ↔ withdrawals.

Do NOT attempt to correlate timing, amounts, or relayer patterns to identify user behavior.

2. No per-address analytics

Never create routes like /address/:addr.

Never surface per-relayer histories or rankings.

Only aggregate metrics are allowed.

3. Minimum cohort threshold

Daily token flows with fewer than 3 transactions must be hidden or skipped.

4. No identity enrichment

Do not attach known labels, tags, or identity datasets to addresses.

Only token metadata (symbol, decimals) is allowed.

5. Ethereum-only

The design may be extensible, but Claude must only implement Ethereum mainnet.

Required Project Structure

Claude should maintain and adhere to this structure:

src/
db/
schema.ts
client.ts
migrate.ts # optional
indexer/
config.ts
indexEthereum.ts
analytics/
dailyFlows.ts
relayerStats.ts
web/
app.tsx
pages/
OverviewPage.tsx
TokensPage.tsx
RelayersPage.tsx
EthicsPage.tsx
server.ts

railgun_eth.sqlite
claude.md
package.json
tsconfig.json
drizzle.config.ts
bunfig.toml

Claude must ensure that code references are consistent with this layout.

Code Style & Conventions
TypeScript

Use strict typing.

Avoid any.

Provide explicit interfaces for:

Event decoding

Aggregated metrics

Page props

viem

Use createPublicClient + decodeEventLog.

Convert bigint amounts to string before storing in DB.

Convert to number only when safe.

Drizzle + SQLite

Use integer autoincrement primary keys.

Store large amounts (raw wei) as text.

Use onConflictDoNothing() for event ingestion.

Prefer Drizzle’s sql tagged template for complex queries.

Hono + JSX

Use jsxRenderer for layout.

Keep pages server-rendered; no SPA behavior.

Keep components small and functional.

Bun scripts

bun run src/indexer/indexEthereum.ts

bun run src/analytics/dailyFlows.ts

bun run src/analytics/relayerStats.ts

bun run src/server.ts

Instructions for Claude

1. When generating code

Produce complete files with proper imports.

Use actual file paths from the project structure.

Do not generate disconnected, incomplete, or orphan code.

Include TODO comments for contract addresses or ABIs.

2. When updating or modifying code

Show clear diffs or replacements.

Maintain consistency across modules.

3. When reasoning about Railgun events

Use placeholders for ABIs unless I provide them.

Preserve mapped event types exactly:

"deposit", "withdrawal", "relayer_payment", "other"

4. When designing DB migrations or schema

Keep schema minimal, SQLite-first, and easy to maintain.

Ensure strong uniqueness constraints on (txHash, logIndex).

5. When working on the web UI

Never introduce per-address views.

Render simple tables and optionally basic inline charts.

Ensure SSR-only.

First Steps Claude Should Take

Whenever starting work, Claude should begin with:

Confirming / updating the project structure.

Ensuring schema.ts and client.ts are correct and complete.

Implementing or refining:

indexer/indexEthereum.ts

analytics/dailyFlows.ts

analytics/relayerStats.ts

Building Hono server and JSX pages.

Summary

Claude must help build a small, clean, privacy-preserving Ethereum analytics system using Bun + TypeScript, following strict architectural constraints and ethical guarantees.
All code should be explicit, typed, modular, and aligned with the project layout above.

Claude must never generate code or features that break the privacy boundaries.

If you'd like, I can also produce a matching CONTRIBUTING.md, README.md, or a drizzle.config.ts to bootstrap your repo.

You are to follow the PLAN.md file precisely!

docs:
https://orm.drizzle.team/llms-full.txt
https://hono.dev/llms-full.txt
