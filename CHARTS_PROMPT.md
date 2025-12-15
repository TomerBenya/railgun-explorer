# Context: Railgun Transparency Dashboard - Charts Feature Implementation

I'm contributing to a TypeScript/Bun project that provides privacy-preserving Ethereum analytics for the Railgun protocol. I need to build a comprehensive data visualization dashboard at the `/charts` route.

## CRITICAL: Initial Database Setup

**BEFORE ANY OTHER WORK**, we need to handle a temporary local development solution:

1. There is a downloaded JSON file in the project directory containing production database data
2. I cannot connect to the production database currently
3. We need to create a clean database migration that:
   - Reads this JSON file
   - Properly populates the local SQLite database with this data
   - Follows Drizzle ORM best practices
   - Is clearly marked as a temporary development solution
   - Can be easily removed/replaced when production DB access is restored

**Task 1: Create the database seeding migration**
- Locate the JSON file in the project directory
- Examine its structure to understand the data format
- Create a migration script (e.g., `src/db/seedFromJson.ts`) that:
  - Validates the JSON structure
  - Uses Drizzle ORM to insert data into appropriate tables
  - Handles any data type conversions (especially bigint/string conversions)
  - Provides clear logging of what's being imported
  - Includes error handling for malformed data
- Add a script to `package.json` for easy execution (e.g., `"seed": "bun run src/db/seedFromJson.ts"`)
- Test that the database is properly populated before proceeding

**Once seeding is complete and verified, proceed to Phase 1.**

---

## Project Overview

**Tech Stack:**
- Runtime: Bun
- Language: TypeScript
- Blockchain Client: viem
- Database: SQLite via Drizzle ORM
- Web Framework: Hono with server-side JSX (SSR)
- **Charts: Chart.js (for data visualization)**

**Key Files:**
- Database: `src/db/schema.ts`, `src/db/client.ts`
- Analytics: `src/analytics/` directory
- Web App: `src/web/app.tsx` (single file containing all routes)
- Existing simple chart exists, but needs complete dashboard

## Privacy Constraints (CRITICAL - Never Violate)

This project has STRICT privacy requirements:
1. **No per-address analytics** - Only aggregate metrics
2. **No deanonymization attempts** - Never correlate deposits/withdrawals
3. **No identity enrichment** - Only token metadata allowed
4. **Aggregate metrics only** - No individual relayer histories

## My Task: Build Data Visualization Dashboard

I need to implement a comprehensive `/charts` page with multiple visualizations showing:
- Daily token flows (deposits, withdrawals, net flows)
- Relayer concentration metrics over time
- Token volume comparisons
- Trend analysis and growth metrics

---

## Step-by-Step Development Process

### Phase 1: Database Assessment & Data Exploration

**Objective:** Understand what data we have and how it's structured.

**Tasks:**
1. **Examine the database schema:**
   - Open and review `src/db/schema.ts`
   - Document all table structures:
     - Table names
     - Column names and types
     - Relationships
     - Indexes and constraints
   
2. **Analyze existing analytics:**
   - Review `src/analytics/dailyFlows.ts`
   - Review `src/analytics/relayerStats.ts`
   - Understand what computations are already done
   - Identify output table structures

3. **Explore the raw seeded data:**
   - Query the database to understand data ranges (date ranges, tokens, volumes)
   - Check data quality and completeness
   - Identify any gaps or anomalies
   - Sample the data to understand distributions
   - Create a summary of available data:
     - Date range of events
     - Number of unique tokens
     - Number of daily records
     - Typical data volumes

4. **Assess data readiness for visualization:**
   - Determine if current aggregate tables (`daily_flows`, `relayer_stats_daily`) are sufficient
   - Identify any missing aggregations needed for planned charts
   - Consider query performance implications

**Deliverable:** A clear summary document/comment block describing:
- Available tables and their structures
- Date ranges and data coverage
- Any data quality observations
- Whether new schemas/aggregations are needed

**Checkpoint:** Pause and present findings before proceeding to Phase 2.

---

### Phase 2: Architecture Planning & Schema Design (if needed)

**Objective:** Design the data layer for efficient chart rendering.

**Tasks:**
1. **Review Phase 1 findings** and determine requirements:
   - Can we use existing tables as-is?
   - Do we need new aggregate tables/views?
   - Are there complex computations needed?

2. **If new schemas are needed:**
   - Design following existing Drizzle ORM patterns:
     - Integer autoincrement primary keys
     - Store large amounts as text (for bigint compatibility)
     - Proper indexing for query performance
     - Maintain privacy constraints in design
   - Update `src/db/schema.ts` with new table definitions
   - Create and run migrations via `bun run db:generate` and `bun run db:migrate`

