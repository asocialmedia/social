# Chat deletion, export, expiry, and incognito sessions

Status: implementation plan updated with the confirmed incognito-session behavior, 16 October 2026. Scope: delete/export/24-hour retention for existing DMs and dens on web and mobile; incognito sessions for DMs.

## Recommended product behavior

Existing history stays permanent unless a user explicitly deletes their own copy or a den owner dissolves the den. New retention settings default to off and apply only to messages accepted after the setting changes. Permanent incognito-usage notices are separate system records and are exempt from ordinary chat clearing and retention settings.

| Feature | DMs | Dens |
| --- | --- | --- |
| Delete chat for me | Clear my visible history and remove the chat from my inbox. The other person's history remains. | Clear my visible history and remove the den from my inbox. My membership and everyone else's history remain. |
| Export chat | Download the retained history I can currently read. | Download only my readable membership periods and key epochs. Being an owner does not expand access. |
| Auto-delete: 24 hours | Either participant can change the setting after confirmation. New messages expire for both people 24 hours after the server accepts them. | Owner or admin can change the setting. New messages expire for all readers 24 hours after the server accepts them. |
| Incognito session | Switch the DM to a separate incognito view. Either participant can end the shared session. It ends automatically 24 hours after starting. All its messages are deleted when it ends; a permanent usage notice remains in the normal chat. | Outside the initial incognito scope. Delete, export, and regular 24-hour retention still apply to dens. |

Incognito is a conversation session with one fixed deadline: `startedAt + 24 hours`. Every message in that session is deleted together when either participant explicitly exits or the deadline arrives, including unread messages and messages sent shortly before the deadline. Reading, sending, editing, reconnecting, and reopening the app never extend the session.

Regular 24-hour auto-delete measures each normal message from sending. Incognito has one shared session deadline and a manual end action. Its content is separate from the normal transcript, and the normal conversation's retention preference resumes unchanged afterward.

## Delete chat

Use the explicit action label **Delete chat for me**. The confirmation explains that it clears this account's history across devices, keeps other members' copies, and permits new messages to bring the conversation back. Offer Export chat before confirmation without requiring an export.

Deleting a den chat does not leave the den. Keep **Leave den** and the existing owner-only **Dissolve den** as separate actions. A former member can delete their retained den history too; a dissolve remains a different destructive operation affecting everybody.

Implement deletion with a per-member history cutoff and inbox visibility state rather than inserting a hide row for every historical message. Capture the cutoff atomically with the conversation sequence so a simultaneous new message is neither lost nor incorrectly cleared. Include an explicit path for legacy messages whose `creationSequence` is zero.

The cutoff applies to ordinary history pages, list previews, search and counts, shared media/posts/links, replies, exports, batch hydration, direct message links, and unread counts. It persists through reloads, account recovery, den rejoin, and login on a new device. Permanent incognito-usage records bypass this content cutoff: hiding the conversation can remove it from the inbox, but reopening it still shows the usage record. These records have no ordinary delete action. Keep membership, identity recovery, conversation key wraps, and monotonic ratchet counters intact. Clearing normal chat history is account-scoped removal from view, not erasure of another participant's message data.

If Delete chat for me is invoked during an active incognito session, require the shared session to be ended explicitly first. Clearing normal history must not conceal or implicitly change the active session's lifecycle.

## Export chat

Provide a ZIP containing `chat.txt` and `chat.json`, with an optional owned-media folder and an optional date range. Include participant names, timestamps with timezone metadata, edits, reply relationships, and export scope. Use explicit placeholders for unreadable historical key epochs rather than failing an entire export or resetting an identity.

Export only messages the requesting account can currently access. Exclude hidden or cleared history, messages deleted for everyone, expired messages, and all incognito-session messages, including while a session is active. Include permanent incognito-usage notices as system records with actor, start/end times, and end reason, without message content. Regular messages with a 24-hour lifetime can be exported while accessible. A downloaded copy can remain after the original expires; explain this alongside the retention setting.

Generate exports asynchronously in bounded pages with stable sequence and keyset boundaries. Record requester, conversation, snapshot boundary, visibility/recovery scope, requested options, and progress. Decrypt in the authorized server job using the existing recoverable key system; no new key scheme is needed. Never log message content, keys, or job payloads containing content.

Store generated files privately, authorize every status/download request, and use a maximum download lifetime of one hour, shortened to the earliest expiry of included messages. Revalidate deletion, visibility, membership, and source revisions before publishing or serving the result. Revoke/regenerate an export when those permissions change, and delete expired artifacts. Use an attachment manifest, size limits, cancellation, and safe filenames; do not fetch arbitrary URLs supplied in message text.

## Regular auto-delete

