# DM history and search: independent completion review

This is the historical baseline review. Its findings were addressed and re-verified on 2026-10-10; see the [current production verification](./dm-production-verification-2026-10-10.md) for the updated verdict and remaining release gates.

Review date: 2026-10-09. Repository: `/home/haze/repos/social`. Reviewed commit: `08365b06` on `feat/messages-wallpaper-prisma8`, including the existing working tree.

## Verdict

The implementation has substantial working infrastructure and strong passing test coverage. It is **not ready for production sign-off** against the agreed plan. Two confirmed behavior defects affect queue deduplication and access to readable search results. Durable failure recovery and aggregate client memory bounds also require work or stronger evidence.

This was a review, not a continuation of implementation. No application code, dependency, migration, or existing user file was changed. No commits were created. Browser testing was not started because correctness blockers remain; the user's instruction was to defer it until implementation is complete.

## Independently verified

| Check | Result |
| --- | --- |
| `bun run check-types` | Passed |
| `./node_modules/.bin/oxfmt --check` | Passed, 2,125 files |
| `./node_modules/.bin/oxlint` | Failed on the existing untracked scratch test described below |
| Focused shared crypto, matching, offline, cursor, reconciliation, and window tests | 80 passed, 0 failed |
| Real PostgreSQL/Redis message, den, worker, and lifecycle integration suites | 324 passed, 1 opt-in scale test skipped, 0 failed |
| Existing real search-route scratch reproduction | 1 passed; authenticated route returned HTTP 200 against local services |
| `bun run test` | 5,564 passed, 4 skipped, 0 failed across 540 files |
| `bun run --cwd packages/db --env-file=../../.env.test db:verify` | Passed; database schema and marker agreed, no warnings |
| Opt-in 200k-message search scale integration | 1 passed, 22 assertions, 0 failed |

The full-suite skips were the opt-in scale case, two Gemini API cases, and a den browser-background acceptance case. The scale case was subsequently run separately. Formatting was checked without mutation instead of running the formatting-writing portion of `bun run check` during this read-only review.

The current local 200,001-message DM had 200,001 search documents, zero coverage gaps, zero unrecoverable epochs, and a completed change watermark of 200,001. The local pending outbox count was zero. This establishes successful indexing for that fixture, not universal recovery from failures.

Database verification hash: `660d8ca10a17b595cf52d9da8abe8c1b81543dbeafba3d067665dca834061a8b`.

### Fresh 200k database benchmark

Command:

```sh
RUN_MESSAGE_SEARCH_SCALE=1 MESSAGE_SEARCH_SCALE_PROFILE=200k bun test --env-file=.env.test packages/db/src/messages/search-scale.integration.test.ts
```

| Measurement | Observed |
| --- | --- |
| Fixture | One conversation, 200,000 seeded messages |
| Concurrent searches | 50 |
| Concurrent live index writes | 40 |
| Backfill batch | Committed |
| Search failures | 0 |
| Broad search p95 | 108 ms |
| Rare query execution | 2 ms |
| Exact count | 7,186 ms |
| Fresh search indexes | 47,357,952 bytes for 200,040 documents, approximately 237 bytes/document |
| Fixture seed throughput | 6,038 rows/second |

This is a synthetic database benchmark with prepared search terms, not a measurement of full cryptographic ingestion, device interaction, network latency, or heap usage. The asynchronous count design makes the seven-second count compatible with results arriving first, but count concurrency/backlog still needs workload validation.

Retained local logs:

- `/tmp/dm-verification-20261009-full-tests.log`
- `/tmp/dm-verification-20261009-scale-200k.log`

These temporary logs should be copied into durable CI artifacts if they are needed beyond the current machine/session. No new larger benchmark was run after blockers were confirmed.

## Blocking findings

### 1. P1: deterministic queue IDs are discarded

Location: `packages/db/queue.ts:422–438`, plus the message search callers immediately following it.

`addWithFreshId` receives a deterministic `jobId` and checks `queue.getJob(jobId)`, but calls `queue.add(name, data, options)` without placing that ID into `options`. Live indexing, conversation backfill, and count callers supply options without `jobId`. Consequently, the enqueue uses an automatically generated ID and subsequent deterministic lookups do not find it.

A diagnostic invoking the actual exported enqueue functions with a queue mock captured four enqueue calls: two repeated live calls, one backfill, and one count. **All four omitted `options.jobId`.** The diagnostic is `/tmp/dm-review-queue-identity.test.ts`; it did not mutate the repository or Redis.

Impact: repeated sweeps, requests, and recovery can enqueue duplicate work. Database idempotence limits data corruption, but duplicate jobs consume worker and database capacity and undermine the intended live-index latency and count coalescing guarantees.

Required correction: forward the deterministic ID into the add options, preserving the intended completed/failed-job replacement behavior. Add tests for duplicate waiting/active delivery, completed/failed replacement, and concurrent producers through the actual queue adapter. The current passing suites do not establish this behavior.

### 2. P1: settled partial coverage blocks pagination of readable history

Locations:

- `apps/web/src/lib/messages/server-search-coverage.ts:31–35`
- `apps/web/src/lib/messages/use-conversation-search.ts:973–980`
- `apps/web/src/app/api/messages/conversations/[id]/search/route.ts:312–321`

The server distinguishes settled coverage from fully complete coverage. An unreadable epoch or corrupt message can leave coverage settled but incomplete while many other messages are readable and indexed. The API can return a valid continuation cursor for those readable hits.

The client helper nevertheless defines more results as `coverageComplete && nextCursor !== null`. It therefore discards that continuation when coverage is partial. With a first page of 20 hits, the UI treats those as the only navigable hits. Coverage polling also stops when coverage is settled, so waiting does not recover navigation.

