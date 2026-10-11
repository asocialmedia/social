# DM history and search: production verification

Review date: 2026-10-10. Repository: `/home/haze/repos/social`. Branch: `feat/messages-wallpaper-prisma8`.

## Verdict

The implementation blockers from the 2026-10-09 review are fixed, and the primary unit, integration, large-database, and requested browser checks pass. The DM history/search implementation is complete for the agreed code scope. It is **not yet production-release certified** because the physical low-end Android and iPhone/Safari gates, deployed canary/rollback checks, and live production indexing-lag measurements have not been run.

This distinguishes implementation completion from release qualification. The local database results below are strong evidence for query/index scale; they do not establish mobile frame time or heap limits.

## Closed review findings

| Finding from the 2026-10-09 review | Resolution |
| --- | --- |
| Deterministic BullMQ job IDs were dropped | `4c9b2d79` forwards the ID through queue options and adds adapter tests. |
| Settled partial coverage blocked readable-result pagination | `5c4712e5` follows server cursors independently of complete coverage and keeps exact counts unavailable until settled. |
| Poisoned outbox rows could starve newer work | `12f09256` adds durable bounded attempts, a fair runnable-work query, and repair backlog signaling. |
| Inactive conversation history caches accumulated | `424bd11c` evicts inactive message-history queries; the switch test now asserts the retained bound. |
| Backfill-outbox jobs were dispatched as conversation jobs | `50b91614` routes the job name and validates the payload, with dispatcher tests. |
| Repository lint failed on the scratch route test | The scratch lint issue was corrected in the checkpoint commit `823bc50b`. |

The original source findings remain in [the 2026-10-09 review](./dm-production-verification-2026-10-09.md) as a historical baseline; they are closed, not outstanding.

## Verification completed

| Check | Result |
| --- | --- |
| Full unit/integration suite: `bun run test` | Passed: 5,572 passed, 4 skipped, 0 failed across 541 files; 71,473 assertions. |
| Repository lint/format and type checks | Passed through the repository commit hooks on the implementation commits. |
| Search, queue, partial-coverage, worker-repair, cache-lifecycle, and backfill-dispatch focused tests | Passed, including the regressions for all findings above. |
| 20 conversations × 200,000 messages database workload | Passed; detailed results below. |
| One 1,000,000-message conversation database workload | Passed; detailed results below. |
| Browser-created 200,000-message DM | Passed; server backfill completed, rare and broad search returned pages, selection jumped into the transcript, and the matched text was highlighted. |

Four full-suite skips are expected: one opt-in scale test, two Gemini API tests, and one den browser-background acceptance test. The standalone DM scale profiles were run separately.

### Production-shaped database workloads

The 20 × 100,000 profile was not repeated. The 20 × 200,000 run uses the same conversation count and doubles the per-conversation history, so it is the stronger multi-conversation load for this implementation. The separate 1M-message profile exercises the largest single-conversation shape.

| Profile | Seed throughput | Fresh index size | Search concurrency | Broad query p95 | Rare query execution | Exact count | Failures |
| --- | --: | --: | --: | --: | --: | --: | --: |
| 20 × 200k (4M messages) | 5,293 rows/s | 944,160,768 bytes for 4,000,040 documents (~236 bytes/document) | 50 searches plus 40 live index writes | 153 ms | 1 ms | 10,021 ms | 0 |
| 1 × 1M | 4,947 rows/s | 235,765,760 bytes for 1,000,040 documents (~236 bytes/document) | 50 searches plus 40 live index writes | 237 ms | 4 ms | 49,910 ms | 0 |

Both runs completed backfill and cleaned their temporary fixtures. Exact counts were deliberately asynchronous and substantially slower than first-page search; results remained independently available. These are PostgreSQL measurements on the local test environment, not production infrastructure guarantees. They do not include a 50-client run through browser hydration, physical-device memory, or a continuous encrypted-send workload.

### Browser acceptance: fresh 200k DM

The browser flow used the local `dmsearchowner` account and a new conversation created through the app UI with the identity-enabled synthetic account `Perfectgoose` (`seed-user-0`). The user-visible conversation is:

`http://localhost:3000/messages?c=808d6570-f9d0-41f4-9fc1-b4ac34dc3978`

The `Browser history fixture bootstrap.` message initialized the conversation key through the normal composer. The seeder then added 200,000 authenticated ciphertext messages, giving the conversation 200,001 total messages. The script verified root-key recovery and decrypted samples from both sender ratchets. Server backfill traversed 200,001 source rows and committed 200,001 search documents, with zero unreadable messages and zero unrecoverable epochs.

Browser observations:

- Opening the conversation rendered a bounded recent transcript window; it did not load the 200,001-message archive into the page.
- While backfill was incomplete, searching `obsidiancascade` returned hydrated result pages and displayed “Searching older messages…” rather than a false empty state. Pagination remained available while coverage was partial.
- Selecting a result moved the transcript to that message; next-match navigation moved to another match. The search term was highlighted in the result list.
- After coverage completed, the same rare query returned a 20-result page with 264 pages. The independent count job reached `exact` with 5,274 matches.
- A broad `index` search returned paginated results while backfill ran; the UI did not block transcript reading on full-archive hydration.

This was desktop in-app browser acceptance with local services. It is functional UX evidence, not a mobile performance test. The browser was left on the verified DM result view. The server-search flag is enabled in the local ignored `apps/web/.env.development.local` test configuration.

## Remaining release evidence

These are the remaining gaps against the agreed production release gates:

1. Measure on a physical 4 GB Android phone at 60 Hz and an iPhone/Safari reference. Record device and browser versions, 100 ms RTT / 10 Mbps conditions, input-to-paint, first-result and jump latency, dropped frames, anchor drift, added heap, and 100-conversation-switch lifecycle.
2. Measure live indexing p95/p99 lag, worker memory, queue age, retry/repair volume, and reconciliation behavior under sustained concurrent encrypted sends and backfill on production-shaped infrastructure.
3. Exercise deployed feature flags, internal/heavy-user canaries, kill switches, and rollback in the target deployment environment.
4. Run the exact 20 × 100k fixture only if the release owner requires each matrix point independently; it was skipped as redundant with the same 20 conversations at 2× per-conversation history.

Until items 1–3 pass, the honest status is **implementation complete; production release gates still open**. Do not claim the stated mobile latency, memory, or frame-rate budgets are proven from the database or desktop-browser runs.

## Test fixture account

The local test owner account is `dmsearchowner` (`dm-search-owner@asocialmedia.local`). Its password is documented in the test fixture script, not duplicated in this audit artifact. The generated DM and all seeded messages are local development data.
