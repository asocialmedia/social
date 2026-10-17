# Chat lifecycle implementation review

Date: 17 October 2026 · Workspace: `/home/haze/repos/social`

## Verdict

The other implementer's follow-up delivered the additive migration and much of the feature, but it was not sufficient for release. Review found functional blockers, incomplete media authorization and erasure, an unbounded request reader, export retry races, and client cache failures. These were corrected during this review and covered by additional tests.

The local implementation now supports the agreed DM and den lifecycle behavior. Local verification is recorded below. Production rollout, physical native devices, and deployed load/rollback validation remain release gates; this report does not certify those environments.

## Requirements and implementation

| Requirement | Current behavior |
| --- | --- |
| Delete chat | Per-member, monotonic snapshot cutoff; hides their inbox entry until new activity. Does not delete the peer's data or change den membership. |
| Export | Asynchronous private TXT + JSON ZIP; optional source-authorized media and date range. Rechecks current membership, readable epochs, clear state, source visibility and download authorization. |
| Normal auto-delete | Off by default. Newly accepted messages receive a database-clock deadline 24 hours later. Switching off preserves existing deadlines. Historical rows retain nullable expiry. |
| DM incognito | Separate transcript and charcoal UI, session-specific keys, fixed 24-hour session deadline; either participant can end it. Navigation does not end or extend it. |
| Closure | Reads deny ended/expired session content immediately. Bounded cleanup erases ciphertext, staged/linked media and derived content. Usage metadata remains permanently in normal chat. |
| Recovery | Existing automatic server-recoverable message keys and legacy recovery behavior preserved. This is not end-to-end encryption. |

## Findings corrected

### Privacy and data lifecycle

- Protected media access now runs before owner/public fallback, rejects orphaned sources, honors status, exact incognito session binding, clear cutoffs, hidden/deleted/expired source messages, den membership stints, and the viewer's own readable key scope after recovery.
- Processing status is available only to the uploader; processing bytes remain denied. Private posters and derivatives use private/no-store access.
- Linked normal message attachments are protected too, so a per-user clear cannot leave their media reachable through an owner fallback.
- Session cleanup also finds unlinked staged uploads. It scrubs names, OCR, transcript, captions, semantic metadata and hashes. Upload finalization and late scan/process/analysis results cannot revive erased content; late work re-arms durable deletion.
- Storage erasure includes HLS segments, playlists and originals. Successful deletion is marked complete; failures remain retryable.
- Timed native rows/previews are excluded from persistent message caches. Web normal drafts use bounded account-scoped memory instead of plaintext localStorage. Incognito content and drafts remain memory-only.

### Concurrency, bounds and failures

- Delayed clear retries cannot lower the cutoff, hide activity after the original confirmation boundary, or silently clear a newer snapshot.
- Start action IDs are idempotent across closure and reject collisions in another conversation. Session and normal-send timing uses the database clock.
- JSON requests are bounded while streaming, including absent or dishonest Content-Length. Incognito pages enforce row and byte limits.
- Existing normal content routes and streams enforce lifecycle capability after retention changes; unsupported clients get HTTP 426.
- Export attempts have unique lease tokens and object paths. Stale attempts cannot extend another attempt's lease or publish an artifact. Expiry cleanup scans the job prefix to remove interrupted attempt files, retaining the durable job on incomplete or failed storage deletion.
- Export download authorization is checked during streaming. Source media must actually belong to an included readable message.

### UI and cache defects found by acceptance

- Fixed text-only incognito sending: the attachment readiness check previously disabled every send without an attachment.
- Fixed the large-history decryption refresh loop: actual viewport requests and bounded background prefetch now use separate queue lanes.
- Fixed the flex sizing chain that pushed the normal composer approximately 14,000 pixels below a 1,000-pixel viewport.
- Fixed reopening a cleared conversation on a fresh browser: the saved-history worker must activate the account scope before clearing it.
- Active sessions reconcile every five seconds and require a recent server snapshot; a connected but stale socket cannot indefinitely authorize the UI. Snapshot sequence changes also refresh the transcript if a live event was missed.
- Added web prepend scroll compensation and native visible-content anchoring. Native older notice pages now survive ordinary snapshot polling.
- Corrected incognito control contrast, normal draft restoration, retry states, export polling bounds, and native temporary-file cleanup error handling.

## Database and preservation evidence

Both existing additive migrations remain unchanged:

1. `20261016T1605_chat_lifecycle_incognito` → `dc588b5862316269a4cadce0b8f36ac75b36a0ff6c0b602803658def6f509b33`
2. `20261016T1647_chat_lifecycle_followup` → `76f73e9aed637b2c3cf996b7a2caeed3a12268b684129d0402575e2f1c753eba`

Prisma 8 full database verification passed: live marker and schema match the second contract, with no schema warnings. This review introduced no schema change or destructive migration. Existing message expiry was not backfilled.