Maintain a server-controlled normal-conversation retention policy: keep messages or expire 24 hours after sending. Version each policy change and record a visible system event with the actor and effective boundary. Incognito sessions are separate lifecycle records and do not overwrite this setting.

Stamp each accepted normal message with its policy/version and deadline metadata. Turning a setting off never revives expired content or cancels deadlines on messages already sent. Editing, retrying a send, changing devices, and changing membership never restart an existing deadline. A retry with the same client message identity must retain the original policy and timestamps. Existing normal-message deadlines continue to run while the participants use incognito.

## Incognito session behavior

### Enter and chat

The DM details/menu exposes **Start incognito**. A confirmation explains that the session ends when either person exits or 24 hours after starting, all session messages are deleted together, and a permanent usage notice remains. Either DM participant can start the session. Starting is one shared conversation action, visible to both accounts across their devices; it is not a device-only preference.

Switch to a visually distinct incognito transcript: a dedicated subdued palette, explicit incognito icon and title, persistent remaining-time badge, clear explanation, an incognito composer placeholder, and a visible **End incognito** action. Use more than color to distinguish the mode and keep controls accessible in either app theme. Build this with the existing raised-surface primitives and class-based theme rules. Normal history stays outside this view and is restored when the session ends.

Only one incognito session can be active in a DM. Starting concurrently on two devices returns the same session. Incognito message queries and subscriptions are scoped by session ID as well as conversation and participant. New sends during an active session must acknowledge that session; a device still showing the normal composer must switch before it can send. Keep normal and incognito drafts separate.

Working navigation rule: returning to the inbox, closing a browser tab, or backgrounding the app does not end the shared session. Reopening resumes the active session. **End incognito** is the explicit manual termination action; otherwise the fixed deadline ends it. This avoids relying on unreliable disconnect signals to delete both participants' messages.

### End and erase

Either participant can select **End incognito** and confirm **End and delete messages**. Ending applies to both people on all devices. At the fixed 24-hour deadline, the server ends the session even if both people are offline. The lifecycle is `active → ended`, with the end reason recorded as manual or timeout. An effective timeout must deny content access even before a background worker has persisted the ended state.

Ending atomically closes the session, records who ended it or that it timed out, updates the permanent usage notice, and commits durable cleanup work. Immediately deny every session message, attachment, history page, and pending send. Remove active session content from clients, cancel outstanding decrypt/fetch work, clear incognito drafts, and return to the normal DM. Erase ciphertext and owned-media references in bounded retryable cleanup jobs. Unread messages have the same deletion behavior as read messages.

Every send carries the expected conversation policy version and incognito session ID/version. Starting or ending a session serializes with message acceptance. A send accepted before closure belongs to that session and is erased with it. A stale send arriving after closure is rejected; never retry it into the normal transcript automatically. Edits, failed retries, queued uploads, and delayed notifications cannot reopen a session or extend its deadline. Starting again creates a new session and a new permanent usage notice.

Incognito messages are excluded from export, forwarding into normal chats, permanent pins/saves, persistent search indexes, shared-content galleries, and notification text previews. In-session replies may refer only to that same session; copying quotes into normal messages must not be an app feature. Attachments remain viewable inline only while the session is active. Ordinary message history and its encryption keys are unaffected by erasing a session. The app cannot revoke a screenshot or an external copy somebody already made.

Avoid persistent device caching of incognito content. Require online session freshness to display it; remove it from view when freshness is unavailable. Regular 24-hour messages can remain in the normal cache only while their known deadline is valid. On restart, verify freshness before exposing an uncertain expiring cache.

Gate timed-message reads, streams, batch hydration, and sends on client capabilities. Older clients must receive an upgrade-required response, and existing unsupported streams must be closed before incognito content is delivered. This avoids waiting for every disconnected device to update while preventing old clients from treating session content as normal history.

### Permanent notice in the normal chat

Create a permanent system card when the session starts and finalize it when the session ends. Both participants see it in their normal chat. Example content: **Alex started an incognito session with Sam**, followed on completion by **Ended by Sam · 16 October, 6:40 PM** or **Ended automatically after 24 hours**. Include start/end timestamps and participant/actor identity snapshots so the record explicitly identifies who used the mode. Preserve only lifecycle metadata, never message snippets, attachment names, decrypted text, or content-derived summaries.

Store this card outside deletable message content. It is not subject to normal 24-hour retention, incognito cleanup, individual-message deletion, or Delete chat for me's history cutoff. Reopening the DM, recovering an account on a fresh device, and starting a later session must not remove it. Each session has one durable usage record, with idempotent creation/finalization so retries do not duplicate cards. It can be included in normal-chat exports as a system event. This product-level permanence does not require retaining a whole conversation after an account is deleted; broader account-deletion behavior remains separate.

