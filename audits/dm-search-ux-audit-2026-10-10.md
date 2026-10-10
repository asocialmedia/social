# DM search UX audit

Date: 2026-10-10. Scope: conversation search on the web, including server search, saved-history fallback, count requests, results, and transcript jumps.

## Verdict

The search UX is usable, but it does not yet meet the intended standard. Showing results promptly and calculating expensive totals separately is the right architecture. The presentation and several transitions still obscure useful information or disrupt navigation. Passing the earlier functional and database scale checks did not establish that all search interactions were correct.

The user's concern is valid: a useful result count should remain visible while older history is becoming searchable. A partial number must state its scope and certainty. It must not look like the final total for the conversation.

No product implementation was changed during this audit. Source review, rendered component output, and focused integration tests establish the findings below. Fresh browser inspection was blocked by the browser tool's automatic URL policy when binding the existing localhost tab. No alternate browser route was attempted. Phone layout, contrast, actual focus behavior, and frame stability still require a visual check after the fixes. The previous 200k-message browser acceptance is supporting historical evidence, not a fresh visual audit.

## Why the numbers are missing

There are four separate causes:

1. In the server-managed search bar, older-history, offline, saved-history, and unavailable-history messages take precedence over the result counter. Seven known matches during backfill render only “Searching older messages…”. The current component test explicitly expects the seven-result number to be absent.
2. Once an exact count arrives, list mode still renders only the current range, such as “1–20+ results”. The exact total affects the page denominator, such as `1/264`, but is omitted from the result summary. Chat mode renders `1 of 5274+`, attaching a plus even though 5,274 is already exact. Continuation availability and count uncertainty are being conflated.
3. A search started before coverage is complete receives no count token. Its subsequent coverage refresh sends the existing snapshot token. The server creates count requests only when both cursor and snapshot are absent. Consequently, the refresh that finally reports complete coverage still creates no count request, and coverage polling then stops. The same query can remain at a lower bound until another action starts a fresh search.
4. Pending and unavailable count states are not exposed by the hook to the UI. The bar cannot distinguish “results ready; total pending” from “no total available”. Count completion is polled with backoff rather than pushed live.

Relevant evidence: [status precedence](../apps/web/src/components/messages/message-search-bar.tsx:214), [test that suppresses the count](../apps/web/src/components/messages/message-search-bar.test.tsx:81), [snapshot refresh](../apps/web/src/lib/messages/use-conversation-search.ts:612), [count creation gate](../apps/web/src/app/api/messages/conversations/[id]/search/route.ts:323), [count polling](../apps/web/src/lib/messages/use-conversation-search.ts:814).

### What can honestly be shown live

- **Exact final total:** valid only for the authorized search snapshot and declared scope after counting has completed, or when a completed first page proves the entire result set fits on that page.
- **Exact number fetched so far:** a count of distinct authorized results fetched for this search. It is not the number of all matching messages in the indexed portion of the archive. Label it “20 found so far” or display “20+ results” when continuation is known.
- **Exact total in the searchable portion so far:** requires a separate server result with coverage, permission, and snapshot semantics. The current API does not return this. `artifactsCommitted` and `rowsTraversed` are archive work counters, not query-match counts, and must never be presented as matches.

The hook currently uses `known hits + 1` to make another page reachable when a cursor exists. That extra one is a pagination sentinel, not a counted result. Keep it out of user-facing totals and replace it with explicit cursor availability. See [the derived total](../apps/web/src/lib/messages/use-conversation-search.ts:956).

An increasing exact partial count is possible, but repeatedly counting millions of authorized messages after every indexing batch would work against the performance goal. The efficient initial fix is to expose the known lower bound immediately and publish the independently calculated exact total when ready. If a true increasing partial total is later required, it needs a versioned, coalesced background count contract; it must not add full counts to the first-result request or delay reading.

Previous local scale evidence explains why waiting for the exact count is inappropriate: broad first-page searches had p95 of 153 ms for 20 × 200k and 237 ms for 1M, while the tested exact counts took about 10 and 50 seconds respectively. These are local PostgreSQL measurements, not expected wait times for every query. See [the verification report](./dm-production-verification-2026-10-10.md).

## Prioritized findings

### P1: Chat navigation only traverses the retained result window

Search opens in chat mode, which passes page zero to the hook. Next and previous match use modulo arithmetic over `matchIds`, and `matchIds` contains only the retained hydrated pages. Stepping past the initially loaded 20 results wraps to the first one instead of fetching the next cursor. An exact denominator of 5,274 therefore promises a result set the default arrows cannot traverse.