The new acceptance DM contained exactly 200,000 encrypted messages before testing. After a normal timed message and a new peer message, it contained 200,002 stored rows. Clearing the owner reduced their readable history to zero; the peer's original history remained. After new peer activity the owner could read that new message. Controlled deadline changes affected only the newly created test message/session.

No Git command, commit, reset, production migration or deployment was performed. Unrelated local edits were preserved.

## Automated verification

All listed results are local, successful runs with zero failed tests:

| Suite | Tests |
| --- | --: |
| Lifecycle, media, export, search mutation, durable changes and unread integration, local PostgreSQL | 35 |
| Existing route, crypto/recovery, reader-window, replay, shared media, native cache/crypto and media-worker regression files, isolated processes | 313 |
| Shared lifecycle/drafts and viewport/decryption regressions | 38 |
| Offline cache, worker core and worker client | 20 |
| Media OCR retry and protected-chat analysis | 2 |

Total: **408 passing tests**. Integration cases include concurrent send/end, actual ciphertext erasure, idempotent cleanup, den leave/rejoin media gaps, missing own epochs, staged media, fixed expiry, snapshot clear, authenticated ZIP output, unreadable export epochs, revoked scope, stale export leases, orphaned attempt files and storage failure retries.

Repository checks: `bun run check-types` passed all 12 workspace tasks. `bun run check` passed in an isolated copy, because its formatter and dangerous lint fixes otherwise rewrite unrelated local edits. Reviewed feature files also passed lint directly in the real workspace; no isolated dangerous autofix output was copied back in this final check.

## Browser acceptance

Local Chrome, isolated authenticated owner/peer contexts, existing local app/auth services, new 200k-message DM:

- Normal history decrypts with bounded rendering and visible composer.
- Shared incognito start, encrypted text send and peer receipt.
- Navigation/reopen preserves session identity and fixed deadline.
- Peer manual end removes temporary content from both screens; normal draft and permanent notice remain.
- Normal retention sets a server deadline; disabling it does not extend existing messages. Legacy content reader receives 426.
- Actual ZIP downloaded through local object storage. Opening it confirmed one retained normal message, three usage records and no incognito content.
- Controlled session timeout returns both participants to normal chat with the automatic-end notice.
- An already visible normal message disappears at its controlled deadline.
- 390 × 844 mobile web normal and incognito composers remain inside the viewport.
- Delete for me preserves notices and peer history. A fresh browser reopens the cleared chat successfully; new peer activity appears and restores the inbox entry.

A new den was also created through the UI with the same two test accounts. Owner retention control, disabled member retention control, absence of incognito actions, cross-member timed-message decryption, private export preparation and per-user clear all passed. The first creation attempt was correctly rejected by the peer's group-add policy; only these dedicated test accounts were made mutual followers for the successful run. Den fixture: `327c12c8-f469-45f7-8d46-1a6d1e907cd0`.

Screenshots are in [chat-lifecycle-evidence](./chat-lifecycle-evidence/). The mobile incognito capture records entry loading and composer placement; it is not evidence of native-device performance. Development-only overlays were hidden where they covered the composer. A long initial browser run logged Next development prerender timing errors and a navigation failure; the fresh-context clear regression was fixed and rerun successfully with no page errors. Do not represent the initial failed attempts as passing runs.

## Release validation still required

- Physical Android and iOS acceptance: keyboard/IME, background/resume, screen reader focus, memory pressure, native share/download, attachments and long incognito pagination. Native compilation, crypto and cache tests passed; a physical device was not available.
- Staging/production canary: worker and Redis outages, queue lag, expiry erasure delay, object storage failures, alerts, deployed capability rollout, recovery/account switches and rollback. Local functional tests do not establish production capacity.
- Validate production bucket policies and private object access, List/Get/Put/Delete permissions for export workers, derivative deletion, versioned-object retention and backup expiry. Configure an object-storage lifecycle rule for `private/chat-exports/` as defense against a process dying after an ambiguous late upload. No bucket policy was changed here.
- Preserve both migration packages and refs. Prebuild large-table indexes concurrently using the reviewed helper, then apply the reviewed migration path and verify each environment. Never reset a populated database.
- Keep lifecycle and media-erasure workers running during application rollback. Do not roll back to readers that ignore persisted deadlines or clear cutoffs, and do not remove the capability gate.

## Operations

`CHAT_LIFECYCLE_QUEUE` is `chat-lifecycle`; `CHAT_EXPORT_QUEUE` is `chat-exports`. Both maintenance schedulers run every five seconds in the normal auth worker. The dedicated search-only worker does not consume these queues. Normal/incognito reads enforce expiry independently of worker availability; storage and database erasure continue through durable bounded retries.

Monitor cleanup backlog age, oldest expired unpurged session, pending media erasure, export processing/lease age, sanitized failures, database lock time and queue availability. Do not log plaintext, ciphertext, credentials, keys, raw queries or object bodies. A failed export cleanup retains its job for retry; a failed media erasure retains denial metadata.
