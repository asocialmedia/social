# Native / web parity tracker

Source audit: 2026-10-21. Current root version: `1.12.36`; mobile package and Expo app version: `0.2.35`; Expo SDK: `58`.

This tracks current native source against current web source. The reported installed baseline is around `1.10.70`, but that historical bundle was not inspected. These are separate version schemes; do not treat the mobile version as a root release number. No Git history, installed APK, browser, or emulator was inspected for this audit. A source implementation is not evidence that it shipped in the installed app.

There are **39 implementation work items**, followed by **6 release verification tasks**. Check a work item only after its acceptance behavior has been verified. `Missing` means no equivalent native implementation was found; `Partial` means some of the flow exists; `Mismatch` means the current native behavior differs from an existing web flow. Priorities describe the suggested order, not runtime severity.

## Implementation progress

All original checkboxes below remain acceptance/verification gates; their descriptions record the source audit baseline. All 39 runtime implementations were written before starting tests, lint, types or device validation, as requested.

| Items | Runtime code | Automated validation | Release device validation |
| --- | --- | --- | --- |
| N01–N07 | Complete | Preferences, policy, request context and locale regressions; workspace lint/types | Deferred to user |
| B01–B10 | Complete | Native OAuth client/server security and return flows, source text, resource/feed regressions; workspace lint/types | Deferred to user; real provider round trip needs updated server |
| S01–S05 | Complete | Scoped history and search contracts; workspace lint/types | Deferred to user |
| E01–E03 | Complete | Shared eligibility/request contracts; workspace lint/types | Deferred to user |
| G01–G03 | Complete | Shared source/request/policy contracts; workspace lint/types | Deferred to user |
| F01–F06 | Complete | Buffered feed heads, policy, canonical route/share mapping, typed source text; workspace lint/types | Deferred to user |
| O01–O05 | Complete | Notification destinations and accumulated shared-reference refresh/edit/delete regressions; workspace lint/types | Deferred to user |

- React Native 0.88 / Expo SDK 58: implementation targets the installed versions, `@expo/ui` controls, native Router intents, synchronous native layout bounds and managed Expo video lifecycle.
- iOS universal links require the deployment's `APPLE_TEAM_ID` and a rebuilt app. Android reuses the already-published release signing fingerprint. Domain association and OAuth require the corresponding web deployment; no deployment has been requested or performed.
- Code completion and automated checks do not establish every live acceptance behavior. The checkboxes remain open until the corresponding end-to-end behavior is verified.

## Implementation validation record

- Repository tests: `bun run test --parallel=1` — 7,033 passed, two skipped, zero failures across 799 files. Log: `/tmp/native-parity-final-commit-tests.log`. Database/Redis integration suites were excluded by the runner because their test services are unavailable; the two live Gemini tests were skipped.
- Repository lint/format: `bun run check` passed. Log: `/tmp/native-parity-final-check.log`.
- Repository types: `bun run check-types` passed all 14 workspace tasks. Log: `/tmp/native-parity-final-types.log`. Missing Prisma generated types were generated with `bun run db:gen`; no database schema/data migration was made.
- Android release validation caught missing Hermes `Intl.DisplayNames` and ES2023 copying-array methods in Network settings. Added the English FormatJS fallback and reused the existing Hermes-compatible ordering helper. A subprocess regression removes both APIs and verifies real language/region choices. The focused set passed 42 tests with zero failures (`/tmp/native-parity-final-focused.log`).
- First signed release build succeeded on RN 0.88 / Expo SDK 58. The existing emulator APK was `0.2.22` (222); the new APK is `0.2.35` (235). This does not establish the provenance of the reported `1.10.70` root release.
- User requested committing all worktree changes after final automated checks and will perform device acceptance and merge later. Device acceptance remains pending after the final compatibility fixes. No push, merge, deployment or iOS build is part of this handoff. Runtime features requiring newly added web routes need that server deployment before a live acceptance pass.
- Final signed Android build after both Hermes fixes succeeded (`/tmp/native-parity-rebuild-signed.log`). The ignored local artifact is `build-artifacts/asocialmedia-v0.2.35-x86_64.apk`; this is an emulator build from before the commit hook version bump, and has not received a final device acceptance pass. It is not a production ARM64 release.
- The copied pre-existing source/dependency/security changes from the audited snapshot are included in the requested all-changes commit. The original checkout remains untouched.

## 1. Network settings and recommendation foundation