After selecting a result on a distant list page, switching to chat forces page zero again. This can fetch back toward the head and evict the selected result from the search window. The auto-jump effect interprets disappearance from the retained match IDs as disappearance from the match set and jumps to the newest result. Result eviction is not proof of deletion.

Fix: one cursor-aware navigation controller for both views, with selection stored independently by message ID and stable snapshot position. Fetch the adjacent result page at its boundary. Wrap only when the declared scope is complete and its actual end has been reached. Preserve a selected result through page eviction and view changes.

Evidence: [chat always requests page zero](../apps/web/src/components/messages/message-thread.tsx:3103), [modulo stepping](../apps/web/src/components/messages/message-thread.tsx:3225), [retained match IDs](../apps/web/src/lib/messages/use-conversation-search.ts:926), [auto-jump on missing retained ID](../apps/web/src/components/messages/message-thread.tsx:3198).

### P1: Exact count is never requested after some backfills complete

The missing transition described above is reproduced in the hook harness: initial coverage is partial, the next request preserves `snapshot-1`, coverage becomes complete, no `/search/count` call occurs, and the hook stays at the synthetic total 21 for a 20-hit page with continuation.

Fix: allow a count request for a settled readable snapshot independently of whether the request is an initial page, refresh, or cursor page. Deduplicate it for the account/query/snapshot/permissions. Expose pending, exact, and unavailable states. Permission and recovery invalidation must still apply.

### P1: Background coverage refresh clears the page being read

When incomplete coverage is refreshed, the hook requests the head and resets the retained window, even when the user is reading page two or later. A reproduction observed page-two results disappear, a loading state with only the head retained, and another request to reconstruct page two. Deeper pages require more seam reads. This is unnecessary work and risks a visible flash and changed selection.

Fix: update coverage separately from the page being read. Preserve current result IDs, scroll offset, active selection, and snapshot boundaries. Newly discovered matches can become available through continuation or a restrained refresh affordance without replacing the current page.

Evidence: [forced head refresh](../apps/web/src/lib/messages/use-conversation-search.ts:435), [window reset](../apps/web/src/lib/messages/use-conversation-search.ts:457), [refresh reset argument](../apps/web/src/lib/messages/use-conversation-search.ts:765).

### P1: Failed jumps are silent in the current search bar

The thread records and passes `jumpError`, but the server-managed status branch never reads it. A rendered bar with “This message is no longer available” as its jump error still displays `1 of 5`. The search-specific spinner also follows search requests, not the passed jump activity. A transcript loading prompt exists, but it does not expose the ignored failure.

Fix: display a brief inline jump error with a retry for transient failures. Preserve the previous transcript position on failure. Use “Opening message…” for an actual jump wait and retain the count separately. Do not report a network timeout as deletion.

Evidence: [server status branch](../apps/web/src/components/messages/message-search-bar.tsx:214), [jump props](../apps/web/src/components/messages/message-thread.tsx:4522), [error recorded](../apps/web/src/components/messages/message-thread.tsx:3017).

### P2: Useful count and scope information compete for one label

Coverage, offline scope, saved-history fallback, and unreadable history replace the number rather than qualify it. A count-ready state does not clearly announce completion. A plus is based on `hasMore`, even when an exact total exists. The page denominator is derived from a lower bound while counting is pending, so `1/2` can appear and later become `1/264` as if the known number of pages changed.

Fix: separate the primary result summary from a short secondary scope/status line. Use locale-formatted numbers and explicit count certainty. Show “Page 1” until an exact page total exists; next/previous enablement must use cursors. Keep result counts visible through background activity.

Evidence: [result labels](../apps/web/src/components/messages/message-search-bar.tsx:221), [page denominator](../apps/web/src/components/messages/message-search-bar.tsx:372), [page count derived from total](../apps/web/src/lib/messages/message-search.ts:741).

### P2: Empty, loading, and unreadable results can be misleading

Only decrypted hits become result rows. Pending hits have no fixed placeholder, so they enter the list progressively rather than hydrating within stable rows. A decrypt error drops the row entirely. If no rows survive but a positive count remains, the body can say “No more matches past this page.” In paused or unreadable coverage with zero hits, the body can say “No messages match this search,” even though the bar says some older messages could not be searched. The server bar also prints a numerical page range without checking whether the current page contains visible rows.

