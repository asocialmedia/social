# Global message search on /messages

Date: 18 October 2026. Status: implemented and locally verified; staged rollout still needs broader load and device acceptance.

## Scope and decisions

Add account-wide message-content search to the existing `/messages` page. Search the viewer's readable normal-message history across DMs and dens, including conversations beyond the currently loaded inbox page. Preserve in-conversation search and the existing people-search flows.

The proposed first release is online global search. Global offline search, conversation-title search, sender/date filters, relevance sorting, attachment-content extraction, and exact global totals are follow-up work. Offline global search displays an explicit connection-required state; existing conversation-scoped saved-history search remains available. These are planning defaults, not additional requirements supplied by the user.

## Findings from the current implementation

| Existing piece | Implication |
| --- | --- |
| `apps/web/src/components/messages/conversation-list.tsx` searches people after a 250 ms debounce. | Run profile lookup alongside global message search and present both result types in one results surface. |
| `GET /api/messages/search` is used by recipient, share, and den pickers. | Preserve this endpoint and its existing follow/group eligibility rules. |
| The conversation-list API returns pages of 20 conversations. | Global search must discover its scope on the server, independently of the loaded list. |
| `POST /api/messages/conversations/[id]/search` already provides indexed history search, signed keyset cursors, coverage, and optional asynchronous counts. | Reuse matching/indexing contracts; introduce a separate cross-conversation query. |
| Search documents and terms are scoped by conversation; sequences are also conversation-local. | Removing a `conversationId` condition or taking the largest sequence cannot produce a correct global search. |
| `MessageThread` has an internal `jumpToMessage` that loads an anchored history window and flashes the target. | Expose a small navigation input and reuse this path. The page currently passes only a conversation ID. |
| The page automatically collapses its sidebar when selecting a conversation. | Search-result selection needs a distinct navigation path that keeps desktop results available. |
| Former den members retain readable history within their membership windows. | An active-members-only search would incorrectly omit accessible messages. |
| Normal history is replaced visually by an active incognito session. | A normal-history result needs an explicit unavailable-until-session-ends state in this case. Never end a session as a side effect of search. |

The governing messaging contract is `packages/messages/AGENTS.md`. Search must preserve the app's server-recoverable encryption and identity recovery semantics.

## User experience

1. Keep the current inbox when the query is empty. Use one **Search profiles and messages…** field with no Messages / People mode switch. Preserve the existing All / DMs / Dens filter for the inbox and message results; profile matches remain independent of that filter. While searching, label those tabs as message-result filters and hide inbox/unread counts so they cannot be mistaken for search totals.
2. Search profile candidates with the existing follow-only lookup and message history with the global indexed search. Rank exact and prefix profile matches first, show the top five profiles with a **Show more profiles** control for the rest of the bounded response, then show the newest-first message results. A profile lookup failure must not hide message results, and a message-search failure must not hide profiles.
3. Search profiles after their existing 250 ms debounce and message history after the shared 150 ms debounce. Profiles accept one or more characters; message search keeps its two-character minimum and 256 Unicode code-point maximum. Handle IME composition before submitting either query. Clear and Escape restore the inbox and predictable focus.
4. Profile rows show avatar, display name, username, and message eligibility. Message rows show the conversation avatar/name, sender or **You**, a locally decrypted highlighted snippet, and timestamp. Repeated hits from one chat remain separate results; ordering is global rather than grouped by chat.
5. On desktop, retain unified results while opening the selected conversation beside them. On mobile web, open the thread and restore the query, scroll position, and selected-result focus when returning. Keep this state user-scoped, short-lived, in memory, and out of the URL and persistent browser storage.
6. Selecting a message result centers and highlights the actual message. A missing, expired, hidden, or newly inaccessible target produces a clear state with a return-to-results action. Selecting another hit in the same conversation must trigger another jump.
7. Provide distinct states for profile loading/failure, initial message loading, page loading, complete empty results, incomplete coverage, decryption failure, connection loss, retryable service failure, rate limiting, and access/session changes. Never translate a failed request or incomplete index into **No matching messages**.
8. Support keyboard traversal, Enter to open, Escape to clear/return, accessible labels, and a polite loading/result announcement. Preserve the thread's existing Cmd/Ctrl+F behavior. Keep text queries out of URLs, persistent browser storage, analytics, and logs.

## API and shared contracts

Use one authenticated, POST-only endpoint under the existing search route tree:

