# Unified message search review — 2026-10-18

The initial implementation needed changes to interaction, recovery, resource limits, and database performance. This pass fixes those findings. Production device and browser acceptance remain separate from the automated evidence below.

## Interaction and presentation

- One search field retains profiles above messages, with five profiles initially and an expansion control for the remaining bounded response. A shortcut moves directly to messages.
- Filter and outside clicks preserve the query. Clear and Escape explicitly reset it and return focus to the input. Failed conversation creation preserves the query.
- Search and clear controls have 44 px touch targets. Profile rows are more compact; message snippets use two lines. The shared input primitive follows the app theme.
- Arrow keys, Home, and End navigate enabled results across both sections. Disabled profiles are skipped. Loading respects reduced motion.
- Failed page requests preserve loaded results and retry that continuation. Expired sessions restart the search. Mobile restoration includes the filter and expanded profile state, and initialization is safe to repeat.

## Runtime bounds and freshness

Both searches have a 250 ms debounce, cancellation, a 12-second request/body deadline, bounded response reads, offline feedback, and Retry-After recovery. Profile rows are validated before rendering. Global requests use the shared bounded request-body parser.

The client retains at most 60 message hits. Expiry schedules subsequent deadlines and invalidates expired previews. Source revisions invalidate cached previews, cross-tab notices immediately remove affected hits, and automatic refreshes are coalesced and throttled. Foreground/reconnect events reconcile missed changes. Conversation previews, threads, and global search use the same account/recovery cache scope, avoiding discarded previews during navigation.

An atomic Redis script retains at most four manifests per account, purges expired fields, and maintains a 15-minute TTL. Concurrent writes cannot bypass the cap. The v2 storage namespace makes earlier continuations restart safely.

The database uses a selective term seed, computes readable epochs per scope, and preserves ordered document streams. Eligibility is checked before limiting each conversation to a page, then merging the global page. Display details are loaded for that bounded page. An 8-second transaction-local statement deadline bounds query execution. No schema change or migration was needed.

## Local measurements

Measured on the existing local fixture account with four DM scopes, including the previously seeded 200k-message conversation. Account coverage was incomplete. These are database reader timings, excluding network, rendering, and decryption.

| Check | Result |
| --- | --- |
| Matching query before optimization, warm samples | 1,373–1,759 ms |
| Matching query after optimization, warm samples | 56–68 ms |
| First sample after optimization | 93 ms |
| 50 simultaneous reader calls, p50 / p95 / maximum | 376 / 578 / 596 ms |
| Duration of that burst | 600 ms |
| Bounded responses in the burst | 50 of 50 returned 21 rows, including the pagination sentinel |

This burst includes pool queuing. It does not measure 50 complete browser users, concurrent indexing writes, production hardware, or other account sizes.

## Verification

Automated suites cover query cancellation and stale responses, account changes, consecutive expirations, cross-tab batching, reconnect throttling, continuation recovery, page retention, keyboard navigation, five-profile expansion, filter/outside clicks, failed profile opening, malformed responses, request/body deadlines, signed tokens, streamed byte budgets, Redis concurrency/TTL, and existing message/den clients.

Database integration covers global ordering and timestamp ties, cursor continuation, filtering before page limits, membership windows, forged viewers, stale membership sequences, source expiry/revision, mutations after the snapshot, blocks, whole-chat clears, readable key proofs, conversation-local fragment matching, hidden messages, and viewer-owned wraps.

The focused runs passed 184 tests. Monorepo type checking passed. Formatting and lint checks were scoped to changed files because the root `check` script rewrites the entire workspace.

Live visual acceptance could not be completed: the in-app browser inventory responds, but tab attachment and navigation time out. DOM interaction tests do not establish responsive layout, theme appearance, screen-reader behavior, or physical-device performance. Those checks remain unverified in this pass.

## References

The implementation follows the installed Prisma 8 query references and the [migration architecture](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md), plus current [React effect cleanup](https://react.dev/reference/react/useEffect), [Next.js route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route), [ioredis scripting](https://github.com/redis/ioredis#lua-scripting), and [PostgreSQL CTE materialization](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION) documentation.
