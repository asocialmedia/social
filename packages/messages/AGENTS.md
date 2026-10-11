# DM history and search

This file is the single DM-specific implementation and operations guide. It consolidates the former web search runbook, auth worker runbook, and implementation handoff. Repository-wide rules remain in the root `AGENTS.md`; Prisma-specific rules remain in `packages/db/AGENTS.md`.

## Scope and current status

The goal is full-history search for web direct messages with bounded device work, durable server indexing, honest coverage, and the existing server-recoverable encryption model. Dens share parts of the server infrastructure, so membership windows and key epochs must remain correct for dens as well.

As of 2026-10-10, the implementation is on branch `codex/daddys-dream` in PR #161, “Daddy's Dream”. The latest committed migration consolidation is `20261010T1135_converge_latest_dev_and_dm_search`: one deployment edge from the incoming `dev` contract `c2b37d44…` to the merged contract `bead356b…`. The migration history was consolidated only after the user confirmed it had not been applied to production. Do not repeat or extend that history rewrite without verifying every shared environment's migration marker.

The code is substantially implemented but is not production-release certified. Local PostgreSQL scale evidence and the seeded 200k-message browser acceptance are recorded in `../../audits/dm-production-verification-2026-10-10.md`. The UX review and prior scale runs are in `../../audits/`. Those reports are historical evidence; check their dates and scope before repeating their claims. Physical-device performance, deployed canary/rollback behavior, production indexing lag, and alert routing remain release gates.

## Product contract

- Online search covers the conversation's readable history. Offline search covers only history saved on that device, and names that scope.
- Matching is case- and accent-insensitive literal fragments inside words, URLs, punctuation, emoji, and multilingual text, including scripts without spaces. Every query fragment must match.
- Keep the two-character minimum and 256 Unicode code-point maximum. Long message tokens are split into 512-code-point chunks with 255-code-point overlap.
- Results are newest-first with stable `(createdAt, id)` keysets, signed cursors, and a pinned search snapshot. Never use offsets or sort an unbounded candidate set in JavaScript.
- Return useful hits before exact totals. An exact count is separate, lower-priority work; never present a partial count as exact. A pagination sentinel is not a result count.
- Search documents may contain normalized terms and message references, but never plaintext bodies or previews. Terms, queries, keys, and source text must not enter logs or telemetry.
- Hydrate only selected hit ciphertext, decrypt on the device, and build snippets/highlights there. Search authorization must be rechecked against current source revision, membership, hide/delete state, and the viewer's own readable epoch before returning or hydrating results.
- Keep the existing conversation UX. Do not expose indexing counters, quotas, or manual archive-index controls. “No matching messages” is valid only when the declared scope is complete; service failures need retry/offline scope states rather than false empty results.

## Encryption and recovery invariants

Messages use **server-recoverable encryption, not end-to-end encryption**. A database reader with access to the stored identity row can recover message keys by design. Do not describe this as end-to-end encryption or change recovery semantics without preserving all invariants below.

1. A fresh device with no local storage and no user input automatically recovers from the stored identity row. The persisted random seed hash and identity salt derive the backup key using PBKDF2.
2. Keep the legacy device-secret attempt in `unlockIdentity` so older verifier rows remain usable. Do not add user-facing secrets, passkeys, or PRF credentials.
3. A legacy backup that unlocks is refreshed into the current recoverable format using the same identity keypair and conversation wraps. Validate that the private key matches the stored public key and compare-and-swap against concurrent reset/refresh.
4. Lost-key behavior degrades through the disclosed, self-scoped reset. Never reset automatically to finish indexing.
5. Resetting one account makes its old epochs unreadable to that account while retaining the peer's old wraps/history. Rotate conversation-key versions; never overwrite another member's wrap.
6. Historical epochs are determined by successful authenticated decryption, not timestamps. New clients may attach validated optional epoch metadata; older clients remain compatible.

Key changes are guarded by tests in `apps/web/src/lib/messages/crypto.test.ts` and `recovery-invariants.test.ts`. Preserve them and add targeted coverage for any recovery change.

## Architecture and important code

`packages/messages` is the browser-safe shared contract. Import it through workspace subpaths such as `@asm/messages/crypto`, `@asm/messages/normalization`, and `@asm/messages/search`; do not make browser imports pull in database or server code. Keep shared normalization/matching fixtures identical between server indexing and the offline worker.

Server persistence, authorization, indexing, and queue code lives primarily in:

