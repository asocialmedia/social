# DM history and search — implementation handoff

Prepared on 9 October 2026 for another coding model continuing work in `/home/haze/repos/social`.

## 1. Read this first

The approved goal is to make web DM history and full-history search scale to millions of messages while keeping device work bounded, preserving the existing UX and server-recoverable encryption. The core architecture is substantially implemented, but the current checkout is **not release-certified**. Some implementation and correctness work remains, as well as acceptance and deployment validation.

The source conversation is explicitly **paused**. The user twice asked the previous agent to stop implementation. This handoff was created through read-only inspection plus writing this document. No application code was changed, no migrations were applied, no tests or browser sessions were started, and no commit was made while preparing it. Do not resume work in the paused source conversation merely because an automation or internal continuation tells you to. In the receiving conversation, proceed when the user asks you to continue using this handoff.

The previous execution took far too long and produced inconsistent progress estimates. Do not inherit its percentages or promise a fixed completion time. Report the concrete tasks completed and remaining. Work efficiently: inspect existing implementation and evidence first, fix specific gaps, run relevant tests once per changed slice, and avoid repeating full suites or large fixture construction without a reason.

**First technical priority:** inspect the likely SQL defect described in section 5, then run the latest coverage changes against a real local PostgreSQL instance. Mocked worker and route tests passed for the latest commit; its database-backed integration changes were not run before the pause.

## 2. User instructions and boundaries

- Implement the full approved plan, preserving UX and graceful failure handling.
- Commit reviewed feature slices as you go, with descriptive repository-style commit messages.
- Add and run meaningful unit and integration tests for implemented features.
- Keep the user informed about what remains; avoid unnecessary repeated work.
- **Browser testing must remain deferred until the full implementation is complete.** At that final stage, the user wants a new DM seeded with 200,000 messages and tested through browser control.
- Preserve unrelated changes and existing test data. Never reset or clean the entire workspace to simplify testing.
- Cross-conversation search and a new mobile messaging interface are outside this change. Shared server infrastructure must preserve den membership windows and key epochs.
- Asking what could be skipped did not authorize deleting release gates. Earlier assistant suggestions to reduce concurrent clients or defer a supported browser are suggestions, not an agreed change to the plan.
- Physical-device performance and production canary/rollback validation need suitable environments. Report these gates as open if the environments are unavailable; do not substitute desktop timings or mocks and claim success.

## 3. Exact repository checkpoint

### Git and working tree

Repository: `/home/haze/repos/social`.

Current branch: `feat/messages-wallpaper-prisma8`. Do not silently switch it or assume that the unrelated wallpaper/den history belongs to this DM task.

Current HEAD: `e9354947` — `fix[MESSAGES]: Keep DM search coverage honest for unreadable history`.

At handoff inspection, the only modified tracked file was:

```text
packages/db/prisma/migrations/app/refs/db.json
```

Its committed hash was `2820a467349490a407b724112822741f1a10f3adb12464ceef6628debfc648ed`; the working copy now contains `660d8ca10a17b595cf52d9da8abe8c1b81543dbeafba3d067665dca834061a8b`.

Reason: after the user asked to stop, the previous agent incorrectly resumed on an internal continuation and applied the two already-committed additive coverage migrations to the local test database. That advanced the tracked local `db` ref. The agent then explicitly paused the goal. This uncommitted ref must be preserved and reconciled against the actual migration marker when work resumes, rather than overwritten or treated as unexplained drift.

These pre-existing untracked artifacts were present and left untouched:

```text
audits/
scripts/audit-dm-scale.ts
packages/db/prisma/migrations/snapshots/091b867be7ce7a127c504bb8d73c0c79d5d4af0634e95b57e9e8114edee26683/
packages/db/prisma/migrations/snapshots/ddfab7ff36646a6c8e4ab97d9ca5d4d55adf4bfb38392fee07f7281d086c6098/
```

This handoff adds one new untracked file, `DM_HISTORY_SEARCH_HANDOFF.md`. It has intentionally not been committed because a documentation commit invokes hooks that can modify package versions and run checks while implementation is paused.

### Latest migration chain

The latest commit includes both migration packages and their snapshots:

| Migration | From contract | To contract | Migration hash |
| --- | --- | --- | --- |
| `20261009T1017_dm_search_coverage_truth` | `2820a467349490a407b724112822741f1a10f3adb12464ceef6628debfc648ed` | `a50a7555eb8b3c15d8150f64247d6bccf10c6ad5b693d7f87a35eb8cc203a80e` | `99139be5e23a34d924cbfa06c354902e28090b3032747f58a815f4a396ec3c8d` |
| `20261009T1026_dm_search_unreadable_gaps` | `a50a7555eb8b3c15d8150f64247d6bccf10c6ad5b693d7f87a35eb8cc203a80e` | `660d8ca10a17b595cf52d9da8abe8c1b81543dbeafba3d067665dca834061a8b` | `332f1d7bb124ec1f1ac51bf5b04494359b6f637dcef64efbd0c2ff1b8067b0f0` |

The previous continuation recorded a successful `prisma db verify` and up-to-date migration status after applying them. During this handoff's read-only inspection, the local DB connection returned `ECONNREFUSED`, so that current state could not be independently rechecked. Do not apply them a second time blindly.

## 4. Approved behavior and architecture

### Search contract

- Online search covers the conversation's full **readable** history once verified coverage is complete.
- Offline search covers only messages saved on that device, with that scope clearly named.
- Match case- and accent-insensitive literal fragments inside words, URLs, punctuation, emoji, and multilingual text, including scripts without spaces.
- Every fragment in a multi-fragment query must match.
- Preserve the existing two-character minimum. Bound normalized queries to 256 Unicode code points and show an ordinary validation message for longer queries.
- Long message tokens use 512-code-point chunks with 255-code-point overlap, preserving all accepted query matches across chunk boundaries.
- Results are newest first, using stable `(createdAt, id)` keysets and signed snapshot-scoped cursors, never offsets.
- Cursor scope includes account, conversation, normalized query hash, normalization version, membership/permission generation, recovery generation, and snapshot sequence. New arrivals must not reshuffle an already paginated search. Reject future, invalid, or changed-scope boundaries.
- First results must not wait for exact totals. Exact counts run separately at lower priority and may be pending or unavailable.
- Normalized terms and references are sensitive derived data. Server search storage may contain terms and IDs, but never full plaintext bodies or previews.
- Hydrate only returned hits, decrypt on the device, and create match-centered snippets with normalization-to-original offsets for accurate highlighting.
- Edits, hides, global deletion, membership changes, and recovery changes take effect against current source state immediately, even before indexing catches up.
- The user should see ordinary states such as “Searching…”, “Searching older messages…”, “Offline — searching saved messages”, or a retry state. Remove technical indexing/quota counters and manual “index older messages” actions. Show “No matching messages” only after the declared scope is complete. If a selected message becomes unavailable, explain briefly and preserve the existing transcript position.