Fix: reserve one stable row per authorized hit while it hydrates; replace a failed row with an ordinary unavailable/retry state. Distinguish an empty declared scope from an unresolved page. Use “No matches in available history” for settled partial coverage and “No saved messages match” offline. Never claim a rendered range over an unresolved page.

Evidence: [unresolved/error payloads omitted](../apps/web/src/lib/messages/use-conversation-search.ts:186), [only decrypted results emitted](../apps/web/src/lib/messages/use-conversation-search.ts:937), [empty-state branches](../apps/web/src/components/messages/message-search-status.ts:146), [no fixed result-row height](../apps/web/src/components/messages/message-search-results.tsx:164).

### P2: Result identity is degraded to “them”

Hydration constructs every search message with `sender: null`. The list receives these messages directly, and peer rows use the fallback name “them” and an empty avatar. Offline hydration has the same limitation. This is especially poor where shared infrastructure serves dens with multiple senders.

Fix: resolve sender metadata from already authorized conversation members or a bounded shared user cache. Keep a meaningful fallback while metadata loads. Sender names and avatars do not require decrypting or storing a message preview.

Evidence: [server hydration](../apps/web/src/lib/messages/search-hydration.ts:155), [offline hydration](../apps/web/src/lib/messages/offline-search-fallback.ts:72), [display-name fallback](../apps/web/src/components/messages/message-search-results.tsx:161).

### P2: Returning from a result does not reliably restore search context

The list-to-chat transition preserves the page variable, but chat requests the head, and toggling views resets the active list index to zero. There is no dedicated search return anchor or list-scroll restoration in these handlers. Close search clears the query and selection without restoring the pre-search transcript anchor. The auto-jump effect runs regardless of whether list or chat view is active, so merely typing in list mode can trigger a hidden transcript jump.

Fix: preserve the results page, selected ID, list pixel offset, and transcript return anchor independently. Provide a clear “Back to results” path after selection. Restore the saved result position when returning. Restrict automatic transcript jumps to the intended chat interaction. Closing search may keep the selected message visible, but returning to the pre-search reading position must be an explicit, preserved capability.

Evidence: [view toggle resets selection](../apps/web/src/components/messages/message-thread.tsx:3349), [close behavior](../apps/web/src/components/messages/message-thread.tsx:3321), [list jump](../apps/web/src/components/messages/message-thread.tsx:3379), [auto-jump effect](../apps/web/src/components/messages/message-thread.tsx:3186).

### P2: Saved-history fallback has no clear path back to full search

Service failures, timeouts, and rate limiting can successfully fall back to saved messages while the device stays online. This is a useful graceful fallback. However, once the summary is offline-backed, retrying the request generation reads that saved scope again. There is no displayed “Retry full search” action for a successful fallback, and the wording continues to say “Searching saved messages” after the saved search has finished. Recovery generally requires a query or connectivity-key change.

Fix: show results/counts with “Full search temporarily unavailable — showing saved messages” and a bounded retry to the server. A completed offline search should say “Offline — saved messages only.” Reconnection can expand the scope, but should preserve the selected message and explain a scope change without silently replacing what is being read. Authentication and permission denials must continue to fail closed.

Evidence: [fallback statuses](../apps/web/src/lib/messages/offline-search-fallback.ts:7), [existing offline summary stays offline](../apps/web/src/lib/messages/use-conversation-search.ts:595), [retry only increments generation](../apps/web/src/lib/messages/use-conversation-search.ts:888).

### P2: Keyboard semantics and focus behavior need correction

Rows have `role="option"` and `aria-selected`, but their container has no listbox role. Input arrow keys change a React active index without an `aria-activedescendant` relationship to the result. Hover moves DOM focus into a row even though it does not update that active index, so visual selection, keyboard focus, and Enter behavior can diverge. The input unconditionally handles Enter and arrow keys without checking composition state, which risks interfering with multilingual input.

Fix: use a semantic list of buttons or implement the complete listbox/input relationship and keyboard model. Keep pointer hover from stealing text-entry focus. Support IME composition and preserve platform editing keys. Announce meaningful count/scope/error transitions politely and coalesce updates so assistive technology does not announce every indexing batch. W3C's [listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/) defines the required roles and focus relationships; its [status-message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html) covers search progress and result announcements without taking focus.