- `packages/db/src/messages/search-index.ts`, `epoch-readability.ts`, `visibility.ts`, and `prebuild-indexes.ts`
- `packages/db/queue.ts` and `packages/db/index.ts`
- `packages/db/prisma/contract.prisma`
- `apps/web/src/lib/messages/server.ts` and `reader-window.ts`
- `apps/auth/src/worker/message-search-index.ts`, `message-search-count.ts`, `message-search-sweep.ts`, `message-search-metrics.ts`, `worker-health.ts`, and `worker-lifecycle.ts`

The schema contains durable changes/outbox, search terms/documents/references, coverage/gaps, recovery generations, epoch readability, and unread state. The database is the source of pending indexing work. Redis/BullMQ jobs are delivery hints; retain outbox rows until the indexing transaction commits so Redis loss cannot lose work. Index document, terms, references, and completion state atomically. Jobs must be idempotent under retry, duplicate delivery, crashes, and out-of-order revisions. Older work cannot overwrite a newer revision or resurrect deletion.

PostgreSQL candidate expansion uses Unicode 1/2/3-character grams and literal fragment verification. Keep expansion inside SQL; short fragments and punctuation cannot depend on trigrams alone. Search ordering uses `(conversationId, createdAt, id)` indexes. Verify query plans with `EXPLAIN (ANALYZE, BUFFERS)` when changing candidate SQL.

The dedicated worker is the `message-search-worker` target in `apps/auth/Dockerfile`; it is not a separate app. Initial capacity is two live-index slots, one backfill slot, and one count slot. Database batches are capped at 100 messages and 1 MiB ciphertext. Key caches are bounded and expire after five minutes. Failures use exponential retries with jitter, then durable repair backlog/alerts. Keep live work isolated from backfill and exact-count load.

The worker health probe is `./asm-worker --health-check`. It requires a fresh process-owned heartbeat, the owner process to exist, configured queues to be ready, and successful Redis heartbeat publication. The heartbeat file defaults to `/tmp/asm-message-search-worker-health.json`; never share the file between replicas. Shutdown drains active jobs/resources within `WORKER_SHUTDOWN_TIMEOUT_MS` (default 30 seconds, allowed 1–120000 ms); the platform termination grace period must be longer.

## APIs and client bounds

Conversation-scoped APIs are under `apps/web/src/app/api/messages/conversations/[id]`:

| Endpoint | Contract |
| --- | --- |
| `POST /search` | Up to 20 hits, stable cursor/snapshot, coverage, optional count token |
| `POST /search/count` | Pending, exact, or unavailable for a scoped count token |
| `GET /shared` | Cursor-paginated media, post, and link references |
| `POST /messages/batch` | Authorized ciphertext hydration for at most 20 IDs and 1 MiB |
| `GET /changes` | Bounded durable replay; tells the client when to reset an expired cache |

Keep `/api/messages/search` as the existing people-search endpoint. Signed cursor scope includes account, conversation, query hash, normalization version, snapshot sequence, membership/permission scope, and recovery generation. A source edit, hide, delete, membership change, or recovery change must invalidate affected results promptly.

Client orchestration is in `apps/web/src/components/messages` and `apps/web/src/lib/messages`. The thread uses a bidirectional rolling window capped at 800 messages or 8 MiB ciphertext. History responses are capped at 100 rows and 1 MiB. Preserve the viewport anchor by message ID and pixel offset through prepend, trim, and measurement; keep live-tail state separate while reading older history.

The shared-content viewer has its own cursor window capped at 100 references and at most two neighboring media assets prefetched. Search retains at most three hydrated pages/60 hits and refetches evicted pages from adjacent signed boundaries. Keep counts scoped even if the original page is evicted.

Offline matching, cache indexing, and non-visible decryption run in a Web Worker. Initial bounds are: decrypted payload cache 512 messages or 8 MiB; ordinary decrypt queue 128 entries; offline cache 1,000 messages per conversation and 32 MiB serialized across the active account; worker batches at most 32 messages or 256 KiB, yielding between batches. Cache ciphertext, normalized terms, revisions, and references, not full plaintext bodies or previews. Account/recovery scope changes must cancel requests/workers/subscriptions and purge the previous account's derived cache without touching identity recovery storage. Quota/origin eviction must fail honestly and recoverably.

Legacy IndexedDB archive indexing remains only as bounded rollout compatibility where needed. Do not rebuild or retain a second complete device archive index. The current thread path must not start a full-archive walk.

## Feature switches and operating behavior