| Endpoint                           | Input and behavior                |
| ---------------------------------- | --------------------------------- |
| `POST /api/messages/search/global` | `{ query, conversationType: "ALL" | "DM" | "DEN", cursor?, sessionToken? }`; the first request creates a short-lived search session and later requests use signed keyset cursors. Returns at most 20 hits, the viewer-owned key wrap needed for local decryption, and coverage state. The response is capped at 1 MiB. |

Use a distinct global-search contract on the existing browser-safe `@asm/messages/search-contracts` export. A hit needs `conversationId`, message ID, creation time, revision, sender, key epoch, ratchet index, and expiry metadata. Return only the conversation/sender fields needed for displayed hits, not complete den rosters or unrelated conversations. No plaintext bodies or server-generated snippets.

The page query returns bounded ciphertext directly, avoiding per-hit hydration requests. The database rechecks membership, block state, membership window, message revision, expiry, clear/hide state, and readable key epoch while selecting each hit. The client decrypts only the returned page. Retain the existing server-search kill switch, lifecycle capability header, authentication, and per-account rate limits. Global search has a separate 30-per-minute budget, honors `Retry-After`, and sends private, no-store responses.

## Global ordering and snapshot design

Use SQL keyset ordering by `(createdAt DESC, messageId DESC, conversationId DESC)`. Fetch 21 candidates to establish whether another page exists, then return 20. Never derive a total from this sentinel or merge an unbounded set in JavaScript.

Recommended snapshot design: a short-lived server-side scope manifest, referenced by a signed opaque session token. Reuse Redis for disposable session metadata; the durable database remains the source of index/coverage truth. A lost or expired manifest returns `409 SEARCH_SCOPE_CHANGED` and restarts search. It must not cause data loss, broaden permissions, or fall back to stale local results.

Capture the eligible conversation set and its per-conversation `changeSeq`, membership sequence, and readable membership windows in a bounded server-side manifest. The manifest binds account, query hash, conversation-type filter, normalization version, and expiry. It is gzip-compressed, limited to 5,000 conversations, 4 MiB uncompressed, and 1 MiB compressed, and lives in Redis for 15 minutes. Do not store plaintext queries, snippets, keys, or decrypted content in it. Each request supplies the query again and must match the bound hash.

Sign cursor version, session identity, account/query/filter scope, expiry, direction, and the ordering boundary. Keep token size independent of conversation count. Never substitute a timestamp or maximum conversation-local sequence for the full snapshot vector. New messages enter a new search snapshot; ordinary arrivals must not continuously invalidate the current pagination session.

Recheck current authorization in every page query. A missing, expired, tampered, or query-mismatched manifest returns an explicit restart response. Current membership sequence, blocks, inbox visibility, clears, hides, expiry, revision, and readable epochs constrain results even when a session snapshot exists. A stale or inaccessible result cannot broaden access through its cursor.

Set manifest byte, lifetime, and per-account session budgets during the database prototype; start with a fixed maximum lifetime of 15 minutes. Evict abandoned sessions and keep only a small number per account. An exceeded scope/resource budget must be explicit; never silently truncate to recent conversations and claim account-wide coverage.

## Database and indexing work

1. Add a dedicated global reader, preferably `packages/db/src/messages/search/global-search.ts` with SQL in `packages/db/sql/messages/search-global-readers.sql`. Keep current conversation readers intact while reusing tested normalization, grams, literal fragment verification, epoch, revision, and visibility rules.
2. Derive eligible conversations from the viewer's membership rows and current DM block rules. Include former den membership only within the same readable windows as the transcript. Respect inbox-hidden/clear behavior, including the legacy timestamp fallback for sequence-zero messages.
3. Join query fragments to terms **by conversation**. Verify every fragment against that conversation's document terms; a fragment in chat A and another in chat B must never combine into one match. Handle two-character fragments, punctuation, URLs, emoji, accents, non-space scripts, and long-token overlaps identically to conversation search.
4. Enforce source revision, soft deletion, deadline using server time, individual hides, chat clear cutoff, membership windows, and the viewer's readable key epochs inside candidate selection. Incognito content is never indexed or returned. Normal-message captions and generic attachment labels follow the existing searchable-payload contract; filenames and view-once content do not become searchable.
5. Retrieve scope/authorization/coverage metadata in set-based or bounded batched queries. Avoid one search API call, one ORM query, or one key-recovery job per conversation on each keystroke. Reuse durable indexing and backfill workers, with bounded backfill scheduling independent of page rendering.
6. Validate plans for selective fragments and broad two-character queries. Existing document ordering starts with `conversationId`; benchmark whether the global reader needs a cross-conversation ordering index. Add an index only with measured query-plan evidence and write/storage cost measurements.

