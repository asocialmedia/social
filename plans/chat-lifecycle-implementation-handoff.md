# Chat lifecycle implementation handoff

Updated: 17 October 2026, after review and local acceptance.

## Current status

The other implementer's follow-up was reviewed against the [product plan](./chat-lifecycle-and-temporary-chat.md). It was not sufficient as submitted: privacy, retry, cache and visible UI defects remained. Those defects were corrected in the current workspace. See the [review, findings and verification report](../audits/chat-lifecycle-review-2026-10-17.md) for evidence and release limitations.

**Implementation and local verification are complete. Production release validation remains.** Do not describe the feature as deployed or certified on native devices. No Git commands, commit, production migration or deployment were performed during this review. Preserve unrelated local edits.

## Product contract

- Delete means **Delete chat for me**. A monotonic per-member snapshot cutoff hides that account's history and inbox entry until new activity. Peers' copies and den membership remain.
- Export is an asynchronous private TXT + JSON ZIP, optional date range/media, limited to currently readable retained source messages. Incognito content is excluded; permanent usage metadata is included. Artifacts expire within one hour or at the earliest included timed-message deadline.
- Normal auto-delete is off by default. Enabled policy assigns newly accepted normal messages a database-clock deadline 24 hours later. Policy changes do not backfill, revive or extend existing messages.
- Incognito is a shared DM session with a separate transcript, charcoal UI and session-specific keys. Either person ends it, or it ends at its fixed 24-hour deadline. Navigation/backgrounding does not end or extend it.
- End/expiry denies session reads immediately; bounded workers erase text, linked/staged attachments and derived metadata. Durable usage cards retain actors, start/end times and reason, including after Delete chat for me and normal retention.
- Keep the existing automatic server-recoverable keys and legacy recovery behavior. This is not end-to-end encryption.

## Database state

Both additive migrations were already applied locally by the previous implementer and were independently verified during review:

| Migration | Destination contract |
| --- | --- |
| `20261016T1605_chat_lifecycle_incognito` | `dc588b5862316269a4cadce0b8f36ac75b36a0ff6c0b602803658def6f509b33` |
| `20261016T1647_chat_lifecycle_followup` | `76f73e9aed637b2c3cf996b7a2caeed3a12268b684129d0402575e2f1c753eba` |

The live local marker, emitted contract and `db` ref match `76f73…`. Full Prisma verification passed with no schema warnings. This review did not alter the schema or applied migration files. Old messages retain nullable expiry; no destructive reset or expiry backfill occurred.

Before any further database work, read `packages/db/AGENTS.md`, `packages/db/.devin/skills/prisma-8/SKILL.md` and the Prisma 8 migration architecture. Use contract-first migration planning, review generated operations and preserve hashes/refs. Never use Prisma 7 migration/reset assumptions.

`packages/db/src/messages/prebuild-lifecycle.ts` prepares nullable columns and concurrent indexes, including optional tables that may not exist before the first migration. Exact physical index names include `messages_lifecycle_erasure_due_7f300049`, `incognito_purge_due_618ec377`, `media_lifecycle_erasure_due_d202ba84`, and `post_media_incognitoSessionId_idx_e9d021b8`. Validate index readiness before deploying the migration path on populated environments.

The previous implementer excluded generated migration source from `packages/db/tsconfig.json` because the installed Prisma runtime types reject the generated `addForeignKey` operation type (TS2883). MigrationCLI executes those framework-generated sources; do not hand-edit them to suppress that mismatch.

## Code map

| Area | Main files |
| --- | --- |
| Shared DTOs, deadlines, session HKDF, draft bounds | `packages/messages/src/lifecycle.ts` |
| Shared membership stints | `packages/messages/src/reader-window.ts` |
| Policy, clear, sessions, send locks, media authorization | `packages/db/src/messages/lifecycle.ts` |
| Bounded erasure, staged uploads, metadata scrub | `packages/db/src/messages/lifecycle-cleanup.ts` |
| Export scope and leases | `packages/db/src/messages/chat-export.ts` |
| ZIP/AES processing, private storage and cleanup | `packages/db/src/messages/chat-export-worker.ts` |
| Normal read visibility/search/unread | `packages/db/src/messages/access/visibility.ts`, message SQL readers and search/unread modules |
| Scheduling | `packages/db/queue.ts`, `apps/auth/src/worker.ts` |
| Physical media erasure and late processing | `apps/media-processing/src/jobs/delete-cascade.ts`, `scan.ts`, `process.ts`, `analyze.ts` |
| Web boundary/actions/incognito | `apps/web/src/components/messages/chat-lifecycle-context.tsx`, `chat-lifecycle-tools.tsx`, `incognito-thread.tsx` |
| Web normal expiry, drafts, virtualization | `message-thread.tsx`, `message-composer.tsx`, `conversation-list-item.tsx`, `apps/web/src/lib/messages/viewport-decrypt-plan.ts` |
| Fresh-browser clear | `apps/web/src/lib/messages/offline-search-worker-client.ts` |
| Capability and streaming request bounds | `apps/web/src/lib/messages/chat-capability.ts`, `bounded-json.ts` |
| APIs | `apps/web/src/app/api/messages/conversations/[id]/{lifecycle,incognito,exports}` and normal readers/stream |
| Media access | `apps/web/src/lib/media/message-media-access.ts`, `media-access.ts`, upload/finalize and media serving routes |
| Native UI | `apps/mobile/src/features/messages/components/{chat-lifecycle-context,chat-lifecycle-tools,incognito-thread,message-composer,message-thread-screen}.tsx` |
| Native expiry/cache/drafts | `apps/mobile/src/features/messages/state/`, `lib/transcript-rows.ts`, `lib/incognito-crypto.ts` |