| Setting | Effect |
| --- | --- |
| `NEXT_PUBLIC_MESSAGE_SEARCH_SERVER=1` | Build-time web setting that enables server-history requests |
| `MESSAGE_SEARCH_SERVER_ENABLED=0` | Runtime API kill switch; client falls back to clearly named saved-history search |
| `MESSAGE_SEARCH_BACKFILL_ENABLED=0` | Pauses historical backfill; live indexing continues |
| `MESSAGE_SEARCH_COUNT_ENABLED=0` | Pauses exact-count work |
| `MESSAGE_SEARCH_WORKER_ENABLED=0` | Stops search queues in the general worker during dedicated-worker cutover |
| `MESSAGE_SEARCH_WORKER_ONLY=1` | Runs only search queues; set by the dedicated image target |
| `WORKER_HEALTH_PATH` | Process-local heartbeat file override |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | Worker drain deadline, 1–120000 ms |

Build the dedicated service from `apps/auth/Dockerfile` with target `message-search-worker`. Supply the normal database/Redis configuration pointing at the same services as the messaging API. Worker credentials can recover message keys and must remain server-side. Never delete durable outbox rows to clear a queue backlog.

On server service failure, return a retryable response or fall back to saved-history search with that scope named. Access denial must never fall back to stale local results. Disabling backfill or counts must not disable live indexing. Rollback preserves durable state and remains bounded; it does not re-enable archive-wide device indexing.

## Verification and release gates

The latest recorded local evidence is in `../../audits/dm-production-verification-2026-10-10.md`, `../../audits/dm-scale-2026-10-08.md`, and `../../audits/dm-search-ux-audit-2026-10-10.md`. The production verification reports 20 conversations × 200k messages and one 1M-message conversation exercised locally, plus a browser-created 200k-message DM acceptance. The 20 × 100k run was not repeated. These results do not prove production capacity, mobile performance, or deployed rollout safety.

Before release, prove the remaining gates with recorded environments and measurements:

- Run relevant unit/integration/browser suites, `bun run check`, and `bun run check-types`. Do not count skipped service-backed tests as passing.
- Test correctness for short fragments, URLs, punctuation, emoji, accents, non-space scripts, long-token boundaries, tied timestamps, live arrivals, edits, hides, deletes, den leave/rejoin, reset epochs, corrupted/unavailable wraps, duplicate/stale jobs, Redis loss, offline mutation, quota eviction, multiple tabs, account changes, unread races, and long bidirectional scroll/media navigation.
- Exercise 20×100k, 20×200k, and 1×1M fixtures with broad/rare multilingual queries, media, hidden rows, unread backlogs, and multiple epochs. Run 50 concurrent searches during live writes/backfill. Capture query plans, index size, write amplification, worker memory/throughput, queue age, and indexing lag.
- Validate on a physical 4 GB Android device at 60 Hz and an iPhone/Safari reference. Record device/OS/browser and a 100 ms RTT / 10 Mbps reference network.
- Initial targets: typing input-to-paint p95 <50 ms; warm offline search p95 <100 ms; online first results p95 <300 ms; offline/online jumps p95 <500 ms / 1.5 s; anchor drift ≤2 CSS px; additional DM working memory <64 MiB; live indexing lag p95 <2 s and p99 <10 s; no retained-resource growth after 100 conversation switches.
- Validate internal shadow recall/authorization, heavy-user canaries, alerts, saturation behavior, kill switches, and rollback before progressively widening rollout. Only claim full-history coverage after viewer-readable history is verified.

Never log raw queries, message text, normalized terms, keys, SQL/source exception details, or job payloads. Track latency, frame cadence, memory, indexing lag, coverage gaps, retry outcomes, count backlog, and reconciliation failures using bounded/sanitized metrics.

## Working rules for message changes

- Follow root `AGENTS.md` and `packages/db/AGENTS.md`; use Bun, workspace imports, no `as any`, and add focused tests for behavior changes.
- Database changes are Prisma 8 contract-first. Read the Prisma 8 migration architecture linked from `packages/db/AGENTS.md`, generate artifacts through the repository workflow, review migration operations and origin, preserve hashes/refs, and verify the schema. Do not hand-edit generated snapshots or ops metadata.
- Keep browser-safe shared contracts separate from database/server modules. Preserve membership windows, authorization-before-pagination/counts, and the viewer's own recovery scope.
- Prefer one focused regression test for each discovered failure. Run the narrow test first, then required repository checks after edits; avoid repeating large scale runs without a changed query, fixture, or unresolved failure.
- Do not start browser testing before the implementation work is complete. The final browser acceptance requested for this work is a new DM seeded with 200,000 messages.
- Commit only reviewed, relevant changes using repository style, for example `fix[MESSAGES]: ...`, `test[MESSAGES]: ...`, or `docs[MESSAGES]: ...`.