Before changing database code, read the installed Prisma 8 skill and current migration architecture required by `packages/db/AGENTS.md`. If an index/contract change is justified, use the contract-first generation/migration workflow and prebuild large indexes concurrently outside the migration transaction. Do not hand-edit generated artifacts or rewrite migration history.

## Coverage, decryption, and invalidation

Coverage must describe every eligible conversation at its captured boundary, including conversations that currently return no hits. Missing coverage rows, paused backfills, pending readability verification, and unavailable epochs cannot be treated as complete. Return useful available hits promptly, with plain-language incomplete-history status. Do not run or wait for exact counts in this release.

If indexing advances during partial coverage, offer/perform a controlled restart from the first page; do not splice newly indexed older hits into an existing pagination window and silently skip them. Preserve the user's query and selected message. Rate-limit coverage polling and backfill scheduling.

Implement `use-global-message-search.ts` separately from the thread-oriented `use-conversation-search.ts`. Reuse pure matching/snippet helpers, revision validation, decryption infrastructure, and the three-page/60-hit retention limit. Query keys include account, recovery scope, normalized query, and type filter; consume `AbortSignal` in search and hydration requests. Cancel superseded requests/decrypt work and verify generation before committing asynchronous results. Bound the collection of old query keys as well as pages within one query; remove inactive global-search queries and release their decrypt references.

Resolve conversation key wraps/epochs only for bounded visible results, with bounded concurrency. Validate the hydrated revision before displaying a snippet. Keep derived snippets in memory and release them with evicted pages. Validate deadlines and current scope before restoring cached results on return, refocus, or reconnect. A timer removes expiring results even if the cleanup worker has not run.

Feed account-wide message/membership changes, own hide/clear actions, block changes, recovery changes, and cross-tab notices into the global result cache. Reuse the account event stream and existing change-broadcast infrastructure; do not open a stream for every chat. Immediately remove known invalid results. Reconcile visible result references in one bounded request on reconnect and foreground, plus a bounded freshness check while visible, because an inactive conversation's edits/deletes may be missed. Dispose subscriptions, timers, and decrypt references on leaving Messages or account change. Access denial never enables a saved-history fallback.

## Opening a result

Extend the page selection action to accept a message target and expose an optional requested-message input on `MessageThread`. Use `/messages?c=<conversationId>&mid=<messageId>` for reloadable message navigation; search text stays in memory. Preserve unrelated URL parameters, clear stale `mid` on ordinary conversation selection, and use `router.push` with `scroll: false` when entering a result so browser Back can restore results. Use replacement for target cleanup; an explicit back-to-results action must also work for a direct link with no prior in-app history.

The thread consumes each target request once after identity, conversation authorization, and decryption prerequisites are ready. Reuse the existing cancellation-aware anchored jump and highlight. Preserve its rolling history limits, viewport anchoring, and live-tail behavior. Repeated clicks on the same hit need a request identity even when the URL is unchanged; changing `mid` inside the same chat must also work.

An active incognito session must not be ended or bypassed to service a normal-history jump. Explain that the result belongs to normal history and can be opened after the session ends, retaining a return-to-results action. Do not start an archive walk for a target already known to be expired, hidden, or forbidden.

## Implementation sequence and acceptance

| Phase | Work and exit condition |
| --- | --- |
| 1. Database prototype | Prove global authorization, cross-conversation fragment isolation, snapshot stability, manifest budgets, and selective/broad query plans against seeded data. Decide whether an index is needed before building UI. |
| 2. Contracts and routes | Implement signed sessions/cursors, global candidate search, bounded hydration, coverage, feature switch/rate limits, and route/integration tests. Existing conversation and people APIs retain their behavior. |
| 3. Result navigation | Add `mid` handling, target consumption, anchored jumps, active-incognito handling, and desktop/mobile back behavior with navigation tests. |
| 4. Search UI | Combine profile and message search behind one field, show five profiles with an expansion control above message results, retain server-backed All / DMs / Dens filtering, and cover keyboard behavior, page retention, and distinct loading/error/coverage states. |
| 5. Lifecycle and release | Prove cross-tab/account cleanup, deadlines, missed-event reconciliation, memory/request bounds, performance, and kill-switch rollback. Enable globally only after these pass. |

Required automated coverage:

- Normalization and literal matching parity, Unicode code-point limits, mixed fragments, conversation-local term isolation, timestamp ties, forward/backward boundaries, and more than 20 conversations with a match only on an unloaded inbox page.
- Unauthenticated/cross-account access, tampered/query/filter-mismatched/expired tokens, missing Redis session, forged conversation/message pairs, revision races, membership/den leave/rejoin gaps, DM blocks, individual hides, whole-chat clears, reset epochs, and inaccessible wraps.
- Expiry before search, between search and hydration, while a result is visible, and before a jump. Incognito content never enters global search. Normal-history hits during active incognito show the planned state without changing the session.
- Incomplete/missing/paused coverage with zero hits, hydration byte deferral, undecryptable hits, service failures, rate limits, abort races, and global-offline behavior without false empty or exact-total claims.
- Profile-search and existing thread-search regressions; unified section order and five-result expansion; message-filter changes; same-chat and repeated-hit jumps; browser and in-app Back on mobile; desktop result retention; focus/keyboard/screen-reader states; app-controlled light/dark themes.
- Bounded query-key/page/decrypt retention through repeated typing and 100 conversation/result switches; account/recovery changes clear previous derived state; reconnect reconciles an edit/delete from a conversation that was never opened.

Benchmark both many-chat and deep-history shapes, using the existing 20 x 100k, 20 x 200k, and 1 x 1M fixtures plus a many-small-chats fixture. Exercise rare and broad multilingual queries with concurrent live writes/backfill and 50 concurrent searches. Capture first-hit and jump latency, database plans/buffers, manifest/scope setup cost, request fan-out, memory, and index write amplification. Use the existing messaging latency/memory targets as goals; record measured global-search results separately and do not treat historical conversation-search reports as proof.

## Implementation status

The web implementation adds a global indexed-message route with signed, short-lived search sessions and keyset cursors; bounded conversation scope and response sizes; server-side DM/den filtering; backfill coverage; rate limiting; and current membership, block, hide, expiry, clear, revision, and readable-epoch checks. Matching stays conversation-local. The browser keeps queries out of URLs and persistent storage, decrypts returned hits locally, retains at most 60 results, and shows explicit incomplete, paused, offline, retry, and no-match states. Profile lookup is integrated into the same search field and results surface, retains its existing follow-only eligibility, and shows five matches before expanding the rest of the bounded response.

Selecting a result uses the existing anchored thread jump. A short-lived, in-memory, user-scoped view snapshot preserves mobile query, scroll position, and focus through thread navigation without storing message text in a URL or persistent browser storage. An active incognito session retains its existing behavior and displays the normal-history restriction for a selected global result. No schema changes or migrations were needed.

The focused shared-contract, search-session, route, global-reader integration, conversation-list, and view-state suites passed; the full monorepo type check passed. Changed TypeScript files passed targeted formatting and lint checks. The PostgreSQL integration exercised DM/den authorization, blocks, fragment isolation, hidden rows, and viewer-owned wraps.

Browser smoke acceptance used the existing local `dmsearchowner` account and its 200,003-message DM at a 668 px responsive viewport. Searching the planted rare term `zarquon` returned a bounded 20-hit page with locally decrypted, highlighted snippets; opening a result carried `c`, `mid`, and a unique search-navigation marker, and returning restored the query and result list. This verifies the search and mobile return flow against a 200k-scale conversation. It does not establish physical-device performance, broad concurrent-load behavior, production query-plan budgets, or a visually confirmed target-message landing on every viewport. The UI correctly reported that some older account history could still be indexing.

The repository `bun run check` script performs workspace-wide auto-fixes, so verification used targeted formatting and lint checks to avoid rewriting unrelated files. No database schema or migration changes were made.

## Documentation consulted

The 2026-10-18 review and follow-up fixes, local timing comparisons, regression coverage, and remaining visual acceptance limits are recorded in [the unified search review](../audits/global-message-search-review-2026-10-18.md).

- `packages/messages/AGENTS.md`, `packages/db/AGENTS.md`, and the current source files listed above.
- Installed Next.js App Router documentation under `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/`.
- [TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) and [infinite queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries), retrieved through Context7: consume the request signal, bind query variables to keys, and configure both pagination directions when limiting retained pages.
- [Next.js App Router useRouter](https://nextjs.org/docs/app/api-reference/functions/use-router) and [useSearchParams](https://nextjs.org/docs/app/api-reference/functions/use-search-params), retrieved through Context7 and checked against the installed docs: push/replace control history, and search parameters are read-only.
