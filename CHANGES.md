# Changes Made to Railgun Explorer

This document summarizes all changes made to add Polygon (multi-chain) support and network switching to the frontend.

## Summary
- Added multi-chain support (Ethereum + Polygon)
- Added network switch UI to frontend
- Created separate Polygon indexer
- Updated database schema to support multiple chains
- Updated analytics to handle multi-chain data

---

## 1. Database Schema Changes (`src/db/schema.ts`)

### Added `chain` column to all tables:
- **`tokens`**: Added `chain` column, updated unique constraint to `(chain, address)`
- **`events`**: Added `chain` column, updated unique constraint to `(chain, txHash, logIndex)`
- **`dailyFlows`**: Added `chain` column, updated primary key to `(date, chain, tokenId)`
- **`relayerStatsDaily`**: Added `chain` column, updated primary key to `(date, chain)`

### Migration File
- Created `drizzle/0001_young_fat_cobra.sql` - adds `chain` column to all tables and updates constraints

---

## 2. New Files Created

### Polygon Indexer Files:
- **`src/indexer/configPolygon.ts`**: Polygon-specific configuration
  - RPC URL, start block (23,580,067), batch size (500)
  - Polygon contract addresses (SmartWallet & Relay)
  - Polygon-specific ABI for Unshield events
  - Known Polygon event signatures

- **`src/indexer/indexPolygon.ts`**: Polygon indexer implementation
  - Similar structure to Ethereum indexer
  - Uses Polygon chain from viem
  - Stores events with `chain: 'polygon'`
  - Uses `last_indexed_block_polygon` metadata key
  - Enhanced rate limit handling (30s delays for 429 errors)

- **`src/indexer/tokenResolverPolygon.ts`**: Polygon token resolver
  - Resolves ERC-20 token metadata on Polygon
  - Stores tokens with `chain: 'polygon'`


---

## 3. Modified Files

### `package.json`
- Added script: `"index:polygon": "bun run src/indexer/indexPolygon.ts"`

### `src/indexer/eventDecoder.ts`
- Added Polygon-specific event decoding:
  - Manual decoding for Polygon `Unshield` events (signature `0x49fed1d0...`)
  - Manual token extraction for Polygon `Shield` events (signature `0x4be10945...`)
  - Handles both Ethereum (tuple-based) and Polygon (address-based) token structures
  - Added `POLYGON_EVENT_SIGNATURES` constants

### `src/indexer/indexEthereum.ts`
- Added `chain: 'ethereum'` to all event inserts
- No other functional changes (kept separate as requested)

### `src/indexer/tokenResolver.ts`
- Added `chain: 'ethereum'` filter to all token queries and inserts
- Updated to use chain-aware unique constraint

### `src/analytics/dailyFlows.ts`
- Added `chain` to SELECT, GROUP BY, and INSERT statements
- Now computes flows per chain

### `src/analytics/relayerStats.ts`
- Added `chain` to SELECT, GROUP BY, and INSERT statements
- Updated grouping key to `date|chain` format
- Now computes relayer stats per chain

### `src/web/app.tsx` (Frontend)
- **Network Selector**: Added dropdown to switch between Ethereum and Polygon
- **Chain Query Parameter**: All routes now support `?chain=ethereum` or `?chain=polygon`
- **Data Filtering**: All queries filter by selected chain:
  - Overview page: filters daily flows by chain
  - Tokens page: filters tokens by chain
  - Token detail page: filters events by chain
  - Relayers page: filters relayer stats by chain
  - Charts page: filters chart data by chain
- **Client-side JavaScript**: Updates navigation links with current chain parameter
- **Error Handling**: Improved error display with detailed messages

### `src/server.ts`
- No significant changes (if any, they're minor)

---

## 4. Key Features Added

### Multi-Chain Support
- Database schema supports multiple chains
- Each chain has separate metadata keys (`last_indexed_block_ethereum`, `last_indexed_block_polygon`)
- Tokens and events are chain-specific

### Polygon Indexer
- Separate indexer for Polygon network
- Polygon-specific contract addresses and ABIs
- Enhanced rate limit handling (5s batch delay, 30s retry delay for 429 errors)
- Smaller batch size (500 blocks) to avoid rate limits

### Frontend Network Switching
- Network selector dropdown in header
- URL-based chain selection (`?chain=ethereum` or `?chain=polygon`)
- All pages filter data by selected chain
- Navigation links preserve chain selection

### Event Decoding Improvements
- Supports both Ethereum and Polygon event structures
- Polygon Unshield: `(address, address, uint256, uint256)`
- Polygon Shield: Manual token extraction (amount extraction pending)

---

## 5. Database Migration

To apply the schema changes, run:
```bash
bun run db:migrate
```

This will:
- Add `chain` column to `tokens`, `events`, `dailyFlows`, `relayerStatsDaily`
- Update unique constraints and primary keys
- Backfill existing data with `chain: 'ethereum'` (if migration script handles it)

---

## 6. Environment Variables

### Polygon Indexer:
- `POLYGON_RPC_URL`: Polygon RPC endpoint (defaults to Infura)
- `POLYGON_START_BLOCK`: Starting block for indexing (defaults to 23,580,067)
- `BATCH_SIZE`: Batch size in blocks (defaults to 500)
- `BATCH_DELAY_MS`: Delay between batches in ms (defaults to 5000)

---

## 7. Files to Commit

### New Files:
```
src/indexer/configPolygon.ts
src/indexer/indexPolygon.ts
src/indexer/tokenResolverPolygon.ts
drizzle/0001_young_fat_cobra.sql
drizzle/meta/0001_snapshot.json
```

### Modified Files:
```
package.json
src/db/schema.ts
src/indexer/eventDecoder.ts
src/indexer/indexEthereum.ts
src/indexer/tokenResolver.ts
src/analytics/dailyFlows.ts
src/analytics/relayerStats.ts
src/web/app.tsx
drizzle/meta/_journal.json
```

### Files to Exclude (local database):
```
railgun_eth.sqlite
railgun_eth.sqlite-shm
railgun_eth.sqlite-wal
```

---

## 8. Testing Checklist

- [ ] Run database migration: `bun run db:migrate`
- [ ] Test Ethereum indexer: `bun run index`
- [ ] Test Polygon indexer: `bun run index:polygon`
- [ ] Run analytics: `bun run analytics`
- [ ] Test frontend network switching
- [ ] Verify data appears correctly for both chains
- [ ] Test all pages with both network selections

---

## Notes

- The Ethereum indexer code was kept separate as requested
- Polygon Shield event amount extraction is not yet implemented (amounts set to 0)
- Rate limiting improvements help with public RPC providers

