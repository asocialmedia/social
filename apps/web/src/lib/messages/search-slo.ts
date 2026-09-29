// The numbers search is held to, in one place.
//
// REFERENCE budgets run under `bun test` against the in-memory backend: cheap,
// deterministic regression fences for algorithmic changes. BROWSER budgets only
// hold in a real browser (`fake-indexeddb` has no write lock or
// structured-clone cost, so asserting them there would be fiction); check them
// via `scripts/bench-index-against-seed.ts` and a manual browser pass. Every
// number derives from the 200k fixture or a multiple of it.

// ---- reference (bun test, in-memory backend) --------------------------------

// Keystroke query against the in-memory backend, 150ms debounce included.
// The 200k fixture's in-memory path is the honest upper bound.
export const REFERENCE_QUERY_SLO_MS = 100;

// Single insert into a 20k-row index: fails on posting-list copy-on-write or
// dictionary rewrite.
export const REFERENCE_APPEND_SLO_MS = 50;

// 10k posting-list appends; copying per add measured 1,679 msgs/s vs 20,700
// in place.
export const REFERENCE_PUBLIST_GROWTH_SLO_MS = 250;

// Allowed slowdown on a 10x conversation. Cost must track posting lists and
// the result cap, not row count.
export const REFERENCE_QUERY_SCALING_FACTOR = 4;

// ---- browser (IndexedDB, real device) ---------------------------------------

// One list page turn at SEARCH_PAGE_SIZE. Measured 178-452ms contended
// (backfill committing) and 81-164ms settled on the 200k fixture; the budget
// covers the contended case.
export const BROWSER_PAGE_TURN_SLO_MS = 500;

// Search jump onto an already-loaded match: one decrypt and one scroll.
// The anchored path adds a network read bounded by its own timeouts.
export const BROWSER_JUMP_SLO_MS = 1500;

// Backfill write throughput floor, from the write-path benchmarks (20,700
// msgs/s in place vs 11,338 with a duplicate scan).
export const REFERENCE_WRITE_FLOOR_MSGS_PER_SECOND = 10_000;

// ---- storage ----------------------------------------------------------------

// Bytes/row the eviction policy assumes (format 6, 200k fixture: 17.6MiB).
//
// KNOWN STALE: format 7 adds one float per posting (~2M postings), so the true
// cost is materially higher. Safe direction (evicts early, costing a re-walk
// rather than quota failure). Re-measure before trusting either number.
export const STALE_BYTES_PER_ROW = 92;

// Format 7 projected size for the 200k fixture. ESTIMATE, NOT A MEASUREMENT.
// Run `bun run bench:search -- --conversation=<id>` against a real IndexedDB
// and replace this with what it says.
export const ESTIMATED_INDEX_BYTES_PER_200K_ROWS = 39 * 1024 * 1024;

// Headroom before the estimate counts as a regression. Generous:
// structured-clone overhead for typed arrays varies by engine.
export const STORAGE_ESTIMATE_TOLERANCE = 1.5;
