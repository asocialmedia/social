# Community filters and chat follow-up — 19 October 2026

## Delivered

Community posts now support combinations of post type, rolling date range, content rating, words in the post and exact author, alongside New/Top sorting. Filters run before pagination in PostgreSQL. Web URLs retain selections through refresh and browser Back; individual chips remove one filter, and Clear filters preserves sorting. Applying unchanged selections does not add duplicate history entries.

Desktop uses a compact popover. Phones use a scrollable dialog with labeled fields and 44-pixel touch targets. Native uses its existing dialog, tactile controls and feed cache, with matching server filters and 48-point controls. Filter combinations have distinct cache keys, and web cancels obsolete requests. Empty results explain how to recover.

The idea of combining facets and ordering follows the [Wallhaven search reference](https://www.whvn.cc/help/api); the terminology, visual surfaces and community layout remain Asocialmedia's. Image-specific orientation, resolution and color filters were not added. Image/video/audio filters match ready uploads, while external image previews belong to Links. Empty embed arrays remain text posts.

Additional fixes and closed test gaps:

- Added native private-thread creation using the existing endpoint, bounded member search, initial invitations and retry identifiers. The dialog explains that staff can inspect private threads and that privacy is fixed.
- Shared member suggestions retain at most 100 unique profiles, even after many pages. Both clients enforce 50 invitations at creation. Web rejects stale lookup responses after query changes, dialog dismissal and access revocation; search and creation errors are visible inside the dialog.
- Added a real Redis subscriber-reconnect integration test. It disconnects only its own newly created subscriber, verifies generation advancement, restored fan-out and listener cleanup, and leaves the app's Redis connections running.
- Ran previously missing DM/den service regressions covering receipts, unread state, reactions, identity recovery and media lifecycle/access.
- Disabled the development-only Next badge after proving it intercepted the sidebar theme control. The query inspector launcher hides while dialogs are open, and Tailwind now scans provider files for their utilities. Verified theme switching and unobstructed filter actions afterward. Error reporting remains available through development logs.
- Fixed cross-community and excluded-post cursors influencing filtered pagination; cursor anchors now come from the same filtered query.

No schema changes, migrations, new packages or production deployment were needed.

## Verification

| Check | Result |
| --- | --- |
| Full community suite, PostgreSQL/Redis | 86 passed, 0 failed, 531 assertions across 12 files |
| Selected DM/den service regressions | 26 passed, 0 failed, 108 assertions across 5 files |
| Native community and chat transport suites | 26 passed, 0 failed, 70 assertions |
| Shared member pagination and timeline tests | 6 passed; bounded suggestions exercised through 100 pages |
| Chat HTTP acceptance | 15 scenarios passed, 0 failed |
| Post-filter HTTP acceptance | 6 scenarios passed, 0 failed |
| Repository lint/format and workspace types | Passed |
| Configured production web build | Passed |

These scopes overlap earlier audit runs; they are not a count of every repository test. The production build used the existing local test environment and completed compilation, type checking and prerendering. It emitted existing dynamic-filesystem tracing and Node localStorage warnings; no production deployment was attempted.

Chat HTTP evidence is preserved separately in [chat-http-acceptance.json](community-followup-2026-10-19/chat-http-acceptance.json), run `b103bb84`, executed `2026-10-19T10:04:25.916Z`. The original audit artifact remains historical. Filter results are in [community-post-filter-acceptance.json](community-post-filter-acceptance.json).

## Browser observations

- Combined Links + past week + keyword + author returned the single expected seeded post. Top retained the selection. Refresh preserved the URL and result.
- An image-upload filter excluded the same external-link preview and displayed the recovery state. Back restored the prior filter/result; removing one chip retained the others.
- Canceling draft filter edits preserved the existing URL and results. Clearing filters restored the three seeded posts.
- At 320 × 800 CSS pixels, the phone dialog was 288 pixels wide and entirely inside the viewport. At 738 × 341, its height was approximately 307 pixels, with scroll access to Show posts. No horizontal overflow was measured.
- Desktop popover stayed inside viewport edges; light and dark themes were checked. The inspector launcher had no visible rectangle while the dialog was open.
- Web private-thread member search returned active fixture members, excluded the pending applicant, and allowed selection, deselection and cancellation. Staff inspection and fixed privacy are stated in the creation dialog.
- The browser was restored to owner `anny`, dark theme, normal viewport and the unfiltered community feed after acceptance.

Screenshots: [phone filters](community-followup-2026-10-19/mobile-post-filters.jpg), [desktop light filters](community-followup-2026-10-19/desktop-post-filters-light.jpg).

## Remaining work

Native private-thread creation and post filters are implemented and typechecked, with transport regression tests. Their actual Android/iOS interaction, keyboards, safe areas and screen-reader behavior remain unverified: `adb devices -l` still reports no device, and no iOS runtime is available here.

The original release still needs chat attachments/shared-post payloads with media authorization, community message search/indexing, typing/mention composition, notification delivery workers and complete moderation/reporting/invitation-management UI. Post keyword filtering is not chat search. This follow-up does not claim those larger feature gaps are complete.

The one-hour 100,000-member/5,000-viewer/50-send-per-second workload, full worker/queue loss testing, slow-consumer stress, long-history anchor measurements, physical devices, canary rollout and rollback rehearsal remain release gates. The new Redis test proves reconnect behavior of the shared hub; it does not simulate a whole Redis outage or certify SSE recovery under production load. Existing authentication burst limits were preserved and still need capacity validation.

## Reproduction

```sh
bun --env-file=.env.test test --parallel=4 --timeout 30000 ./packages/db/src/communities/
bun --env-file=.env.test test --parallel=4 --timeout 30000 packages/db/src/messages/message-interactions.integration.test.ts packages/db/src/messages/unread/message-read-sequence.integration.test.ts packages/db/src/messages/unread/den-unread-badge.integration.test.ts packages/db/src/messages/epochs/identity-search-recovery.integration.test.ts packages/db/src/messages/lifecycle-media.integration.test.ts
bun test packages/messages/src/community-chat-members.test.ts packages/messages/src/community-chat-timeline.test.ts apps/mobile/src/features/communities/lib/communities-api.test.ts apps/mobile/src/features/communities/lib/community-chat-api.test.ts
bun scripts/testing/community-chat-acceptance.ts
bun scripts/testing/community-post-filter-acceptance.ts
bun run check
bun run check-types
```

For the configured production build, run `bun --env-file=../../.env.test run build` from `apps/web`. HTTP scripts target only the local synthetic playground. The chat script writes disposable audit content and archives its temporary channels; the post-filter script performs reads only.
