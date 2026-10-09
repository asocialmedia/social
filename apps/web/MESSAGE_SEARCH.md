# DM search cutover

The web thread uses server search and a bounded saved-history cache. Opening search or shared content never starts a device archive-indexing walk. Legacy derived search stores are cleared transactionally without reading their contents; identity and recovery storage remain separate.

Set `NEXT_PUBLIC_MESSAGE_SEARCH_SERVER=1` when building the web app to enable full-history server requests. Public Next.js settings are embedded at build time. Leaving this setting disabled keeps search on saved history; it does not restore archive indexing. The server's `MESSAGE_SEARCH_SERVER_ENABLED=0` switch can disable server requests independently, causing an honest saved-history fallback. Worker backfill and counts have separate switches described in [the worker runbook](../auth/MESSAGE_SEARCH_WORKER.md).

Offline searches use saved history. A transient online service failure can also fall back to saved history, with that scope named in the search bar. Access denials never fall back. Unavailable local storage produces a retryable failure. Reconnecting starts a fresh server search; query, account, recovery, and permission changes discard obsolete responses and boundaries.

Search pages use signed forward and reverse keysets within one snapshot. The client retains at most three hydrated pages, or sixty result messages, and refetches evicted pages from adjacent boundaries. Exact-count tokens remain scoped to their original search even after the first page is evicted. Saved-history queries and decryption run in the worker; cached message revisions and the main-thread revision signatures are bounded separately.

The hook integration suite uses a DOM emulator and mocked network boundaries, alongside the real IndexedDB worker and PostgreSQL integration suites. It does not launch a browser. Full-scale concurrent load, physical-device performance, and the final seeded-DM browser acceptance remain release gates; these unit and integration checks do not establish those performance targets.