- [ ] **N01 · Missing · P1 — Network settings hub and navigation.** Add the Network tab, its Profiles, Content & media, Moderation & content filters, and Languages subpages, and settings search/deep-link destinations. Native currently recognizes only Profile, Account, Privacy, Security, and Personalization.
- [ ] **N02 · Missing · P1 — Recommendation profile management.** Create, activate, and delete profiles, display the active selection, and preserve independent interests/activity. Match the web limits of eight profiles and a 40-character name.
- [ ] **N03 · Missing · P1 — Interest picker and topic discovery.** Add live topic autocomplete, related-topic exploration, selected interest pills, and removal, with up to 32 interests per profile. Use `/api/network/topics` and existing shared contracts.
- [ ] **N04 · Missing · P1 — Learned interests and activity controls.** Show learned topics, interaction counts, and topic connections; clear the active profile's activity without clearing chosen interests or linked accounts.
- [ ] **N05 · Missing · P1 — Moderation preferences.** Add the account-wide explicit-content opt-in and avoided-topic editor, including compound-tag matching and the web limit of 64 avoided topics. Preserve the default of 18+ hidden and show the safety/settings shortcut on discovery surfaces. Existing native blur/reveal controls do not replace this preference UI.
- [ ] **N06 · Missing · P1 — Content language and region preferences.** Add multiple content languages, all/device language behavior, region selection, selected-language pills, and removal. Resolve discovery locale consistently from preferences and device settings.
- [ ] **N07 · Missing · P1 — Network settings client and coordinated invalidation.** Read/save/reset through `/api/network/preferences`, handle revisions and 409 conflicts, expose loading/retry/save states, and re-scope cached feeds, scroll positions, search, suggestions, and Gusts when profiles/settings change. Refresh settings on an appropriate native foreground/resume path so changes made on web reach the app. Current native caches generally key on user and tab, without the Network profile/revision scope.

Evidence: [web Network hub](apps/web/src/components/settings/network-settings.tsx), [web panels](apps/web/src/components/settings/network-panels), [web settings client](apps/web/src/hooks/feed/use-network-settings.ts), [web synchronization](apps/web/src/components/feeds/network-settings-sync.tsx), [native tabs](apps/mobile/src/features/settings/lib/settings-tabs.ts), [native feed cache consumer](apps/mobile/src/features/feed/state/use-feed.ts). No `/api/network/preferences` or `/api/network/topics` caller was found in native source.

## 2. Bluesky account, profiles, and post flows

- [ ] **B01 · Missing · P1 — Bluesky account connection card.** Add connect, reconnect, disconnect, linked handle, active/reconnect-needed states, and the verified-email requirement to native Account settings. ASM-owned external follows already exist and must remain usable without linking Bluesky.
- [ ] **B02 · Missing · P1 — Complete the native Bluesky OAuth round trip.** Add the browser authorization launch, cancellation/failure handling, return into native, and refreshed session/connection state. This needs a server handoff review: the current link route sets an HTTP-only browser nonce cookie, while the callback requires that cookie and the ASM browser session and redirects to web Settings. A native API fetch plus opening the returned URL does not by itself complete that browser-state flow.
- [ ] **B03 · Missing · P1 — Actual Bluesky like/unlike.** Use `/api/protocols/bluesky/likes` for capabilities, viewer-specific state, mutations, pending/retry states, and reconnect guidance. Native currently displays an upstream heart/count but only provides the ASM amplification controller; the count is not an interactive Bluesky like.
- [ ] **B04 · Missing · P1 — In-app Bluesky profile screen.** Display external avatar/banner, handle, bio, counts, source identity, and ASM follow actions using the existing profile API. Native post author presses currently open `bsky.app` in the browser.
- [ ] **B05 · Missing · P1 — External author feeds and profile preview.** Add the Posts, Replies, and Media tabs with independent pagination/retry states; provide a native tap/long-press equivalent for web's external author preview and visible follow control. Reuse existing ASM profile presentation where appropriate.
- [ ] **B06 · Partial · P2 — Source-aware mentions and inline tokens.** Preserve Bluesky mention identity/navigation and distinguish mentions, hashtags, and links in the native rich-text renderer. It currently maps all supplied source segments with an `href` into generic URL pieces; source mentions do not receive the web's in-app external profile destination.
- [ ] **B07 · Partial · P1 — Full ASM response fleets under external posts.** The Respond action and publishing an ASM response already exist. Add the full response-post tree with post/media cards and independent `kind=responses` pagination. The external discussion read already includes initial response summaries, so this is not a claim that all responses are absent; native lacks the separate full response list used by web.
- [ ] **B08 · Partial · P2 — Hydrated external response parent.** When an ASM post responds to Bluesky, render the original post's author, text, media, and loading/unavailable/retry states. Native currently falls back to a short “Responding to a Bluesky post” link for `externalParent` instead of hydrating the source card.
- [ ] **B09 · Missing · P1 — Distinguish ASM save success from Bluesky sync failure.** Preserve the mutation response's `upstream` result and show retry/reconnect guidance when a locally successful action fails to sync. Native currently parses only `externalStateSchema`, discarding this result; web explicitly handles “Saved in asocialmedia; Bluesky sync failed.”
- [ ] **B10 · Partial · P2 — External detail page composition and warm navigation.** Bring the external detail screen onto the same native detail/header/response presentation as ASM, and seed an already-seen post from the feed while revalidating. Native already shares the post card, but its external screen has separate loading, header, and discussion orchestration and starts with `data = null` on entry. Preserve displayed content on transient read failures and preserve ASM discussion after confirmed source absence.