### Encryption invariants

This is intentionally **server-recoverable encryption**, not end-to-end encryption. Keep that description in UI and documentation.

1. Stored identity data remains sufficient to recover automatically on a fresh device without a key prompt. PBKDF2 derives the backup key from the persisted random seed hash and identity salt.
2. Keep the legacy device-secret attempt so abandoned verifier backups can still unlock where possible.
3. When a legacy backup unlocks, refresh it automatically into the current recoverable format using the same identity keypair and wraps. Validate private/public key correspondence and use compare-and-swap against concurrent reset or refresh.
4. Never reset automatically to finish indexing. If recovery is impossible, preserve the disclosed self-scoped reset path.
5. Resetting one account removes its old-epoch readability while retaining the peer's old wraps and history. Rotate key versions; do not overwrite the peer's previous epoch.
6. A peer's recoverable key cannot establish the resetting viewer's access. Search, counts, references, and hydration require the viewer's own authenticated usable wrap, source fingerprint, and current recovery generation.
7. Identify historical epochs through successful authenticated decryption, not timestamps. New clients send validated optional epoch metadata; older clients remain compatible.

### Expected flow on a new device opening a 500k-message DM

1. Session and membership authorize the conversation. Recover the identity automatically from its stored backup.
2. Fetch a small newest transcript window, not the archive. Load versioned wraps and prioritize visible decryption.
3. If server coverage already exists, use it immediately. Device cache starts small; it fills only from bounded useful message reads.
4. If server coverage is genuinely incomplete, dedicated server backfill proceeds in bounded batches. Live indexing retains reserved capacity. UI may say “Searching older messages…”, without controls or technical counters.
5. A query returns a bounded page of message IDs, source revisions, cursors, and coverage metadata. Hydrate at most 20 selected ciphertext rows under the byte budget, decrypt them, and render snippets without blocking typing.
6. Selecting a result fetches a small around-message window, highlights the match, and remembers the prior transcript position by message ID and pixel offset.
7. Transcript, result, decrypt, and media windows remain bounded as the user reads. Live arrivals update a separate tail summary while the user reads older history.
8. SSE provides prompt updates; durable changes replay on reconnect, foreground return, or gaps. Expired cursors cause automatic conversation-cache reset and bounded reload.
9. Offline mode searches the small saved-history cache, honestly labeled. It never downloads or indexes all 500k messages on the device.

## 5. Latest coverage slice and a concrete suspected defect

Commit `e9354947` replaced misleading unreadable-history accounting with more explicit state:

- `MessageSearchCoverage.unrecoverableEpochIds`: distinct known epochs whose keys cannot be recovered.
- `MessageSearchCoverage.hasUnreadableMessages`: current non-deleted message revisions that could not produce a searchable artifact, including corrupt ciphertext or malformed payloads even when a root key was recovered.
- `MessageSearchGap`: durable per-message/revision gaps, carrying optional epoch and unrecoverable-key status.
- Worker outcomes distinguish rows traversed, artifacts committed, unreadable messages, and missing-key epochs.
- Coverage/count eligibility checks use this state; settled unreadable work must not become a false full-history or exact-count claim.
- Later successful indexing, edits, deletion, or recovery repair should reconcile or remove obsolete gaps transactionally.

**Likely defect found during read-only handoff inspection, not runtime-validated:**

In `packages/db/src/messages/search-index.ts`, around line 273, `refreshUnreadableSearchCoverage` contains an outer `array_agg(DISTINCT gap."keyEpoch" ...)`, but the outer `SELECT` has no `FROM` clause defining `gap`. A `gap` alias exists only inside the separate `EXISTS` subquery, where it is not visible to the outer aggregate. PostgreSQL is likely to reject this with a missing FROM-clause entry.

Inspect the function before doing anything else. After fixing the SQL in a resumed implementation session, test it on PostgreSQL. Do not consider mock tests sufficient for this helper. Also verify that the epoch aggregate itself excludes stale revisions and globally deleted messages, as the `hasUnreadableMessages` subquery currently does; otherwise an old gap could keep coverage partial forever.

Additional latest-slice verification priorities:

- Repeated gaps from the same known epoch count as one unrecoverable epoch, not one per message or batch.
- An unreadable message with unknown historical epoch keeps scope honest without inventing an epoch number.
- Corrupt payload with a recoverable key remains partial rather than falsely complete.
- A new revision, deletion, successful live retry, or successful backfill replaces/removes the old gap correctly.
- Stale live/backfill jobs cannot add gaps for newer source revisions or resurrect artifacts.
- Failure while writing terms, references, proofs, gap state, or completion rolls back the whole batch and cursor advancement.
- Watermarks advance across settled work, while full-history and count claims still reflect readable coverage.
- Recovery refresh requeues appropriate history and invalidates stale count/cursor scopes without breaking peers.
- Conversation-global gap state must interact correctly with viewer-specific hides, membership windows, and epoch coverage. Conservative partial reporting must not accidentally become a misleading full-history claim.

## 6. Implementation status by workstream

“Implemented” means the corresponding code and tests exist, not that all production gates passed at HEAD.