Evidence: [option roles and hover focus](../apps/web/src/components/messages/message-search-results.tsx:164), [input keyboard handler](../apps/web/src/components/messages/message-search-bar.tsx:299), [active list index](../apps/web/src/components/messages/message-thread.tsx:3255).

### P2: Minimum-query validation disagrees for Unicode

The API/hook validate normalized Unicode code points, but the bar and empty-state components check JavaScript string length. A single emoji has string length two and code-point length one. The UI considers it ready, the hook correctly declines the search, and the bar can display “No matching messages” instead of the two-character guidance. Combining marks can produce similar differences after normalization.

Fix: use the shared normalized validation result everywhere. Reject invalid queries with ordinary guidance; do not represent an unexecuted query as an empty search. Preserve the accepted two-character minimum and 256-code-point maximum.

Evidence: [UI readiness](../apps/web/src/components/messages/message-search-bar.tsx:142), [list readiness](../apps/web/src/components/messages/message-search-results.tsx:87), [shared validation](../packages/messages/src/normalization.ts:13).

### P2, visual confirmation pending: Narrow-screen toolbar density

The bar keeps input, status, pagination, view toggle, and close in one fixed-height flex row. Long scope/error strings do not shrink. Its icon controls have 28 × 28 CSS-pixel hit areas and no expanded touch target. There is no small-screen arrangement beyond horizontal padding. This creates a credible risk that the input is squeezed or controls overflow on a narrow phone, but actual overflow was not measured during this audit.

Fix: keep the input and essential controls in the first row; put status/count and page navigation in a compact second row at narrow widths. Use at least 44-pixel touch targets for phone comfort. Do not call the existing 28-pixel buttons a demonstrated WCAG failure solely from their size. Verify at 320/375 pixels, large text, long translated copy, light/dark themes, and landscape.

Evidence: [fixed toolbar construction](../apps/web/src/components/messages/message-search-bar.tsx:265), [non-shrinking status](../apps/web/src/components/messages/message-search-bar.tsx:330), [icon hit areas](../apps/web/src/components/messages/message-search-bar.tsx:349).

## Recommended user-facing state contract

The count is per matching message, not per repeated occurrence within a message. Keep the primary number visible and put scope or work in a secondary line. The following are illustrative strings, not a requirement to fit all copy into the current single row.

| State | Primary summary | Secondary feedback / action |
| --- | --- | --- |
| Empty field or normalized query below two characters | No result count | “Type at least 2 characters to search.” |
| Query exceeds 256 normalized code points | No stale count for this query | “Search queries must be 256 characters or fewer.” |
| First request pending | “Searching…” | Preserve the input and reading context. |
| Results ready; final total pending | “20+ results”; “Page 1” | “Counting results…” only if a count job is actually pending. |
| Older history incomplete; results exist | “20 found so far” or “20+ results” | “Searching older messages…” |
| Older history incomplete; no results yet | “Searching…” | “Searching older messages…”; no final empty claim. |
| Fully readable scope; exact total ready | “5,274 results”; “1–20 of 5,274” in list mode | “Page 1 of 264”; no plus on the exact total. |
| Fully readable scope; completed first page has all seven results | “7 results” | No expensive count job needed. |
| Fully readable scope; exact total unavailable | “20+ results”; “Page 1” | Results remain usable; a total is optional. |
| Fully readable scope; no hits | “No matching messages” | Optional restrained guidance to try another fragment. |
| Settled partial scope; matches exist | Known result count or lower bound | “Some older messages couldn't be searched.” |
| Settled partial scope; no hits | “No matches in available history” | Same scope explanation; no indefinite progress promise. |
| Offline; saved search complete | “7 results” or “No saved messages match” | “Offline — saved messages only.” |
| Online service outage; saved search complete | Count within saved scope | “Full search temporarily unavailable — showing saved messages”; retry full search. |
| No usable saved cache during an outage | “Search couldn't load” | Retry; no false zero-result answer. |
| Page transition | Preserve total/scope; “Loading results…” for the requested page | Stable row placeholders; no fabricated visible range. |
| Some snippets still loading | Preserve hit slots and result count | Hydrate within reserved rows; do not shift a selected row. |
| A hit fails to decrypt or becomes unavailable | Keep other results usable | Brief per-row state; retry where meaningful. |
| Selected-message jump pending | Preserve result count | “Opening message…” |
| Selected-message jump fails | Preserve results and prior transcript position | Brief availability/network explanation; retry transient failures. |
| New messages arrive during pagination | Preserve current snapshot and selection | Make refresh available without moving the current result. |
| A selected message is edited/hidden/deleted | Remove or update that result safely | Explain unavailability; do not jump to the newest unrelated result. |
| Permission/recovery scope changes | Clear inaccessible results immediately | Restart only within the newly authorized scope. |
| User types a newer query | Old results must not appear to answer the new query | Cancel superseded work; clearly retain or replace the old list without silent mismatch. |
| Return from a selected result | Restore result page, row ID, and pixel offset | Keep the query and snapshot; avoid forcing the head. |