Evidence: [web account card](apps/web/src/components/settings/bluesky-connect-card.tsx), [OAuth start](apps/web/src/app/api/protocols/bluesky/link/route.ts), [OAuth callback](apps/web/src/app/api/protocols/bluesky/oauth/callback/route.ts), [web likes](apps/web/src/components/protocols/external-like-button.tsx), [web profile](apps/web/src/components/protocols/external-profile-page.tsx), [web author feeds](apps/web/src/components/protocols/external-author-feed.tsx), [web author preview](apps/web/src/components/protocols/external-author-tooltip.tsx), [web responses](apps/web/src/components/protocols/external-responses.tsx), [web parent hydration](apps/web/src/components/protocols/external-response-parent.tsx), [native external actions](apps/mobile/src/features/feed/components/external-post-actions.tsx), [native external screen](apps/mobile/src/features/feed/components/external-post-screen.tsx), [native mutation parser](apps/mobile/src/features/feed/lib/external-interactions.ts), [native parent card](apps/mobile/src/features/feed/components/post-embeds.tsx), [native inline content](apps/mobile/src/features/home/components/bio-content.tsx).

## 3. Spotlight search

- [ ] **S01 · Missing · P1 — Search ASM, Bluesky, or both.** Add the network selector, Bluesky profile/post result models and cards, internal destinations, and the separate `/api/protocols/bluesky/search` request. Native currently calls only the ASM Spotlight endpoint; that endpoint does not return the remote results.
- [ ] **S02 · Missing · P2 — Search result type filters.** Match the All, People, Posts, and Communities controls and pass the selected `kind` to the appropriate endpoint. Community searches should remain ASM-scoped.
- [ ] **S03 · Missing · P1 — Interests and shared recommendations in the empty search state.** Add active-profile interests, topic suggestions, and recommended accounts/posts from the shared discovery suggestions service. Native currently starts from its existing history/empty state.
- [ ] **S04 · Partial · P2 — Source-aware recent search history.** Existing ASM server history, individual removal, and clear-all already work in source. Extend history with source/type/target metadata, Bluesky result destinations, and the guest/local recent-results behavior present on web; replay a query with its original network filter.
- [ ] **S05 · Missing · P2 — Search learning and independent network failures.** Record selected queries/accounts through `/api/recommendations/search`; isolate ASM/Bluesky loading and failures, abort obsolete requests, retain local results when remote search fails, and display partial/rate-limit retry feedback. Native has debounce and stale-response guards, but no second-network orchestration or search-persona learning.

Evidence: [web Spotlight](apps/web/src/components/search/spotlight.tsx), [web search orchestration](apps/web/src/components/search/use-spotlight-search.ts), [web source/history models](apps/web/src/components/search/spotlight-search.ts), [web discovery/search learning](apps/web/src/hooks/use-discovery-suggestions.ts), [native search API](apps/mobile/src/features/search/lib/search-api.ts), [native search history](apps/mobile/src/features/search/lib/search-history.ts), [native Spotlight](apps/mobile/src/features/search/components/spotlight-modal.tsx).

## 4. Explore and follow suggestions