| Workstream | Implemented evidence | Remaining obligation |
| --- | --- | --- |
| Shared contracts | `@asm/messages` has crypto, payload, normalization, references, and search subpaths | Preserve server/browser import boundaries; run parity fixtures after relevant changes |
| Durable source changes | Revisions, creation/change sequences, outbox, replay tables, epoch/recovery state | Final mutation-path audit and failure/race verification |
| Server index | Terms, grams, numeric term-ID arrays, documents, references, frequency maintenance, atomic persistence | Latest gap SQL and coverage integration; production-shaped corpus/load measurements |
| Worker queues | Separate live/backfill/count lanes, sweeper, retries, resumable DB source state | Redis-loss/crash behavior and repair/alert operations at deployment |
| Search API | Indexed candidates, literal verification, current-source authorization, forward/reverse snapshot cursors | Regression coverage for latest changes and final authorization/rollback audit |
| Counts | Durable async requests, scope invalidation, deduplication/supersession, low-priority worker | Latest coverage eligibility and real backlog/latency/expiry validation |
| Hydration/shared refs | Bounded batch ciphertext hydration and cursor-based shared refs | Final unavailable-target, partial-coverage, and permission-change acceptance |
| Recovery | Legacy backup refresh, CAS, generation scoping, authenticated viewer epoch proofs | Retain crypto invariants and rerun real-key regression cases affected by coverage work |
| Search UX | Ordinary scope/error states, abort/stale fencing, stable hydration, three-page result retention | Final browser proof and physical-device responsiveness |
| Mutation sync | SSE plus durable replay, retry/coalescing, broadcasts, revision fencing | Reconnect/gap/account/reset lifecycle audit and real fault scenarios |
| Offline | Worker-backed IndexedDB cache with bounded records/bytes, ciphertext+terms+refs only | Quota/eviction/tab/account/recovery behavior and real device footprint |
| Transcript/decryption/media | Strict limits and anchor helpers; separated history/search/replay/media hooks | Complete planned controller boundaries and lifecycle audit; no drift/jitter certification yet |
| Unread | SQL aggregates plus transactional member counters and repair | Race tests and committed-cache consistency at deployment |
| Legacy retirement | Device archive walks removed from current thread, stores cleared without reading archives, bounded rollback | Inventory residual legacy modules before deleting compatibility code |
| Deployment/telemetry | Dedicated worker image target, flags, health/shutdown, privacy-safe metrics, runbooks | Actual deployment, alert routing, staged canaries, rollback and release evidence |

The original plan requested controllers for history, viewport anchoring, search, live updates, decryption, and shared media. Some controllers/hooks were extracted, but `message-thread.tsx` is still approximately **6,000 lines** at this checkpoint. Do not claim the complete abstraction/refactor has been proven merely because resource caps exist. Audit ownership and remaining effects; extract only specific needed boundaries while preserving visuals and behavior.

### Selected implementation commits for navigation

These commits exist in the current branch history. They help locate already-completed work; they are not instructions to cherry-pick or replay it.

| Commit(s) | Slice |
| --- | --- |
| `6f927bf4`, `dc00dd78`, `c0f8c107` | Shared search contract, crypto extraction, separately importable modules |
| `b826a94b` | Initial durable DM search schema |
| `a18ed0ef`, `c002e809` | Server-backed search and resumable backfill |
| `23678612`, `e8b6a261`, `2b4a3e38` | Atomic edits/deletes and durable change replay |
| `793d01a3`, `47d8b7fe`, `e9ad1a3d` | Async counts, bounded hit hydration, server shared refs |
| `0f0d959b`, `f6317dc0`, `311b89cf`, `b6d2fb70` | History response/window and decrypt queue bounds |
| `8c0ab834`, `fbf1c793`, `ac886f71`, `2cf6fe4d` | Unread SQL aggregates, serialized read boundary, transactional counters |
| `ac145adb`, `b56b560d`, `0c009619` | Legacy writer lifecycle, bounded durable retries, reset tests |
| `11e82875`, `18cccbce` | Automatic legacy backup refresh and repair requeue |
| `0f48f674`, `c7e3e5fe`, `74b84891` | Bounded worker-backed offline cache and mutation invalidation |
| `0a0cbdf6`, `b96d5e66`, `6636e4d4`, `f21b1b8e` | Cross-tab replay, recovery scoping, retirement ownership, reset invalidation |
| `f05dc129`, `b9ad3a1f`, `e46af32d` | Large/ broad candidate paths and selective counts |
| `0bf6e4b0`, `eb7dfe8d`, `58398a38` | Bounded media viewer and server reference navigation |
| `72d30a1c`, `d4f543a9`, `98b414ef`, `b2a73739`, `55f34ea1` | Worker/API/count/client telemetry and resource measurements |
| `f3a97b1c`, `675f3599`, `061a3384` | Dedicated worker, runtime environment, health/lifecycle/recovery bounds |
| `47892787`, `c29eeb21`, `6e2d1cc3`, `2eea0220` | Replay retry/coalescing, live revision fencing, byte-size cache, anchors |
| `86bfaf02` | Authenticate viewer epoch access across hits/counts/refs/hydration |
| `d097f74d`, `d9fc2a38` | Legacy archive-store retirement and bounded rollback search |
| `a8866db1`, `9d73193d` | Snapshot-scoped reverse pagination and bounded hydrated result pages |
| `e9354947` | Latest coverage truth and durable unreadable gaps; current HEAD |

The preceding branch includes unrelated DM styling, den, wallpaper, and media work. Preserve it; do not identify the whole branch as a clean task-only diff.

## 7. Code map

Paths below are relative to `/home/haze/repos/social`. Inspect these first rather than re-auditing unrelated app features.

### Shared package

```text
packages/messages/src/crypto.ts
packages/messages/src/payload.ts
packages/messages/src/normalization.ts
packages/messages/src/references.ts
packages/messages/src/search-contracts.ts
packages/messages/src/search.ts
packages/messages/src/*.test.ts
packages/messages/package.json
```

Use workspace subpaths such as `@asm/messages/crypto` or `@asm/messages/normalization`. Do not accidentally import DB/server dependencies into browser workers.

### Database, authorization, and queues

```text
packages/db/prisma/contract.prisma
packages/db/prisma.config.ts
packages/db/src/messages/search-index.ts
packages/db/src/messages/epoch-readability.ts
packages/db/src/messages/visibility.ts
packages/db/src/messages/prebuild-indexes.ts
packages/db/queue.ts
packages/db/index.ts
apps/web/src/lib/messages/server.ts
apps/web/src/lib/messages/reader-window.ts
```

`search-index.ts` is the central SQL implementation for artifact transactions, backfill, coverage/gaps, counts, unread transactions, mutation changes, search candidates, references, and hydration. It uses a lazy `pg` pool capped at 12 connections, with bounded timeouts; integration teardown must close it through the existing helper.

The schema includes `MessageSearchOutbox`, `MessageConversationChanges`, `MessageSearchTerms`, `MessageSearchDocuments`, `MessageSearchReferences`, `MessageSearchCoverage`, `MessageSearchGap`, `MessageSearchAccountState`, and `MessageSearchEpochReadability`.

Candidate expansion stays in SQL. Term dictionary grams cover Unicode 1/2/3-character grams, followed by literal fragment verification. Selectivity/frequency chooses an indexed selective path or bounded ordered scans for broad queries. Do not reinstate the old 64-term expansion cap or JavaScript full-result sort.