3. **If new analytics are needed:**
   - Design new analytics modules in `src/analytics/`
   - Follow existing patterns from `dailyFlows.ts` and `relayerStats.ts`
   - Keep functions modular and focused
   - Ensure proper TypeScript typing
   - Apply privacy filters appropriately

4. **Plan the data flow:**
   - Database → Data fetching layer → Charts
   - Define clear interfaces at each boundary
   - Consider caching strategies if needed

**Deliverable:** 
- Updated schema (if needed)
- New analytics modules (if needed)
- Clear architecture diagram/description of data flow

**Checkpoint:** Present architecture plan for approval before implementation.

---

### Phase 3: Data Access Layer Implementation

**Objective:** Create clean, typed functions to fetch chart data.

**Tasks:**
1. **Create chart data module:**
   - Create `src/analytics/chartData.ts` (or similar logical location)
   - One function per chart/visualization type
   
2. **Each data fetching function should:**
   - Have a clear, descriptive name (e.g., `getDailyTokenFlows`, `getRelayerConcentrationTimeSeries`)
   - Accept typed parameters (e.g., date ranges, token filters)
   - Return properly typed data structures (define interfaces)
   - Use Drizzle ORM queries efficiently
   - Include JSDoc comments explaining purpose and return structure
   - Handle edge cases (empty data, missing dates, etc.)

3. **Define TypeScript interfaces:**
   - Create interfaces for all chart data structures
   - Example: `interface DailyFlowData { date: string; deposits: number; withdrawals: number; netFlow: number; }`
   - Keep interfaces in the same file or a separate `types.ts`

4. **Optimize queries:**
   - Use proper SQL for aggregations
   - Leverage indexes
   - Avoid N+1 query problems
   - Test query performance with actual seeded data

**Deliverable:**
- Complete `src/analytics/chartData.ts` with all data fetching functions
- Full TypeScript typing for all data structures
- Each function tested and verified to return correct data

**Checkpoint:** Test each data fetching function independently before moving to Phase 4.

---

### Phase 4: Chart.js Integration & Component Setup

**Objective:** Set up Chart.js for SSR and create reusable chart rendering logic.

**Tasks:**
1. **Install Chart.js:**
   - Run: `bun add chart.js`
   - Research and install SSR-compatible Chart.js adapter if needed
   - Consider: `chart.js-node-canvas` or similar for server-side rendering

2. **Create chart rendering utilities:**
   - Create `src/web/chartUtils.ts` or `src/web/charts/` directory
   - Build helper functions to:
     - Convert data to Chart.js format
     - Generate chart configurations
     - Handle chart options (colors, labels, responsive settings)

3. **Design chart components pattern:**
   - Since we're using SSR with Hono JSX, determine approach:
     - Option A: Generate static chart images server-side
     - Option B: Render canvas with client-side hydration (minimal JS)
     - Choose the approach that best fits SSR constraints
   
4. **Create base chart component structure:**
   - Keep components functional and typed
   - Follow existing Hono JSX patterns from `app.tsx`
   - Ensure proper HTML structure for accessibility

**Deliverable:**
- Chart.js properly integrated and tested
- Chart utility functions created
- Base component pattern established
- Example chart rendered successfully

**Checkpoint:** Render at least one test chart before building the full dashboard.

---

### Phase 5: Charts Page Implementation

**Objective:** Build the complete `/charts` route with all visualizations.

**Tasks:**
1. **Create the Charts page route handler in `app.tsx`:**
```typescript
   app.get('/charts', async (c) => {
     // Fetch all chart data
     // Render charts page
   })
```

2. **Fetch all necessary data:**
   - Call all data fetching functions from Phase 3
   - Handle any errors gracefully
   - Consider parallel fetching for performance

3. **Build the Charts page layout:**
   - Create clear sections for different metric categories:
     - Token Flow Analytics
     - Relayer Concentration Metrics
     - Volume Comparisons
     - Trend Analysis
   - Use semantic HTML structure
   - Implement responsive design (CSS Grid/Flexbox)
   - Follow existing styling patterns from other pages

4. **Render individual charts:**
   - One chart per key metric
   - Clear titles and labels for each chart
   - Proper legends and axis labels
   - Consistent color scheme across charts
   - Consider adding brief descriptions for context