The helper behavior was reproduced directly: settled incomplete history with a valid cursor reports no more results and no polling. This is a source-path and helper reproduction, not browser acceptance testing. Existing tests encode the complete-coverage restriction and do not cover the required degraded-history experience.

Impact: one unreadable portion of history can make readable matches after the first page inaccessible through the search UI, violating the agreed full **readable** history contract and graceful recovery behavior.

Required correction: allow stable pagination of authorized available hits while accurately declaring partial scope and avoiding false exact totals. Preserve cursor/snapshot behavior during ongoing indexing. Add integration coverage with settled partial coverage and more than 20 readable matches, including unavailable epochs and corrupt ciphertext.

### 3. P1: live outbox failure recovery lacks a durable terminal/repair transition

Locations:

- `apps/auth/src/worker.ts:220–231`
- `apps/auth/src/worker/message-search-sweep.ts:88–98`
- `apps/auth/src/worker/message-search-index.ts`

The sweeper repeatedly selects the oldest 100 unfinished outbox records. Queue delivery has an eight-attempt retry budget, but failed jobs can be recreated by a later sweep. The live outbox does not persist an advancing retry budget, next eligible retry time, or a durable repair/dead-letter transition. An attempts field alone does not implement this policy. Count requests have their own persistent retry state; that does not solve live outbox recovery.

Impact inferred from the code path: permanently failing old work can repeatedly consume capacity. If the oldest 100 pending records fail persistently, later durable records are excluded from sweep selection, particularly during recovery after Redis loss. Direct enqueue on normal sends may still work, so this is not a claim that all live sends currently stall. No 100-poison-record runtime fault experiment was performed in this review.

Required correction: persistent failure bookkeeping and repair state, fair selection of eligible work, bounded retry scheduling, and an actionable repair alert. Add a fault integration test demonstrating that poison records cannot starve later durable work after Redis loss or worker restart.

### 4. P2: transcript bounds do not establish an account-wide memory bound

Locations:

- `apps/web/src/components/messages/use-conversation-history.ts:10–33`
- `packages/ui/providers/query.tsx:14`

The rolling transcript bounds and `maxPages` apply per conversation. Ordinary conversation switches do not evict or reduce inactive transcript queries, and the shared QueryClient retains them for its ordinary garbage-collection interval.

A QueryClient cache probe retained 20 inactive conversation queries containing 16,000 message rows, with a 300,000 ms retention interval. This was a query-cache probe, not a physical browser heap measurement. At the permitted 8 MiB per conversation, retaining 20 windows admits roughly 160 MiB of ciphertext before object overhead, decryption, and other caches. Actual message sizes can be smaller; this is an allowed upper bound, not a claim that the tested device consumed 160 MiB.

Impact: per-conversation limits alone cannot guarantee the agreed 64 MiB additional working-memory target during repeated conversation switches on low-end devices.

Required correction: an account-wide inactive-history byte/row budget or prompt eviction/trim policy, preserving navigation anchors by ID. Add repeated-switch lifecycle coverage and physical device heap measurements before accepting the memory release gate.

## Additional issues

### Latent backfill-outbox dispatcher mismatch

`packages/db/queue.ts:458–465` enqueues `index-message-outbox` with `{ outboxId }` onto the backfill queue. Its consumer at `apps/auth/src/worker.ts:257–264` always invokes conversation backfill with `job.data.conversationId`, without dispatching on the job name.

No current production writer of `kind: "backfill"` outbox rows was found in the reviewed TypeScript source; the branch appears in sweep fixtures. Therefore this is a latent contract mismatch, not evidence that the existing indexed fixture failed. Either remove the unsupported branch or implement and test dispatch before a producer begins using it.

### Current workspace lint gate fails

The existing untracked `apps/web/src/app/api/messages/conversations/[id]/search/route-repro.scratch.test.ts:28` violates `unicorn(no-await-expression-member)` by chaining a member call directly onto an awaited expression. This is the only reported lint error. The scratch test passes at runtime. Clean up or deliberately incorporate the scratch artifact before release; it was left untouched during review.

## Release evidence still required

Passing unit and integration tests do not establish every agreed release gate. This review did not independently establish:

- The current implementation under both multi-conversation profiles, 20 × 100k and 20 × 200k, and the one-million-message profile while full ingestion, backfill, and live writes run.
- Browser acceptance of partial coverage, search jumps, mutation reconciliation, repeated bidirectional scrolling, and bounded media navigation.
- Physical 4 GB Android and iPhone/Safari measurements with recorded hardware/browser versions and the reference network.
- Input-to-paint, scroll-frame, anchor-drift, device-memory, and 100-conversation-switch lifecycle targets.
- Live indexing p95/p99 lag and worker memory/queue age under realistic encrypted payloads and failure/recovery load.
- Deployment canary, kill-switch, and rollback behavior in the deployed environment.

Historical tests or external execution may provide some of this evidence. They should be supplied with commit, fixture, environment, commands, and retained results rather than treating a prior verbal statement as proof of the current release.

## Efficient completion order

1. Fix queue identity and add adapter-level deduplication/re-enqueue tests.
2. Fix readable-history pagination under settled partial coverage and add client integration tests.
3. Implement/test bounded durable live-outbox repair and fair recovery selection; resolve the latent backfill dispatch branch.
4. Bound inactive transcript retention across the account and test repeated switches.
5. Resolve the scratch lint error and package the migration/worktree artifacts deliberately. Do not discard unrelated local changes.
6. Run targeted regressions for the changed areas, then the required repository checks once.
7. Run the remaining production-shaped workload and device/browser acceptance gates at the end. Record durable artifacts and evaluate against the agreed thresholds.

The architecture and current normal-path behavior are promising. The reason to withhold sign-off is specific missing behavior and evidence, not a request to redesign or repeat all completed work.