### Worker and deployment

```text
apps/auth/src/worker.ts
apps/auth/src/worker/message-search-index.ts
apps/auth/src/worker/message-search-count.ts
apps/auth/src/worker/message-search-sweep.ts
apps/auth/src/worker/message-search-metrics.ts
apps/auth/src/worker/worker-health.ts
apps/auth/src/worker/worker-lifecycle.ts
apps/auth/Dockerfile
apps/auth/MESSAGE_SEARCH_WORKER.md
```

The dedicated service is a Docker target in `apps/auth/Dockerfile`, not a separate `apps/dm-search-worker` directory. Run one initial dedicated instance with two live-index slots, one backfill slot, and one count slot. Internal transient message decryption concurrency is four. Private-key cache capacity is 128; wrapped-root cache capacity is 256; TTL is five minutes.

Queue jobs have eight exponential retry attempts, initial 1-second delay, and 0.25 jitter. Redis jobs are delivery hints; committed pending work remains in PostgreSQL and the sweeper rediscovers it. Verify failed-job repair and alert handling rather than assuming the existence of retries makes the operational requirement complete.

### APIs

All conversation-scoped paths use `/api/messages/conversations/[id]`:

| Endpoint | Source | Contract |
| --- | --- | --- |
| `POST /search` | `.../[id]/search/route.ts` | Up to 20 hits, forward/reverse boundaries, pinned snapshot, scope/coverage, optional count token |
| `POST /search/count` | `.../[id]/search/count/route.ts` | Pending, exact, or unavailable for scoped token |
| `GET /shared` | `.../[id]/shared/route.ts` | Cursor/anchor-based media, post, link references |
| `POST /messages/batch` | `.../[id]/messages/batch/route.ts` | Authorized ciphertext for at most 20 IDs and 1 MiB |
| `GET /changes` | `.../[id]/changes/route.ts` | Bounded durable replay, expired-cursor reset instruction |
| History/send | `.../[id]/messages/route.ts` | Bounded older/newer/around windows, ratchet/epoch validation, transactional send |
| Live events | `.../[id]/events/route.ts`, `.../[id]/stream/route.ts` | SSE paths; inspect their consumers for lifecycle ownership |

Also inspect edit/delete at `apps/web/src/app/api/messages/messages/[id]/route.ts`, hide/read/keys/conversation routes, identity route, den membership routes, conversation list, and unread-count route when auditing mutation parity. Keep `/api/messages/search` as the existing people-search endpoint.

### Client orchestration and cache

```text
apps/web/src/components/messages/message-thread.tsx
apps/web/src/components/messages/use-conversation-history.ts
apps/web/src/components/messages/use-conversation-media.ts
apps/web/src/components/messages/use-shared-refs-reader.ts
apps/web/src/components/messages/use-conversation-shared-content.ts
apps/web/src/components/messages/message-conversation-media.ts
apps/web/src/components/messages/viewer-history-window.ts
apps/web/src/lib/messages/client.ts
apps/web/src/lib/messages/use-conversation-search.ts
apps/web/src/lib/messages/search-result-window.ts
apps/web/src/lib/messages/search-hydration.ts
apps/web/src/lib/messages/anchored-window.ts
apps/web/src/lib/messages/message-revision.ts
apps/web/src/lib/messages/use-conversation-reconciliation.ts
apps/web/src/lib/messages/conversation-reconciliation.ts
apps/web/src/lib/messages/durable-change-replay.ts
apps/web/src/lib/messages/message-change-broadcast.ts
apps/web/src/lib/messages/identity-scope-broadcast.ts
apps/web/src/lib/messages/decryptor.ts
apps/web/src/lib/messages/offline-search-worker-client.ts
apps/web/src/lib/messages/offline-search-worker-core.ts
apps/web/src/lib/messages/offline-search-cache.worker.ts
apps/web/src/lib/messages/offline-search-cache.ts
apps/web/src/lib/messages/indexeddb-offline-search-cache.ts
apps/web/src/lib/messages/offline-search-fallback.ts
apps/web/src/lib/messages/scoped-search-index.ts
apps/web/MESSAGE_SEARCH.md
```

`use-conversation-history` uses bidirectional infinite-query pages capped at eight. Strict row/byte trimming lives in `client.ts`; anchor and live-tail behavior lives partly in the thread and `anchored-window.ts`. Inspect all three when changing history retention.

The current search hook retains at most three hydrated pages, or 60 result messages, and refetches evicted pages through adjacent signed boundaries. The original count token must remain pinned even after its first page is evicted.

Legacy modules still exist: `message-index-writer.ts`, `message-index-backfill.ts`, `indexeddb-search-index.ts`, `search-index-format.ts`, `memory-search-index.ts`, and related compatibility helpers/tests. Earlier leak/retry fixes were implemented there for rollout safety. Current thread cutover no longer starts full archive walks; rollback also remains bounded. Do not spend time rebuilding a second archive index.

### Telemetry

```text
apps/web/src/lib/messages/search-telemetry.ts
apps/web/src/lib/messages/search-client-telemetry.ts
apps/web/src/lib/messages/search-client-metrics.ts
apps/web/src/lib/messages/search-client-metric-contract.ts
apps/web/src/lib/messages/search-slo.ts
apps/web/src/app/api/messages/search/telemetry/route.ts
apps/auth/src/worker/message-search-metrics.ts
```

Capture search latency, frame cadence, memory samples, worker throughput/RSS, indexing lag, coverage, retries, count queue age, and reconciliation failures. Raw queries, plaintext, normalized terms, keys, SQL/source exception details, and job payloads must not enter telemetry or logs. Client metrics are sampled; instrumentation is not itself evidence that targets were met.

## 8. Required resource limits

| Resource | Approved limit / current intended behavior |
| --- | --- |
| Transcript | 800 messages or 8 MiB ciphertext, whichever is reached first |
| History response | 100 rows and 1 MiB; byte-truncated pages still carry valid continuation cursors |
| Search page / batch hydration | 20 IDs / 1 MiB hydration response |
| Hydrated search retention | Three pages / 60 messages; reverse refetch of evicted pages |
| Decrypted payload cache | 512 messages or 8 MiB |
| Ordinary decrypt queue | 128 entries; visible rows and search jumps prioritized |
| Urgent decrypt queue | Separate current cap of 128; audit total queue behavior against UX/working-memory goals |
| Offline conversation cache | 1,000 messages |
| Offline active-account cache | 32 MiB serialized records across conversations |
| Offline indexing batch | 32 messages or 256 KiB, yielding between batches |
| Outstanding offline worker RPCs | Current cap of 16 |
| Media viewer | 100 references; at most two neighboring assets prefetched |
| Server backfill read | 100 messages or 1 MiB ciphertext |
| Worker caches | Bounded, five-minute expiry |