## Required architecture changes

The existing implementation provides individual message hides/deletes, membership history, key epochs, durable conversation changes, search outbox processing, and unread state. Four gaps need dedicated work:

1. Whole-chat clearing has no member-level visibility cutoff. The existing hide endpoint accepts specific message IDs and is not suitable for clearing a large history.
2. Messages have `deletedAt` but no retention policy or expiry. The current delete mutation marks a row deleted while retaining ciphertext; expiry requires content erasure as well as visibility enforcement.
3. There is no shared incognito-session lifecycle or permanent usage-card record. Session identity, fixed deadlines, cross-device transitions, and content-independent notices need durable server state. Viewing receipts do not control session expiry.
4. Uploaded message media is linked to a conversation. The byte-serving gate checks membership, so expiry requires authoritative message-to-media references and message visibility checks.

### Data and APIs

Add member clear/inbox state; versioned normal-conversation retention settings/events; incognito session state; message policy/expiry/session identity; authoritative message-attachment references; permanent incognito usage records; and export job/artifact metadata. Reuse the existing change stream and durable outbox for invalidation and cleanup delivery. No new viewing-receipt storage is required for incognito expiry. Exact contract names should follow the package's existing conventions.

The session record needs conversation and participant scope, start actor/time, fixed expiry, lifecycle version, effective end time, end actor/reason, and cleanup progress. Keep the permanent usage record available independently of transient content and cleanup state. Index active sessions by deadline and messages by session ID; enforce at most one active session per DM.

Add conversation-scoped actions for clearing a chat, changing normal retention, starting/getting/ending an incognito session, and requesting/checking/downloading exports. Session start/end actions are authenticated and idempotent; message sends and reads carry the session scope. Enforce authentication, membership windows, key readability, blocks, current roles, rate limits, idempotency, and expected versions on the server. Former den members retain only the historical capabilities currently granted to them; they cannot change a den's settings. Do not hide active-session metadata needed by a participant to terminate it when ordinary message delivery becomes blocked.

Make one visibility policy authoritative across API reads, search hydration and exact counts, shared references, unread calculation, export selection, direct media delivery, notifications, and background jobs. Normal content uses its message deadline and member cutoff; incognito content additionally requires the matching session to be active and before its fixed deadline. Permanent usage cards use a separate system-event path that is exempt from message expiry and the ordinary history cutoff. Den authorization must intersect regular expiry and the member cutoff with the existing membership windows and readable epochs.

### Expiry and erasure

Use server time and persisted deadlines. Queries must deny expired content or any content in an ended incognito session immediately, even while the cleanup worker is stopped. Clients remove visible expiring content at its deadline and reconcile on foreground/reconnect. Incognito reads require online session freshness; do not rely on a disconnected device eventually receiving an end event.

Indexed database sweeps claim due normal messages, automatically end overdue incognito sessions, and drain content-erasure work in bounded batches. Queue jobs are delivery hints backed by durable database work; retry and periodic reconciliation repair lost jobs. Deduplicate session transitions, permanent-card updates, mutation, unread, notification, and media effects. Keep cleanup load isolated from live search and message delivery. BullMQ's delayed jobs are not guaranteed to run at the exact requested time, so they cannot enforce the access deadline by themselves.

Record revisioned deletion/expiry/session-end events transactionally, erase ciphertext and derived search terms/references, invalidate previews/replies/count snapshots, cancel unsent notifications, and revoke affected export artifacts. Retain only the minimal tombstone/change information needed for synchronization and to prevent stale jobs from restoring content, plus the explicitly permanent incognito usage records. Preserve sequences, key epochs, and ratchet counters required by surviving messages.

Attach media to messages during the send transaction instead of relying on eventually built search references. All media routes, variants, thumbnails, downloads, and status responses must enforce a currently visible source message. Expiring media cannot use a cached conversation-membership decision as its entire authorization check. Delete originals and derivatives only after the last live authorized reference is gone; never remove an original public post merely because a chat shared it.

Capture storage cleanup work durably before deleting metadata. Initial operational targets should be content inaccessible at its deadline, database content purge p99 within 60 seconds, and owned-media removal p99 within five minutes under normal service. Measure those targets before promising them publicly; alert on overdue work and recover after outages. Existing backup retention must be documented, and any restore must reapply deletion/expiry records before serving traffic. Do not promise instant erasure from backups or recipient-created screenshots/downloads.

The encryption model stays server-recoverable. Preserve automatic recovery from stored identity rows, the legacy device-secret compatibility attempt, and account-scoped lost-key resets. Expiry must erase content rather than deleting a shared key epoch that still protects permanent messages.