## What is already good and should be preserved

- Results and counts are independent; large exact counts do not block first-page search.
- Requests are debounced, abortable, and scoped so stale replies do not replace a newer committed search.
- Result pages and transcript windows are bounded; the device does not need to decrypt the complete archive.
- Saved-history fallback distinguishes an online service outage from a genuinely offline device.
- Authentication/access denials do not fall back to cached results, and recovery generation changes clear the result scope.
- Snippets are generated and highlighted on the device using normalized matching; server responses contain ciphertext and references rather than plaintext previews.
- Durable change handling deliberately preserves search snapshots for ordinary message creation. Keep this policy; changing the count UX must not reintroduce result reshuffling on every live arrival.

## Verification performed

Existing focused suite:

```text
bun test apps/web/src/components/messages/message-search-bar.test.tsx apps/web/src/components/messages/message-search-status.test.ts apps/web/src/lib/messages/search-result-window.test.ts apps/web/src/lib/messages/use-conversation-search.integration.test.tsx
51 passed; 0 failed.
```

Repository validation also passed: `bun run check` and `bun run check-types`. The audit report is the only workspace change.

Two additional observation scenarios were run in a temporary copy of the hook harness. Both confirmed the defects: missing count startup after snapshot-preserving coverage completion, and page clearing/reconstruction during partial-coverage polling. The copy also reran the existing nine hook tests: 11 passed, 0 failed. These are observation assertions of existing behavior, not proof that the defects are fixed.

Rendered component probes produced:

| Input | Actual primary label |
| --- | --- |
| Seven matches while older history is incomplete | “Searching older messages…” |
| Exact total 5,274 in list mode with more pages | “1–20+ results” |
| Exact total 5,274 in chat mode with more pages | “1 of 5274+” |
| Failed jump, five matches remain | “1 of 5” |
| Requested page with zero visible rows, nominal range 21–40 | “21–40+ results” |
| Offline saved search finished with seven matches | “Offline — searching saved messages” |
| One emoji, below the shared code-point minimum | “No matching messages” |

Temporary evidence: `/tmp/dm-search-ux-audit/coverage-refresh.test.tsx`, `/tmp/dm-search-ux-audit/render-states.tsx`, `/tmp/dm-search-ux-audit-repro.log`, and `/tmp/dm-search-ux-audit-tests.log`. These paths are local audit evidence and are not committed test coverage.

## Efficient fix sequence and acceptance

1. Introduce explicit count certainty and scope; fix count startup after backfill and the exact/partial labels together. Replace synthetic totals used for pagination with cursor availability. Verify the complete loading/empty/count matrix, including disabled or failed count jobs.
2. Unify chat/list navigation and selection around IDs, cursors, and return anchors. Stop coverage refresh from replacing the current page. Verify navigation beyond 20 results, selection beyond the three-page retention window, tied timestamps, polling, and concurrent edits/hides/deletes.
3. Preserve hit-row slots through hydration, populate sender metadata, expose jump errors, and provide a real retry to full search after saved-history fallback. Verify decrypt failures, unavailable hydration IDs, large payloads, cache loss, timeout, rate limiting, and successful server recovery.
4. Correct keyboard/IME semantics and shared query validation. Verify composition Enter, emoji/code-point boundaries, keyboard result selection, focus continuity, and polite status announcements.
5. Adjust narrow-screen layout and validate it once the functional transitions are fixed. Browser checks should cover the same 200k fixture, broad and rare queries, slow counts, incomplete coverage, offline/outage states, 375-pixel layout, and returning from distant results. Physical-device performance gates remain separate from this source/state audit.

No additional archive-scale benchmark is needed merely to change labels. Rerun count or query load tests only if their database work changes. Tests must exercise the whole query-to-result-to-jump-to-return flow; snapshots of wording alone would miss the navigation and count-startup defects found here.
