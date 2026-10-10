# Handoff: Daddy's Dream

## Purpose and branch state

This handoff records the merge of the DM history/search implementation with the latest `dev` changes, the conflict resolutions, the validation completed, and the work that remains before release.

- PR title requested: `Daddy's Dream`
- PR target: `dev`
- Working branch: `codex/daddys-dream`
- Upstream snapshot merged: `origin/dev` at `afe83979`
- Feature branch head before the merge: `0710c7c4`
- The merge commit has been created. The branch push and PR creation are the remaining delivery actions.
- The ignored `/context` directory was removed as requested.

This branch carries the accumulated DM history/search work together with the latest `dev` changes, so the PR is broad (hundreds of files) rather than a small isolated patch. Review the combined application changes, mobile changes, dependency graph, and database contract as one integration.

## Product and architecture state

The work moves conversation search from a device-side archive walk to a server-maintained index with bounded device caches. Search requests are conversation-scoped and return stable, newest-first pages; exact counts are separate work; selected hits are hydrated as authorized ciphertext and decrypted on the device. Offline results come only from the bounded history saved on that device. User-facing coverage states distinguish incomplete history from a completed empty search.

The indexing worker decrypts transiently using the existing server-recoverable identity and key-wrap flow, extracts normalized terms and references, and persists search artifacts rather than message bodies or previews. Durable message changes/outbox state remain in PostgreSQL, so queue loss does not discard indexing work. Revision and source checks prevent stale work from replacing a newer edit or deletion. Authorization and key-epoch readability constrain what can be indexed and returned.

The existing encryption algorithms and wire format are preserved. This remains **server-recoverable encryption**, not end-to-end encryption. Normalized search terms are sensitive derived data even though message bodies are not stored in the search index; they must remain access-controlled and out of logs/telemetry.

The client work bounds transcript, decrypt, search-result, and offline-cache windows and uses a worker for non-visible indexing/matching. Search UI requests can be superseded and stale responses discarded; reading a selected hit hydrates a small window rather than retaining the archive. The existing people search remains separate.

## Merge resolution record

- Merged both sides of the workspace manifests and `bun.lock`, retaining dependency changes from `dev` and the feature branch. The Prisma CLI/ORM versions follow the Prisma 8 contract in the merged branch. A frozen-lockfile dry run validated the merged workspace lock graph.
- Resolved `apps/auth/src/worker.ts` by preserving the DM search worker/role setup and adding the incoming credential-account repair path. Startup repair is best-effort and logs only a failure; the maintenance job remains independently schedulable.
- Resolved mobile changes by retaining the incoming profile/message actions and integrating the feature branch's Privacy tab into the incoming four-tab settings pager. Privacy uses the active `SettingsSectionHeader` and `SettingsCardHeading` contracts. Removed the unused legacy `SettingsTabBar`, which referenced missing styles and metadata.
- Kept the merged DB queue test coverage for both stable message-search job IDs and the incoming account-heal scheduler.
- Resolved the Prisma migration reference with the Prisma 8 migration CLI; no `refs` file or migration hash was hand-edited.

## Prisma contract and migration

The incoming `dev` contract ended at `c2b37d44c45891f704d244735fb801e82788e4202253dc4fec099733ce5b7a23`. The merged contract is `bead356b8ab9022bad6b8a21230c3891edf0eec9601f9a399534036b34bb42d8`.

The convergence migration is `packages/db/prisma/migrations/app/20261010T1135_converge_latest_dev_and_dm_search/`. It transitions from the incoming `dev` contract to the merged contract with 103 additive operations. It also carries forward the final set-based search-term-frequency trigger from the feature migration because that custom SQL behavior is not represented by the Prisma schema alone. The migration was regenerated with its scaffold emitter, and Prisma reports the on-disk migration graph up to date at the merged contract hash.

No database was connected to or migrated during this work. The migration must still be reviewed and applied through the normal deployment process; generation and graph validation do not substitute for a production-shaped database migration test.

## Validation completed

- `bun run check` — passed after fixing the merged worker's startup error handling to use async/await.
- `bun run check-types` — passed for all 12 workspace packages.
- Mobile DM/message unit tests — 183 passed across 12 files.
- Mobile group-add privacy setting tests — 3 passed.
- Web search-core tests — 99 passed across 7 files.
- Web search/count/shared/changes/batch API tests — 46 passed across 5 files.
- Auth message-search indexing worker tests — 10 passed.
- Credential-account repair tests — 9 passed.
- DB queue/scheduler tests — 5 passed.
- `git diff --cached --check` — passed after staging; the merge-marker scan found no conflict markers outside the repository's literal marker example in `LICENSE`.
- Prisma migration CLI status — up to date at `bead356…`; 34 migrations listed.

The mobile settings and message UI were type-checked but not browser-tested. Integration tests that require a live PostgreSQL/Redis service were not run in this merge pass.

## Remaining release work

The user explicitly asked to defer browser testing until the full plan is implemented. No browser control, new-DM creation, or 200k-message browser seed/run was performed in this pass. Keep that deferral in place until the browser-test gate is explicitly reached.

Before declaring the overall plan production-ready, complete the remaining release checks against a production-shaped environment:

1. Run the browser test at the end of implementation, including creating a fresh DM, seeding 200k messages, and verifying search, pagination, selection/jump, and failure states. Keep this separate from fast unit/integration checks.
2. Run DB-backed integration coverage and migration review against the merged contract, including search authorization, revision races, change replay, unread counters, retry/recovery behavior, and backfill resumability.
3. Run the larger load/performance matrix from the plan (20 conversations at 100k/200k messages and a 1M-message conversation), with concurrent searches, live writes, and backfill. Record latency, queue age, memory, index size, and write amplification; do not infer these results from unit tests.
4. Validate on physical low-end Android and the iPhone/Safari reference device, including long-scroll anchoring, account switching, offline cache limits, and lifecycle cleanup.
5. Confirm CI and deployment sequencing: migration rollout, worker role/capacity, feature flags and independent kill switches, canary coverage, and rollback to bounded cached search.

The local validation proves the focused code paths and workspace build contracts compile and pass their unit tests. It does not establish the scale, device smoothness, or production cutover gates above.

## Useful implementation entry points

- `packages/messages/` — shared message validation, crypto primitives, normalization, and search contracts.
- `apps/auth/src/worker/message-search-index.ts` — server indexing, durable outbox processing, and bounded backfill.
- `apps/web/src/app/api/messages/conversations/[id]/search/route.ts` — conversation-scoped search API.
- `apps/web/src/app/api/messages/conversations/[id]/search/count/route.ts` — separate exact-count state.
- `apps/web/src/app/api/messages/conversations/[id]/changes/route.ts` — durable change replay.
- `apps/web/src/lib/messages/` — client search, hydration, worker/offline cache, coverage, and cursor behavior.
- `apps/web/src/components/messages/` — search results, conversation transcript, and bounded viewport UI.
- `packages/db/prisma/contract.prisma` and `packages/db/prisma/migrations/app/` — the merged contract and migration history.