- [ ] **E01 · Missing · P1 — Mixed ASM/Bluesky Explore posts and search.** Add external discovery/search cards to For you and Trending, send `surface=explore` and active-profile context, and avoid repeating Home's already-seen posts. Native still fetches its ASM post endpoints and does not maintain the web's cross-surface exposure exclusion.
- [ ] **E02 · Missing · P1 — External clips in Explore.** Mix Bluesky video posts into the Gusts grid and the top-clips rail, with provider-aware cards and navigation into the appropriate player.
- [ ] **E03 · Partial · P1 — Unified People / Who to follow recommendations.** Native already has ASM people suggestions, search, follow actions, and refresh. Add the shared `/api/recommendations/suggestions` results, Bluesky accounts/search, profile-scoped reasons and dismissals, and provider-aware follow controls. Do not label the existing native People tab as missing.

Evidence: [web Explore](apps/web/src/components/discover/explore-client.tsx), [web external cards](apps/web/src/components/discover/explore-network-cards.tsx), [web Gusts grid](apps/web/src/components/discover/explore-gusts-grid.tsx), [web People](apps/web/src/components/discover/explore-people.tsx), [web follow suggestions](apps/web/src/components/recommendations/who-to-follow-suggestions.tsx), [native Explore API](apps/mobile/src/features/explore/lib/explore-api.ts), [native Explore screen](apps/mobile/src/features/explore/components/explore-screen.tsx).

## 5. Gusts reel

- [ ] **G01 · Missing · P1 — Bluesky video discovery in the native reel.** Add mixed-source loading, the source selector, video-only discovery, deduplication/continuation for each source, and external-video deep links. The current native reel loads only `/api/gusts`; existing Home video/media viewing is a separate feature.
- [ ] **G02 · Missing · P1 — Provider-aware reel actions and chrome.** Use external bookmark/amplify/like/follow/discussion/share actions for external clips, show external author/source identity, and hide unsupported caption/transcript controls. Native external media viewing already gates text controls, but the Gusts card/action stack does not yet have external-provider handling.
- [ ] **G03 · Partial · P1 — Persona and learning parity for Gusts.** Add active profile, Network scope, locale, safety/topic eligibility, and source-specific event routing to reel requests and caches. Existing ASM recommendation events, Following/Latest/For you modes, and playback controls should be retained.

Evidence: [web mixed reel](<apps/web/src/app/(main)/gusts/client-gusts.tsx>), [native reel](apps/mobile/src/features/gusts/components/gusts-screen.tsx), [native Gust card](apps/mobile/src/features/gusts/components/gust-card.tsx), [native Gust API](apps/mobile/src/features/gusts/lib/gusts-api.ts), [native Gust state](apps/mobile/src/features/gusts/state/use-gusts-feed.ts), [existing external media gating](apps/mobile/src/features/post/components/post-media-screen.tsx).

## 6. Home feeds, safety, links, and shared presentation

- [ ] **F01 · Partial · P1 — Current Network feed request contract.** Add active profile, Network scope, locale, and the relevant discovery surface/content parameters to native ASM and Bluesky reads and head probes. Native has the feeds already, but its ASM fetches omit the `network` parameter that selects the newer Network path for Latest/Trending, and its Bluesky hook exposes only mode/viewer/following. Some server filtering and personalization already apply without these parameters; this is a parity gap, not a claim that native has no personalization.
- [ ] **F02 · Missing · P1 — Client policy and signed Network learning.** Apply current topic/avoided-topic/explicit-content policy to rendered and cached candidates, wait for preferences before exposing discovery results, and send signed `networkRecommendationToken` events to `/api/network/events`. Native's existing recommendation queue sends ASM events only, and its Home impression sampler receives only ASM posts. Server-side interaction learning already exists; do not duplicate it or send external IDs to ASM-only telemetry.
- [ ] **F03 · Mismatch · P2 — Bluesky new-content pill and stable feed head.** Buffer source head changes and combine their count/avatars with the existing ASM new-content pill. Native's Bluesky store currently prepends fresh posts immediately, while its pill counts only ASM `newItems` and is hidden in Bluesky-only mode. Preserve scroll position and the current continuation when accepting new items.
- [ ] **F04 · Partial · P2 — Feed tuning controls and persistence.** Native already offers All networks / ASM / Bluesky. Add the active-profile switcher, profile interest/activity summary, Manage shortcut, reset affordance, Following explanation, and persistent source selection. Its current source store is in-memory; web persists source selection.
- [ ] **F05 · Partial · P1 — Canonical sharing and web-to-native link routing.** Offer the ASM external-discussion URL when sharing a Bluesky post, alongside opening its source. Map web external post/profile/media URLs and community post/slugs to valid native screens. Current external shares send the `bsky.app` URL, native has no `/network/bluesky` route alias, and the push mapper handles post/Gust/conversation paths but falls back for external/profile/community destinations. Review HTTPS app/universal-link configuration too: current Android intent filters expose custom schemes, and iOS lists `webcredentials` rather than `applinks`.
- [ ] **F06 · Partial · P2 — Shared post-text and menu presentation.** Port the newer compact blank-line spacing and layout-based Show more behavior to both ASM and Bluesky, preserving normal bio spacing and typed pills. Native still uses a character-based clamp through `BioContent`. Align the external mute-author icon/menu treatment with the updated web control; native still uses the volume-mute glyph. These are source differences; visual parity needs device verification.