5. **Add navigation:**
   - Ensure the Charts page is accessible from main navigation
   - Add breadcrumbs or back links if applicable

**Deliverable:**
- Complete `/charts` route in `app.tsx`
- Fully functional dashboard with multiple charts
- Clean, readable code with proper TypeScript typing
- Responsive layout

**Checkpoint:** Test the complete page in development mode (`bun run dev`).

---

### Phase 6: Code Quality, Testing & Documentation

**Objective:** Ensure production-ready, maintainable code.

**Tasks:**
1. **Code review checklist:**
   - [ ] All TypeScript types are explicit (no `any`)
   - [ ] All functions have clear, single responsibilities
   - [ ] Privacy constraints are maintained (no per-address analytics)
   - [ ] Error handling is implemented
   - [ ] Code follows existing project conventions
   - [ ] No unused imports or dead code

2. **Testing:**
   - Run `bun run dev` and verify:
     - All charts render correctly
     - Data is accurate
     - No console errors
     - Page loads in reasonable time
     - Responsive design works
   - Test with different data scenarios (if possible)

3. **Documentation:**
   - Add JSDoc comments to all public functions
   - Update README.md if needed:
     - Add `/charts` to API endpoints table
     - Document any new scripts
   - Add inline comments for complex logic
   - Document any Chart.js configuration choices

4. **Performance check:**
   - Verify query performance is acceptable
   - Check page load time
   - Optimize if necessary

**Deliverable:**
- Clean, well-documented, production-ready code
- All tests passing
- Updated documentation

---

## Code Quality Standards

### TypeScript
- **Strict typing:** No `any`, explicit types for all functions and data structures
- **Interfaces:** Define clear interfaces for all chart data
- **Documentation:** JSDoc comments for public functions

### Drizzle ORM
- Use tagged template literals (`sql`) for complex queries
- Proper handling of bigint ↔ string conversions
- Follow existing schema conventions (integer PKs, text for big numbers)

### Hono + JSX
- **Server-side rendering only** - no client-side JavaScript frameworks
- Keep components functional and focused
- Use consistent patterns from existing `app.tsx` code
- Follow existing `jsxRenderer` usage

### Chart.js
- Generate configurations programmatically
- Use consistent color schemes
- Ensure charts are readable and accessible
- Optimize for SSR performance

### Modularity
- **Separation of concerns:** Data fetching ≠ computation ≠ presentation
- **Reusable utilities:** Extract common chart logic
- **Clear file organization:** Follow project structure
- **Single responsibility:** Each function does one thing well

---

## Important Reminders

1. **Work incrementally** - Complete and test each phase before moving to the next
2. **Check existing code first** - Don't recreate what already exists
3. **Stay modular** - Small, focused, reusable components
4. **Privacy first** - When in doubt about privacy, ask before implementing
5. **Type everything** - Explicit TypeScript types throughout
6. **Follow patterns** - Match existing code style and structure
7. **Verify against code, not docs** - README/CLAUDE.md may be outdated
8. **Test frequently** - Don't wait until the end to test

---

## Expected Questions & Clarifications

Before starting implementation, please:

1. **Confirm the JSON file location and structure**
2. **Ask about specific chart types** if unclear from context
3. **Verify SSR approach for Chart.js** (images vs. canvas with hydration)
4. **Clarify any ambiguous requirements** before coding
5. **Propose architecture** before implementing complex features

---

## Process Flow
```
Phase 1: Database Assessment (MUST COMPLETE FIRST)
   ↓ [Checkpoint: Present findings]
Phase 2: Architecture Planning
   ↓ [Checkpoint: Get approval]
Phase 3: Data Access Layer
   ↓ [Checkpoint: Test all functions]
Phase 4: Chart.js Setup
   ↓ [Checkpoint: Render test chart]
Phase 5: Complete Dashboard
   ↓ [Checkpoint: Full testing]
Phase 6: Quality & Documentation
   ↓ [Done: Production-ready feature]
```

**At each checkpoint, pause and wait for confirmation before proceeding.**

---

## Success Criteria

The charts feature is complete when:
- ✅ Database is properly seeded and verified
- ✅ All chart data fetching functions work correctly
- ✅ Chart.js renders charts successfully in SSR mode
- ✅ `/charts` page displays all planned visualizations
- ✅ All code is properly typed with TypeScript
- ✅ Privacy constraints are maintained
- ✅ Code is clean, modular, and well-documented
- ✅ Page loads efficiently with good performance
- ✅ Charts are accurate, readable, and visually clear

Let's build this step-by-step with clean, maintainable code!