## Delivery sequence

| Stage | Deliverable | Completion evidence |
| --- | --- | --- |
| 1. Shared foundation | Product semantics, additive contract, common visibility policy, policy versioning, attachment references, compatible clients | Existing history and recovery unchanged; migration reviewed; reads/search/media enforce the same policy |
| 2. Delete and export | DM/den clear actions and bounded export jobs on web/mobile | A clear remains effective across devices and new-message races; export contains only authorized retained history |
| 3. Regular 24-hour expiry | Server deadlines, erasure worker, cache reconciliation, timer UI | Deadline enforcement holds with stopped workers, lost Redis jobs, offline clients, stale URLs, and failed storage deletion |
| 4. Incognito sessions | Distinct DM view, shared start/end state, fixed 24-hour deadline, content erasure, permanent usage cards, export/cache restrictions | Either participant can end for both; timeout works offline; all session content becomes inaccessible at closure; notices survive ordinary deletion/retention; no stale sends enter normal history; web/mobile parity |
| 5. Release | Scale tests, staged enablement, monitoring and rollback runbook | Purge and latency targets measured; compatibility gates and deletion-safe rollback exercised |

Ship delete/export before enabling automatic erasure. Enable regular 24-hour expiry before incognito sessions because it proves the common expiry and media machinery. Incognito is complete when its distinct DM interface, shared lifecycle, permanent notices, and web/mobile behavior pass the same release gates. Dens retain the three original actions; an incognito extension for dens requires its own product decision.

## Migration, verification, and rollout

Use the repository's Prisma 8 contract-first workflow. Add fields with permanent/off defaults and nullable deadlines; do not assign expiry to old messages. Emit and review replayable migration packages for shared environments, prebuild any large-table indexes concurrently as the repository requires, and verify the resulting contract. Do not reset the database or rewrite applied migration history.

Deploy readers, caches, media gates, and compatible clients before enabling timed messages. A rollback can disable new timer settings while continuing to enforce and erase messages with existing deadlines. Never switch back to a reader that exposes expired messages.

Required coverage includes clear-versus-send races, legacy sequence-zero rows, search/shared/export authorization, den leave/rejoin windows, all key-recovery invariants, expired attachment URLs, duplicate jobs, read/edit/delete races, worker/Redis outages, unread reconciliation, export cancellation and revocation, media reuse, policy changes while composing offline, multiple devices/tabs, restarts, and clock changes. Incognito coverage must include concurrent starts, duplicate ends, end-versus-send races, a message sent immediately before timeout, unread messages at closure, reopening an active session, a fresh session after closure, blocked participants ending a session, unsupported old clients, revoked media URLs, surviving normal messages, and a permanent usage card surviving normal 24-hour retention and Delete chat for me. Include large histories and large dens; export memory and expiry batches must not grow with entire conversation size. Run the required repository formatting/type checks and targeted unit, database integration, web, and mobile acceptance checks during implementation.

## Confirmed incognito requirements and remaining assumptions

Confirmed: incognito changes the DM interface; participants chat inside that separate mode; manual exit or 24 hours from activation ends it; all session messages are deleted together; an explicit permanent usage notice remains in the normal chat.

Implementation assumptions: either DM participant may end the shared session for both; navigation/backgrounding is not an explicit exit; permanent usage cards are exempt from Delete chat for me as well as retention; and the incognito release targets DMs. Normal delete-for-me semantics, manager-only den retention controls, and TXT/JSON ZIP export remain the recommendations for the other requested features. The earlier viewing-based timer and seven-day unread maximum are superseded by the fixed 24-hour session deadline.

## Source pointers

- [Database contract](/home/haze/repos/social/packages/db/prisma/contract.prisma)
- [Current visibility helpers](/home/haze/repos/social/packages/db/src/messages/access/visibility.ts)
- [Individual message hide endpoint](/home/haze/repos/social/apps/web/src/app/api/messages/conversations/[id]/hide/route.ts)
- [Current soft-delete SQL](/home/haze/repos/social/packages/db/sql/messages/message-mutations.sql)
- [Media membership authorization](/home/haze/repos/social/apps/web/src/lib/media/message-media-access.ts)
- [Message attachment discard assumptions](/home/haze/repos/social/apps/web/src/app/api/media/[mediaId]/message-discard/route.ts)
- [Messaging architecture and recovery requirements](/home/haze/repos/social/packages/messages/AGENTS.md)
- [Worker scheduling](/home/haze/repos/social/packages/db/queue.ts)
- [BullMQ delayed-job timing](https://docs.bullmq.io/guide/jobs/delayed)
- [Prisma 8 migration architecture](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md)