## Review corrections to preserve

- All newly linked chat media is lifecycle-protected. Den gaps, own epoch readability, exact session binding, hidden/cleared/expired sources and orphan denial must remain effective before owner/public fallback.
- Processing status is uploader-only; processing bytes are denied. Late processing must re-arm durable cleanup, including metadata and HLS segments.
- Clear is snapshot-bounded, monotonic and retry-safe. Start action IDs remain idempotent after session closure and reject cross-conversation reuse.
- JSON limits apply while reading the stream. Incognito pages are bounded by bytes and rows.
- Export heartbeats and publication require the same attempt token. Prefix cleanup removes orphaned attempts and preserves a durable retry record when storage fails or a bounded batch is incomplete.
- Web normal drafts use bounded account-scoped memory. Timed native ciphertext/previews are excluded from disk caches. Incognito plaintext never enters normal saved history/search/notifications.
- Active sessions poll every five seconds and require a snapshot younger than seven seconds. A session sequence change refreshes content even if Redis delivery was missed.
- Text-only incognito messages must remain sendable. The attachment helper's readiness result is false for an empty attachment list; do not use it as an unconditional send requirement.
- Visible decryption uses the urgent lane; neighbor prefetch uses the background lane. Combining them caused a large-history render loop.
- Preserve the minimum-height chain in `client-messages.tsx` so large transcripts do not push the composer outside the screen.
- A fresh offline worker must activate the account scope before clearing saved history. The boundary waits for this purge before mounting normal content.
- Native older notice pages survive snapshot polling. Web/native prepend behavior preserves reading position.

## Verification completed

- **408 passing tests** across database integration, route/crypto/recovery/cache regressions, shared lifecycle/decryption, offline workers and media analysis. See the review report for suite breakdown.
- Root `bun run check-types`: all 12 workspace tasks passed.
- Root `bun run check`: passed in an isolated source copy; reviewed source files also passed lint directly. The root script formats and runs dangerous fixes, so do not run it over unrelated local work without protecting that work.
- Prisma full schema/marker verification passed.
- Two-account browser acceptance with a new DM seeded with **200,000 encrypted messages**: shared start/send/end, navigation, draft restoration, permanent notices, fixed normal retention, capability denial, real ZIP download, controlled timeout, normal deadline removal, 390px mobile web, per-user clear, reopening and new peer activity.
- A newly created test den also passed owner/member retention permissions, absent incognito actions, timed message decryption, export preparation and per-user clear.
- After clear/new activity, the fixture retained **200,002 stored rows** and the owner could read only the newly arrived peer message. The original peer history was preserved.

`scripts/testing/seed-chat-lifecycle-acceptance.ts` creates only the dedicated local test accounts/DM and requires `--apply`. It refuses non-local databases and reuses an existing matching fixture without resetting it. Message seeding uses the existing `scripts/seed-dm-history.ts`. Never point either fixture script at production or clear real conversations for acceptance.

The test fixture conversation is `1c76501b-c387-48f1-a733-402d55dac834`; test usernames are `lifecycleownerebee9b40` and `lifecyclepeerebee9b40`. Credentials and browser session files were not committed into the evidence directory. The fixture intentionally now contains clear cutoffs, usage records and timed test content; rerunning its setup does not reset those facts.

## Remaining release work

1. Run physical Android/iOS acceptance, especially IME/keyboard, foreground/offline transitions, screen reader focus, native media/share/export and long pagination. Compilation and native crypto/cache tests passed locally; physical-device UX has not been claimed.
2. Deploy to staging with reviewed migrations and concurrent index prebuild. Verify schema/marker, private storage, capability rollout, queue consumption, storage erasure and canary behavior.
3. Exercise worker/Redis loss, retries, deployed queue age and resource growth under load; validate alerts and rollback. The normal auth worker must consume `chat-lifecycle` and `chat-exports`; search-only workers do not.
4. Verify production object permissions, versioned-object/backup retention and a bucket expiry rule for `private/chat-exports/` to catch ambiguous late uploads after process death. Local real-object-store export passed; no production bucket configuration was changed.
5. Preserve expiry-aware readers, capability gates, migrations and erasure workers through rollback. Never re-enable a client/server path that ignores persisted deadlines or cutoffs.

No further local schema migration is pending for this feature. Do not recreate the follow-up migration or treat the old handoff's completed tasks as outstanding implementation work.
