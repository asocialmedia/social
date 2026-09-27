// The numbers search is held to, in one place.
//
// Why this file exists: search had budgets scattered through test files and
// comments, which is how a "passing" suite can mean nothing -- every assertion
// was written next to the code that motivated it, with whatever number that code
// happened to be doing. These are declared, named, and split by WHERE they are
// measured, because the difference is the whole point:
//
//   - REFERENCE budgets are for the in-memory backend under `bun test`. They are
//     regression fences: cheap to run, deterministic, and they catch an
//     algorithmic change (a quadratic pass, a scan that crept in) long before
//     anyone opens a browser.
//   - BROWSER budgets are for the IndexedDB backend, and they are only
//     meaningful measured in a real browser. `fake-indexeddb` has no write lock,
//     no real cost per request, and no structured-clone cost, so a test against
//     it can pass while production is 5x slower. Nothing in `bun test` asserts
//     these; `scripts/bench-index-against-seed.ts` and a manual browser pass are
//     where they are checked.
//
// A budget that is not measured is a wish. Every number here is either a
// measurement from the 200k fixture, or a multiple of one, and the measurement
// is written next to it so the next person can tell whether it is still true.
//
// The BROWSER budgets cannot be checked by any test in this repo: there is no
// browser automation here, and `fake-indexeddb` and the in-memory path both lack
// the write lock and the structured-clone cost that dominate in a real browser.
// Asserting them against either would be asserting a fiction. The procedure is
// `SEARCH-ACCEPTANCE.md`, beside this file.

// ---- reference (bun test, in-memory backend) --------------------------------

// A keystroke query against the in-memory backend, 150ms debounce included in
// the caller's budget. The 20k-row synthetic index measures well under this; the
// 200k fixture's in-memory path is the honest upper bound.
export const REFERENCE_QUERY_SLO_MS = 100;

// Adding one message to a 20k-row index. This is the "a single insert does not
// scale with the size of the index" fence: a posting-list copy-on-write or a
// dictionary rewrite shows up here immediately.
export const REFERENCE_APPEND_SLO_MS = 50;

// Growing a posting list in place. 10k appends; an implementation that copies per
// add instead of doubling measured at 1,679 msgs/s against 20,700 for this one.
export const REFERENCE_PUBLIST_GROWTH_SLO_MS = 250;

// How much slower a query may be on a 10x conversation. Not an absolute: the
// point is that cost tracks the posting lists and the result cap, not row count.
export const REFERENCE_QUERY_SCALING_FACTOR = 4;

// ---- browser (IndexedDB, real device) ---------------------------------------

// One list page turn, i.e. one `query` at SEARCH_PAGE_SIZE. Measured 178-452ms
// on the 200k fixture while a backfill was committing, and 81-164ms on a settled
// index. The budget covers the contended case, because the contended case is the
// one a user hits on a fresh device.
export const BROWSER_PAGE_TURN_SLO_MS = 500;

// A search jump onto a match the transcript already holds: one decrypt and one
// scroll. The anchored path adds a network read, and is bounded by the jump's own
// timeouts rather than by this.
export const BROWSER_JUMP_SLO_MS = 1500;

// Indexing throughput the backfill is designed around, from the write-path
// benchmarks: 20,700 msgs/s is the append-in-place number, and 11,338 msgs/s the
// one with an unconditional duplicate scan. Anything near the floor means a scan
// crept back into the hot path.
export const REFERENCE_WRITE_FLOOR_MSGS_PER_SECOND = 10_000;

// ---- storage ----------------------------------------------------------------

// Bytes per row the eviction policy assumes, from the measurement that constant
// was derived from (format 6, 200k fixture: 17.6MiB).
//
// KNOWN STALE. Format 7 adds one float per posting entry, and the 200k fixture
// holds on the order of two million postings, so the real cost is materially
// higher -- the index is a larger share of a phone's per-origin budget than this
// constant claims. The direction of the error is safe (the budget evicts sooner
// than it needs to, costing a re-walk rather than a quota failure) and the
// magnitude is not. Re-measure before trusting either number.
export const STALE_BYTES_PER_ROW = 92;

// Format 7's projected size for the 200k fixture. AN ESTIMATE, NOT A MEASUREMENT
// -- it is posted here so the browser bench has something to check itself
// against, and so nobody re-derives it from a comment. Run
// `bun run bench:search -- --conversation=<id>` against a real IndexedDB and
// replace this with what it says.
export const ESTIMATED_INDEX_BYTES_PER_200K_ROWS = 39 * 1024 * 1024;

// Headroom the estimate is allowed before it is treated as a regression rather
// than as arithmetic error. Generous, because structured-clone overhead for
// typed arrays varies by engine.
export const STORAGE_ESTIMATE_TOLERANCE = 1.5;