Evicted transcript seams remain fetchable without fetch/trim loops. Preserve anchor message plus pixel offset through prepend, trimming, and measurements. Store reply, selected, and return anchors as IDs instead of retained pages. Maintain a separate live-tail summary while reading old history; returning to latest loads a fresh tail.

Storage cleanup must never remove identity recovery material. Account/recovery changes stop requests, workers, subscriptions, timers, and old derived cache work before new results appear. Quota failure or origin eviction is recoverable; it cannot silently become an exact empty search result.

## 9. Validation evidence: historical versus current

No tests were run while preparing this handoff. The following evidence was retrieved from prior conversation reports and the repository; retain its scope and age.

### Latest committed slices

| Checkpoint | Recorded evidence | Limit |
| --- | --- | --- |
| `e9354947` coverage/gap slice | 43/43 focused worker and route tests; lint/format and repository type checks passed | Latest DB-backed coverage integration tests were explicitly not run |
| `d9fc2a38` cutover checkpoint | 154 focused tests passed; `check-types` passed for 12 workspace packages | Full run was interrupted; PostgreSQL/Redis integrations were skipped because services were unreachable |
| `061a3384`, `d097f74d` worker/retirement | Reported 256 unit/integration checks, lint/types, health/shutdown checks | Historical checkpoint; not certification of later coverage changes |
| `86bfaf02` authenticated viewer epochs | Reported 144 focused tests, lint/types/schema verification | Historical checkpoint; preserve real-crypto test coverage |

There are earlier reports of full integration-enabled runs with 5,417, 5,423, and 5,430 passing tests, plus skips, and an older serial run with 5,107 passes. A socket-listening test failed under sandbox restrictions and passed in an isolated rerun. An unrelated Bun worker crash was also reported on one attempt. These are useful historical evidence, but a later incomplete run and subsequent code changes mean **there is no established clean, integration-enabled full-suite result for current HEAD**.

### Historical scale evidence

Prior reports include the following all-profile run on an earlier checkpoint:

| Profile | Reported broad-search p95 | Workload |
| --- | --- | --- |
| One 200k conversation | 86 ms | 50 concurrent searches, 40 live writes, one committed backfill batch |
| 20 × 100k | 102 ms | Same concurrency shape |
| One 1M conversation | 118 ms | Same concurrency shape |
| 20 × 200k | 101 ms | Same concurrency shape; 4M rows |

That report also gave asynchronous exact-count times of 2.4–19 seconds and said fixtures were cleaned up. Other reports gave 132–178 ms broad-search p95, about 47.4 MB of fresh indexes for 200k rows, and a 20×200k attempt that hit the test's 15-minute timeout. Earlier/later summaries conflict about whether the largest profile is complete. Preserve the reported results as **historical claims**, and produce one clearly recorded current-head result for affected gates rather than asserting that every prior run failed or that every current gate is already proven.

The current scale suite is `packages/db/src/messages/search-scale.integration.test.ts`. It has opt-in profiles `200k`, `20x100k`, `20x200k`, and `1m`, 50 concurrent searches, 40 live index writes, two live persistence lanes, and a concurrent backfill batch. It emits query plans, broad p95, exact-count time, index footprint, global WAL observations, and failure counts. Its per-test timeout is 900,000 ms.

**Fixture limitation:** this suite seeds synthetic ciphertext and preconstructed term arrays, mostly eight ubiquitous terms and one rare term. It exercises database search/persistence, not decrypting millions of real ciphertext bodies through the production worker. Its thin vocabulary and reference population do not establish production index size/write amplification for diverse multilingual text, URLs, media, long messages, and many epochs. Complement it with smaller real-crypto/parity fixtures and a representative load corpus; do not repeat four huge identical runs as a substitute.

`audits/dm-scale-2026-10-08.md` and its JSON plus `scripts/audit-dm-scale.ts` describe the **original legacy pipeline**, including synthetic Bun CPU and posting-write models. They are historical motivation, not a current-system performance certificate.

### Historical browser evidence

Earlier reports say a local DM contained exactly 200,000 messages, searching `veldrith` displayed thousands of matches, a second page loaded, highlights appeared, and a result jumped into the transcript. A later summary qualified that smoke test as not conclusively proving use of server search. The current client cutover, authenticated viewer epoch work, and latest coverage slice happened after some of these checks.

Therefore, keep the historical smoke evidence, but still perform the final requested current-implementation browser acceptance after all code work is complete. Verify server API requests and feature flags explicitly. A desktop screenshot or DOM-emulator test cannot certify low-end-device jitter or memory.

No physical 4 GB Android or iPhone/Safari release measurements are established. Prior ADB/socket access and browser URL-policy limitations must be respected if they recur; do not work around a browser tool denial by switching surfaces or launching an unauthorized browser path.

## 10. Practical continuation sequence

### A. Establish a stable checkpoint once

1. Read this document, root `AGENTS.md`, `packages/db/AGENTS.md`, `apps/web/AGENTS.md`, and the two message-search runbooks.
2. Confirm HEAD/worktree and preserve the uncommitted migration ref and pre-existing untracked artifacts.
3. Verify PostgreSQL and Redis availability using existing test configuration. Do not launch a full suite while integrations will be skipped.
4. When services are reachable, verify the DB marker/schema and migration status. Reconcile the already-applied two coverage migrations and local ref; do not regenerate/delete history.
5. Inspect and fix the suspected `refreshUnreadableSearchCoverage` SQL problem under the user's resume authorization, then execute the affected real-DB tests.

### B. Close latest correctness and abstraction gaps

Use a short requirement checklist, not another open-ended rewrite:

- Latest gap/coverage transaction and distinct epoch accounting.
- Current-source revision, deletion/hide, epoch and den-window authorization before page selection and counts, then again on hydration.
- All durable mutations: send, edit, global delete, hide, membership, key change, identity reset/refresh.
- Count supersession and invalidation during source/permission/recovery change.
- SSE replay gaps, expired cursor behavior, foreground/reconnect, cross-tab/account/reset disposal.
- Bounded transcript and live-tail behavior under bidirectional loading and search jumps.
- Controller ownership and residual thread effects; preserve the visual UI.
- Worker crash/duplicate/out-of-order/Redis-loss/reference-write failure behavior.
- Legacy store retirement and rollback never reviving archive walks or clearing identity material.
- Unread send/read/hide/delete/membership races and DB-to-Redis committed revision semantics.

Only change code for confirmed gaps. Write targeted regression tests for each. Commit the slice after relevant tests and repository checks pass. Report what remains after each meaningful milestone.

### C. Automated final verification

Run affected unit/DOM/IndexedDB/real-crypto/SQL integration tests first. Once fixes are settled, run the full integration-enabled repository suite and both required checks once, retaining logs and confirming tests were not skipped for unavailable services.

Run the necessary current-head scale profiles, reuse representative setup where safe, and record fixture cleanup. The exact approved target is 50 concurrent searches during live writes/backfill. Results must distinguish DB execution, API response, network/hydration/decrypt/render, and counts.

### D. Final browser/device acceptance

Only after B and C are complete:

- Verify/create the dedicated local fixture without overwriting unrelated accounts or appending 200k repeatedly.
- Seed the requested new conversation to exactly 200,000 actual encrypted messages, verify decrypt samples, then wait for verified readable coverage.
- Confirm the public build flag and runtime server flag, and inspect actual conversation `/search` requests.
- Exercise full-history fragments, reverse/forward pagination beyond three retained pages, search jump/return, old-history scrolling with live arrivals, shared viewer navigation, and large ciphertext hydration.
- Exercise service failure and rollback saved-history scope, offline reload/search, reconnect edits/hides/deletes, gap reset, account switches, and recovery-generation changes.
- Check stable row heights/selection, absent loading loops, and no false “No matching messages” during incomplete coverage/failure.
- Run 100 conversation switches and inspect retained workers, listeners, timers, requests, query/cache windows, and memory growth.
- Measure the physical-device gates below, recording hardware/browser/network versions and samples.

### E. Deployment and completion

Verify the dedicated worker image and health, migration prebuild/adoption, alert routing, kill switches, canary coverage/recall, and rollback. Production rollout requires the user's/environment's applicable authorization; a request to implement locally is not blanket permission to mutate production.

Mark the task complete only when all required implementation work and available release gates are proven. If physical devices or production access are unavailable, deliver the completed code and explicit remaining external gates; do not claim flawless production readiness.

## 11. Test entry points and commands

Use `bun` throughout. Commands are continuation instructions, not commands executed during handoff creation.

### Latest slice first — run against the local test DB

```bash
bun test --env-file=.env.test packages/db/src/messages/search-index-mutation.integration.test.ts
bun test --env-file=.env.test packages/db/src/messages/identity-search-recovery.integration.test.ts
bun test --env-file=.env.test packages/db/src/messages/search-count.integration.test.ts
bun test --env-file=.env.test apps/auth/src/worker/message-search-index.integration.test.ts
```

Also run the latest affected worker and search/count/shared route unit files. The new gap helper deserves direct integration regression coverage, rather than only mocked caller coverage.

### Relevant existing suite inventory

| Concern | Tests |
| --- | --- |
| Shared matching/payload/crypto/refs | `packages/messages/src/{search,payload,crypto,references}.test.ts` |
| Browser recovery invariants | `apps/web/src/lib/messages/crypto.test.ts`, `recovery-invariants.test.ts`; inspect provider/identity route tests |
| Real viewer keys and worker artifacts | `apps/auth/src/worker/message-search-index.integration.test.ts` and `.test.ts` |
| SQL candidates, grams, long-token/ordering behavior | `packages/db/src/messages/search-candidates.integration.test.ts` |
| Frequency maintenance/orphan pruning | `packages/db/src/messages/search-frequency.integration.test.ts` |
| Coverage/mutations/recovery | `search-index-mutation.integration.test.ts`, `identity-search-recovery.integration.test.ts` |
| Counts and shared refs | `search-count.integration.test.ts`, worker count tests, API route tests |
| Batch hydration | `search-hydration.integration.test.ts`, API batch route tests |
| Durable replay | `message-conversation-changes.integration.test.ts`, `durable-change-replay.test.ts`, `conversation-reconciliation.test.ts` |
| Unread concurrency | `message-read-sequence.integration.test.ts`, `message-unread-counters.integration.test.ts`, relevant den tests |
| Search UI state/pagination | `use-conversation-search.integration.test.tsx`, `search-result-window.test.ts`, `search-page-refresh.test.ts`, cursor/count token/status/coverage tests |
| Transcript | `use-conversation-history.integration.test.ts`, `client.test.ts`, `anchored-window.test.ts`, `viewer-history-window.test.ts` |
| Offline | `offline-search-cache.test.ts`, `indexeddb-offline-search-cache.test.ts`, offline worker core/client/fallback/change-policy tests |
| Account/tab/recovery cleanup | `scoped-search-index.test.ts`, `identity-scope-broadcast.test.ts`, `message-change-broadcast.test.ts`, `legacy-search-retirement.test.ts` |
| Media/shared cursors | `message-conversation-media.test.ts`, shared reader cursor tests, server/shared-ref cursor tests |
| Worker process | `worker-health.test.ts`, `worker-lifecycle.test.ts`, `worker-lifecycle.integration.test.ts`, sweep/metrics tests |
| Metrics/privacy | Client metric/telemetry tests and `/search/telemetry/route.test.ts` |

Some pure tests cover helpers and some route tests mock DB calls. Do not substitute them for transactional SQL or real-crypto integration behavior.

### Repository checks

```bash
bun run check
bun run check-types
bun run test
```

`bun run check` is **mutating** (`oxfmt --write` plus `oxlint --fix-dangerously`). Inspect its diff and preserve unrelated changes. Root `check-types` first type-checks scripts, then workspaces. The previously observed migration type-check blocker was reported resolved by subsequent full checks; if it recurs, diagnose the actual installed Prisma 8 artifacts rather than bypassing scripts or hiding errors.

`bun run test` uses `scripts/testing/run-tests.ts`, with default file concurrency four. It probes PostgreSQL and Redis and **skips integration tests if either is unreachable**. A zero exit code with these skips is not a full integration result. Read the selected-suite output and keep test logs. Inspect the runner and installed Bun flags before changing concurrency. Prefer a bounded diagnostic rerun of a known stalled test over repeatedly launching the entire suite.