Evidence: [web Home request context](apps/web/src/components/home/home-feed.tsx), [web Bluesky feed](apps/web/src/components/protocols/use-bluesky-feed.ts), [web content policy](apps/web/src/lib/posts/network-content-policy.ts), [web Network telemetry](apps/web/src/components/recommendations/recommendation-tracker.tsx), [native feed requests](apps/mobile/src/features/feed/lib/feed-api.ts), [native Bluesky state](apps/mobile/src/features/feed/state/use-bluesky-feed.ts), [native immediate prepend](apps/mobile/src/features/feed/lib/bluesky-feed.ts), [native feed list/pill](apps/mobile/src/features/feed/components/feed-list.tsx), [native source store](apps/mobile/src/features/feed/state/feed-source-store.ts), [native tuning menu](apps/mobile/src/features/feed/components/feed-source-menu.tsx), [web tuning menu](apps/web/src/components/protocols/feed-source-menu.tsx), [web post URLs](apps/web/src/lib/posts/post-url.ts), [native push mapping](apps/mobile/src/features/notifications/lib/push-path.ts), [mobile app config](apps/mobile/app.json), [web inline text](apps/web/src/components/posts/content/post-inline-content.tsx), [native external menu/share](apps/mobile/src/features/feed/components/bluesky-post-card.tsx).

## 7. Additional confirmed gaps outside Bluesky

- [ ] **O01 · Mismatch · P1 — In-app notification destinations.** Route user notifications to native profiles, community notifications to community detail, and conversation notifications to the existing Messages/Dens screen. The live in-app dispatcher still sends user/community targets Home and tells readers Dens are web-only. Push conversation links already have a native mapping, so audit push and in-app taps separately. Preserve ended-membership/removed-subject notices where there is no valid destination.
- [ ] **O02 · Partial · P2 — Den member-picker eligibility.** Consume group-add refusal/eligibility state, explain and disable ineligible choices, and add the web picker's recent-people flow where appropriate. Native has create/join/roster/admin screens, but its shared search-user type omits `addRefusal`, and the create/add pickers currently select people without displaying that state. The server remains authoritative.
- [ ] **O03 · Missing · P2 — Credential-change advisory calls.** Match the web's `/api/users/credential-notice` calls after relevant successful passkey and backup-code changes. Native security controls exist, but no caller for this advisory endpoint was found. Verify against auth-side notice hooks before adding calls so a user does not receive duplicate emails.
- [ ] **O04 · Missing · P3 — Recently viewed posts UI.** Web has a signed-in `/api/posts/history` card that includes the current presented-post flow. Native records some post visits but has no history reader/UI. Choose an appropriate native entry point; a desktop sidebar does not need to be copied literally.
- [ ] **O05 · Partial · P2 — Shared Messages content pagination.** Preserve accumulated media/posts/links when loading older shared items and reconcile index/content changes like web's incremental reader. Native already has all three shared-content tabs, but its reader sets `references` to the current page and advances a single cursor, replacing previously displayed rows rather than accumulating them.

Evidence: [native in-app dispatcher](apps/mobile/src/features/notifications/lib/notification-target.ts), [native dispatcher caller](apps/mobile/src/features/notifications/components/notifications-screen.tsx), [existing conversation route](apps/mobile/src/app/messages/[conversationId]/index.tsx), [existing native join route](apps/mobile/src/app/messages/join/[code].tsx), [web member picker](apps/web/src/components/messages/member-picker.tsx), [native create/join picker](apps/mobile/src/features/messages/components/den-dialog.tsx), [native roster](apps/mobile/src/features/messages/components/den-roster.tsx), [native search-user contract](apps/mobile/src/features/messages/lib/client.ts), [web credential advisories](<apps/web/src/app/(main)/settings/tabs/security-settings.tsx>), [native Security](apps/mobile/src/features/settings/components/security-tab.tsx), [web history card](apps/web/src/components/posts/views/post-history-card.tsx), [native shared-content reader](apps/mobile/src/features/messages/components/conversation-details.tsx), [web incremental reader](apps/web/src/components/messages/use-shared-refs-reader.ts).