### Opt-in scale tests

```bash
RUN_MESSAGE_SEARCH_SCALE=1 MESSAGE_SEARCH_SCALE_PROFILE=200k bun test --env-file=.env.test packages/db/src/messages/search-scale.integration.test.ts
RUN_MESSAGE_SEARCH_SCALE=1 MESSAGE_SEARCH_SCALE_PROFILE=20x100k bun test --env-file=.env.test packages/db/src/messages/search-scale.integration.test.ts
RUN_MESSAGE_SEARCH_SCALE=1 MESSAGE_SEARCH_SCALE_PROFILE=1m bun test --env-file=.env.test packages/db/src/messages/search-scale.integration.test.ts
RUN_MESSAGE_SEARCH_SCALE=1 MESSAGE_SEARCH_SCALE_PROFILE=20x200k bun test --env-file=.env.test packages/db/src/messages/search-scale.integration.test.ts
```

The suite refuses production and requires a local `asocialmedia` DB on port 5433. Failed or interrupted runs may leave fixtures if a process was killed before `finally` finished. Inspect only fixture-owned IDs/users before cleanup; never clear the message tables globally. SQL index/WAL figures are local diagnostics, and global WAL counters can include unrelated writes.

## 12. Local fixture, credentials, and seeding pitfalls

These are explicitly local development fixture credentials, confirmed from `scripts/seed-dm-search-test.ts`. Login was not reverified during this handoff.

| Account | Email | Username | Password | User ID |
| --- | --- | --- | --- | --- |
| Owner | `dm-search-owner@asocialmedia.local` | `dmsearchowner` | `Test@1234` | `11111111-1111-4111-8111-111111111101` |
| Peer | `dm-search-peer@asocialmedia.local` | `dmsearchpeer` | `Test@1234` | `11111111-1111-4111-8111-111111111102` |

Conversation ID: `11111111-1111-4111-8111-111111111103`.

Local app path: `/messages?c=11111111-1111-4111-8111-111111111103` (earlier app sessions used `http://localhost:3000`). Use the actual configured dev origin rather than assuming it is live.

Fixture scripts:

- `scripts/seed-dm-search-test.ts`: creates the two accounts, identity backups, wraps, membership, and DM with `--apply`. It prints an intended `messages: 200000` value but **does not insert 200,000 message rows**. Its existing-conversation early return also prints this number regardless of actual row count. Never use that output as a row-count assertion.
- `scripts/seed-dm-history.ts`: appends real encrypted messages to a chosen DM. `--total=N` means **messages to add**, not a desired final total. It validates members, resolves keys, verifies existing ciphertext, and handles ratchet/sequence/epoch state. Read it before seeding a partially populated fixture.
- `--verify-only` checks samples; `--dry-run` resolves and verifies without appending. Neither proves the full history index has complete readable coverage.

Typical commands after implementation is complete and the database has been inspected:

```bash
bun --env-file=.env.test scripts/seed-dm-search-test.ts --apply
bun --env-file=.env.test scripts/seed-dm-history.ts --conversation=11111111-1111-4111-8111-111111111103 --verify-only
bun --env-file=.env.test scripts/seed-dm-history.ts --conversation=11111111-1111-4111-8111-111111111103 --total=200000 --batch-size=100 --dry-run
```

The final write command must use the verified missing row count or a genuinely new dedicated fixture, not blindly rerun `--total=200000`. The script's default batch size is 2,000; choose a bounded test batch deliberately and verify it against current durable-change/indexing expectations. Do not leave a seeder running after a stop or error; prior execution did leave a lingering seed process and later stopped it.

Current fixture rows, document count, coverage, and account presence could not be confirmed because the local DB was unreachable in this read-only handoff. Earlier reports claim the existing DM was seeded and indexed; inspect before creating duplicates or appending.

## 13. Prisma 8 workflow — preserve migration history

This repository is Prisma 8 / Prisma Next, currently root `prisma` `8.0.0-rc.15`. Do not use Prisma 7 assumptions, `@prisma/client`, `schema.prisma`, `prisma migrate dev`, or `db push`.

Before any DB-layer edit, read:

```text
packages/db/AGENTS.md
packages/db/.devin/skills/prisma-8/SKILL.md
packages/db/.devin/skills/prisma-8/references/contract.md
packages/db/.devin/skills/prisma-8/references/migrations.md
packages/db/prisma.config.ts
```

Verify the installed skill/reference names and versions, and fetch the upstream [Prisma 8 migration architecture](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md) before changing the workflow. Use Context7 for the current package/API documentation as instructed by `AGENTS.md`.

The authored source is `packages/db/prisma/contract.prisma`. Generated artifacts are emitted through `bun run db:gen`; never hand-edit them. Plan replayable migrations from a **verified origin**, review generated operations and migration path, preserve hashes/refs/markers, apply reviewed migrations, and verify schema.

Repository scripts already expose:

```bash
bun run --cwd packages/db --env-file=../../.env.test db:status
bun run --cwd packages/db --env-file=../../.env.test db:verify
```

Only when a new contract change is actually needed, follow the contract-first plan/review/apply process in the installed skill. `db:up` uses `db update` for the local solo database and is not a production deployment strategy.

Large-table indexes must be prebuilt concurrently outside migration transactions where generated prechecks permit adopting existing indexes. `bun run db:prebuild-dm-indexes` is the repository's helper. Review both prebuild and migration operations; `CREATE INDEX CONCURRENTLY` cannot run inside the transaction used by `db migrate`.

Do not remove old snapshots or edit `ops.json`/`migration.json`. Do not `db sign` away drift without proper verification. Preserve `BackfillMarker` compatibility state. The latest local ref advancement is an expected side effect of the previously applied migration chain, not permission to discard graph metadata.

## 14. Rollout, failure handling, and privacy

Read `apps/web/MESSAGE_SEARCH.md` and `apps/auth/MESSAGE_SEARCH_WORKER.md` for the implemented deployment behavior.