## Already present in current native source

Do not schedule these as complete rewrites. They still need release verification against the installed app:

- Mixed ASM/Bluesky Home feeds, source switching, and ASM-owned external Following.
- Bluesky post cards through native ASM card/detail primitives, images/video, link embeds, quoted content, and basic Show more.
- ASM-local external bookmarks, amplification, comments/deletion, Respond publishing, Not interested/Undo, and mute-author controls.
- Separate external saved/amplified library and follow-management screens.
- External full-screen media support and source-aware caption/transcript hiding there.
- SSE/feed read triggers, cursor deduplication, retry behavior, and retention of existing content after background read failures.
- ASM Explore/People, Gusts Following/Latest/For you, playback controls, and recommendation-event infrastructure.
- Messages, Dens create/join/admin controls, encrypted history, search, attachments/image editing, shared media/posts/links, and message-key recovery UI.
- Community discovery/create/detail/rosters, ASM profiles and follow lists, account linking/collision UI, privacy/security controls, push setup, camera/composer, and Hacker News.

The existing `notifications/lib/den-link.ts` text saying Messages/Dens are unavailable is stale relative to the actual native route implementations. It is not evidence those features are absent. The in-app notification dispatcher still contains that behavior and is tracked by O01.

## Suggested implementation order

1. **Foundation:** N01–N07, F01–F02. Establish preferences, safety, profile scoping, and learning before expanding recommendations.
2. **Core Bluesky flows:** B01–B05 and B09, F05. Complete identity, authorization, likes, profiles, and link destinations.
3. **Discovery:** S01–S05, E01–E03. Reuse one source of suggestions and profile state.
4. **Video:** G01–G03. Reuse the established external actions and eligibility policy.
5. **Detail and polish:** B06–B08, B10, F03–F04, F06.
6. **Remaining parity:** O01–O05. O01 can be fixed independently and should be pulled forward if notification navigation is the next priority.

## Release verification tasks

- [ ] **Q01 — Identify the installed baseline and build the current source.** Record the APK's actual application version/build and source provenance where available. Distinguish source-only work from features actually missing in the installed `1.10.70`-era app; that exact historical diff is not established by this audit.
- [ ] **Q02 — Verify safety with guests, fresh accounts, and explicit opt-in.** Cover Home, Following, Explore, Spotlight, suggested accounts, Gusts, cached results, and external media. Verify avoided topics and unrelated-topic exclusion as well as adult labels. A blurred tile alone is not proof of default discovery exclusion.
- [ ] **Q03 — Verify shared persona and state transitions.** Change interests/language/region/profile on web and native; switch accounts and sign out; clear learning; reconnect/unlink Bluesky. Check stale pages, cached cursors, source selection, guest fallbacks, and recommendation isolation.
- [ ] **Q04 — Exercise external failures and pagination.** Test deleted/taken-down posts/authors, upstream timeout/429, partial search failure, pagination after empty/duplicate windows, new-content acceptance without scroll jumps, and local-save/upstream-sync failure with retry. Preserve ASM discussion when the source is gone.
- [ ] **Q05 — Verify navigation and device UI.** On a current release build, exercise external author/post/media links, browser OAuth return/cancel, community links, push and in-app notifications, response fleets, and shared-content older pages. Check light/dark themes, long content, pills, video lifecycle, and accessibility.
- [ ] **Q06 — Validate and record delivery per batch.** Add focused behavioral tests for each implementation batch, run repository lint/format and type checks, and record release-device results. Track implementation, automated checks, device verification, and release delivery separately; a checked item must not imply a commit, push, or deployment that did not occur.

This audit added documentation only. It did not implement the checklist, modify the database, or establish runtime/release parity.

## Audit validation

- All 39 implementation IDs and six verification IDs are unique, and every linked local source path exists.
- `bun run check-types` was attempted and failed in existing application code: `apps/protocols/src/ingestion-queue.ts:43:15`, TS1294, a constructor parameter property under `erasableSyntaxOnly`. This documentation audit did not change that file.
- Full repository `bun run check` uses write/fix flags. It was not run over the existing workspace during a documentation-only audit, to preserve existing edits. Check this new Markdown file independently.
- No runtime, device, installed-build, commit, push, or deployment validation was performed.