| Setting | Meaning |
| --- | --- |
| `NEXT_PUBLIC_MESSAGE_SEARCH_SERVER=1` | Build-time web flag enabling server-history requests; Next public values are embedded during build |
| `MESSAGE_SEARCH_SERVER_ENABLED=0` | Runtime API kill switch; clients use honest bounded saved-history fallback |
| `MESSAGE_SEARCH_BACKFILL_ENABLED=0` | Independently pauses historical processing after worker restart; live work continues |
| `MESSAGE_SEARCH_COUNT_ENABLED=0` | Independently pauses expensive count processing after restart |
| `MESSAGE_SEARCH_WORKER_ENABLED=0` | Disable search queues in general worker when deploying the dedicated worker |
| `MESSAGE_SEARCH_WORKER_ONLY=1` | Dedicated search-only role; image target already sets it |
| `WORKER_HEALTH_PATH` | Process-local atomic heartbeat file path, default `/tmp/asm-message-search-worker-health.json` |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | Default 30 seconds, bounded 1–120,000 ms; platform termination grace must exceed it |

Build the `message-search-worker` target in `apps/auth/Dockerfile`. The default image target remains auth/general service. Health probes use `./asm-worker --health-check`, requiring a fresh process-owned heartbeat, existing owner process, ready queues, and successful Redis heartbeat publication. A different replica cannot make a failed instance healthy. Staleness is 30 seconds; image probes are every 10 seconds with a startup grace period.

Shutdown invalidates health, stops scheduling, drains jobs/resources, and exits unsuccessfully on deadline. Sweeps and heartbeats allow only one in-flight operation so Redis stalls do not stack timers.

Rollback keeps durable database state and uses bounded cached search with explicit saved-history scope. It does not restore legacy archive walks. Access denial must not fall back to stale local results. Service failure can fall back to named saved-history scope; unavailable local storage produces a retry state. Cache reset cannot erase identities.

Delivery sequence from the approved plan:

1. Stabilize client lifecycle, strict windows, retries, coverage, unread aggregates, and account scoping.
2. Add shared contracts, durable changes, revisions/epochs/replay, unread transactions, and worker service.
3. Build shadow index with resumable backfill and compare recall/authorization against decrypted fixtures.
4. Cut over behind flags: internal accounts, heavy-user canaries, then progressively wider rollout. Full-history claims require verified readable coverage.
5. Retire archive indexing/stores while preserving bounded offline data and identity recovery.

Code for much of this sequence exists. Actual shadow recall evidence, canary deployment, alert routing, saturation behavior, and rollback operations still need verification. Restrict term/index access, avoid sensitive logging, and remove orphaned terms after global deletion.

## 15. Release gates still binding

Use production-shaped workloads: 20×100k, 20×200k, and one 1M conversation, with broad/rare fragments, multilingual text, large messages, media, hidden rows, unread backlogs, and multiple epochs. Capture PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)`, 50 concurrent search clients during live writes/backfill, index size, write amplification, worker memory/throughput, queue age, and indexing lag.

Physical reference devices: a 4 GB Android phone at 60 Hz plus an iPhone/Safari reference. Record exact models, OS/browser versions, and a reference network of 100 ms RTT and 10 Mbps download.

| Measure | Initial release target |
| --- | --- |
| Typing input-to-paint | p95 < 50 ms |
| Warm offline results | p95 < 100 ms after debounce |
| Online first usable results | p95 < 300 ms after debounce |
| Cached / online search jump | p95 < 500 ms / 1.5 s |
| Scroll frames | p95 within device refresh interval |
| Anchor drift | ≤ 2 CSS px |
| Added DM working memory | < 64 MiB above app baseline, excluding separately bounded media |
| Live indexing lag | p95 < 2 s; p99 < 10 s |
| Lifecycle | No retained-resource growth after 100 conversation switches |

Measure large hydration separately against bytes transferred; it must not block typing/scrolling. These targets are gates to prove, not guarantees established by the current code or local benchmark.

Required failure/correctness coverage includes short fragments/URLs/punctuation/emoji/accents/non-space scripts/long-token boundaries; online/offline/reload/eviction parity; tied timestamps and concurrent edits; hides/den leave-rejoin authorization before paging/counts; reset/peer epochs; legacy/corrupt/unavailable wraps; worker crashes/duplicates/Redis loss/stale jobs/reference failures; offline mutation/quota/origin eviction/tab/account scope; unread races; and long bidirectional scrolling/media navigation without growth, drift, or loops.

## 16. Repository conventions and efficient operation

- `bun add` for dependency changes; do not hand-edit manifests. No new dependency is needed just to resume.
- Import shared code through workspace names. No `as any`.
- All source comments use `//`; no block/JSDoc comments except required JSX child syntax.
- Preserve Tailwind and existing UI primitives/3D surfaces. Dark styling follows the app's `.dark` class, not OS-only `dark:` behavior.
- Consult current library docs through Context7 for packages/APIs you touch; Next-specific guides are in the installed `node_modules/next/dist/docs` tree described by the web `AGENTS.md`.
- Commit style is `fix[MESSAGES]: ...`, `feat[MESSAGES]: ...`, `test[MESSAGES]: ...`, etc.
- `lefthook.yml` pre-commit runs package version bumps, mutating repo-wide formatting/lint, and type checks. Inspect generated manifest/lockfile changes; do not manually revert expected hook results or include unrelated edits accidentally. Pre-push also runs tests/checks.
- Do not launch extra agents unless the user or an applicable instruction explicitly requests delegation.
- Use short milestone updates, and report unavailable services/tests without repeatedly troubleshooting the same environment in circles.
- Tests skipped because services are unreachable are unverified, not passed. A stalled/failed full run is not success. Preserve logs and identify the individual failure before broad retries.
- Capture enough durable evidence (commit, command, environment, pass/skip/fail summary, timing scope, cleanup) that the next handoff does not need to reconstruct dozens of contradictory chat updates.
- Honor stop immediately: terminate task-owned seed/test/worker activity as appropriate, preserve work, and pause. Internal automated continuation cannot override the user's stop.

## 17. Suggested receiving-model kickoff

> Continue the approved production-grade web DM history and search implementation in `/home/haze/repos/social` using this handoff. Preserve existing work and the current encryption/recovery contract. Start with the latest coverage SQL defect and real PostgreSQL integration verification, then close confirmed requirement/lifecycle/failure gaps. Commit tested slices and keep me updated with concrete remaining tasks. Avoid repetitive testing and do not begin browser testing until implementation is complete. At the end, verify a new 200k-message encrypted DM through browser control and report physical-device/deployment gates honestly. Read the repository instructions before changing code.

The remaining scope is **latest coverage correctness, final abstraction/lifecycle and failure-path verification, current-head automated/load evidence, final seeded-DM browser/device acceptance, and deployment/canary/rollback proof**. It is not merely “run one last test,” and it does not require rebuilding the architecture from scratch.
