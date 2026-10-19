# Community chat acceptance report — 19 October 2026

## Verdict

The implemented text-chat flows passed the local functional checks below after fixes. The original community-messaging release plan is not complete or release-certified. Native device acceptance, production performance, and several planned product features remain outstanding.

Testing used the local development application at `http://localhost:3000`, PostgreSQL and Redis, and the synthetic **The Open Table** community at `/a/community-chat-playground`. The owner is `anny`. Fixture accounts also cover moderator, member, private invitee, pending applicant, and timed-out member. No production services were tested.

## Fixes delivered during this audit

1. The channel selector opens as a full-height left drawer on web, with safe-area padding, bounded width, an accessible expanded state, reduced-motion support, and focus restoration. Native now uses a left-anchored panel with a fade transition; physical-device verification remains pending.
2. Empty and oversized messages previously produced server errors. Sends, edits, and private-thread starter validation now produce typed input errors. Added service regression coverage; HTTP checks confirm invalid sends return 400.
3. Request-bound chat pages now have Suspense loading boundaries, resolving the observed Next development warnings during channel and thread navigation.
4. The development query inspector launcher overlapped mobile Send. It is now hidden below the desktop breakpoint; browser sending was verified afterward.
5. Guests signing in from chat return to the requested channel or thread. The return-path validator rejects external destinations. Credential sign-in was verified in the browser; the two-factor branch was updated and typechecked but not exercised with a two-factor account.

## Automated evidence

| Scope | Result | What it establishes |
| --- | --- | --- |
| Community database suite | 77 passed, 0 failed; 486 assertions | Service-backed policy, membership, chat and related community regressions |
| Shared chat contracts/features/timeline | 8 passed | Shared client contracts and timeline behavior |
| Web navigation/events | 4 passed | Navigation and event handling helpers |
| Native chat API adapter | 3 passed | Native transport adapter behavior |
| Notification presenter | 29 passed | Presentation and deep-link mapping, including existing messaging regressions; not delivery |
| Login return paths | 3 passed | Internal destination preservation and external redirect rejection |
| Real HTTP acceptance | 15 scenarios passed, 0 failed | Authentication, API policies, persistence and live streams |
| `bun run check` | Passed | Repository formatting and lint |
| `bun run check-types` | Passed | Script and workspace type checks |

These are 124 distinct automated tests plus 15 HTTP scenarios, not the entire repository test suite. The database suite includes the concurrent activation race at a counter value of 99,999; it does not prove performance with a real 100,000-person roster.

The final HTTP run is recorded in [community-chat-http-acceptance.json](community-chat-http-acceptance.json), run `ea6f9e50`, executed at `2026-10-19T05:22:17.365Z`. Its durations include deliberate request pacing and development-server overhead; they are not latency benchmarks.

### HTTP scenarios

- Guest public history access and contribution denial.
- Pending and timed-out member restrictions.
- Announcement and locked-channel write restrictions.
- Private-thread secrecy across history, thread lists, changes, pins and event endpoints; authorized owner, moderator and invitee access.
- Bounded member suggestions excluding pending applicants.
- Staff channel creation/rename/order/topic controls and member denial.
- Malformed, empty and oversized input validation.
- Concurrent retry deduplication and decimal-string timeline sequences.
- Replies, edits, revision conflicts, reactions, staff-only pins and mutation permissions.
- Public replies remain available after their source becomes a tombstone.
- Private invitation grant/revoke, following, lifecycle controls and starter privacy.
- Private read watermarks and persistent mute preferences.
- Live SSE delivery and durable replay after reconnect.
- Revocation of an already-open private stream after invitation removal. The test allows the five-second authorization lease plus one second of transport allowance; this is a local functional check.
- Concurrent slow-mode enforcement and archived-channel write denial.

## Browser acceptance

Verified through real UI interactions as owner, member and guest:

- Posts/Chat navigation, retained New/Top feed controls, channel selection and dedicated public-thread navigation with Back to channel.
- Owner channel creation, message send/edit, reaction and pin; member send and quoted reply.
- Member menus exclude staff and other-author edit/delete actions. Announcement writing explains the restriction.
- Private thread omitted for a non-invitee; direct private-thread navigation returns the generic not-found page.
- Follow/unfollow controls, pinned-message navigation, message URL anchors and jump-to-latest presentation.
- Guest read access and sign-in continuation back to the same channel; browser restored to `anny` on general in dark mode.
- All three seeded post image previews loaded through the image proxy. These are community post previews, not chat attachment uploads.
- Left drawer closes with Escape and outside click; focus returns to its selector button.
- Light and dark appearance, mobile portrait, narrow width and landscape layouts. No horizontal overflow was measured in the sampled viewports.

Measured CSS viewport samples: at 341 × 738 the composer remained within the viewport; at 738 × 341 the transcript retained approximately 207 pixels of scrollable height and the composer stayed within the viewport. At 320 × 800 the drawer was 276 pixels wide and full-height, leaving 44 pixels outside for dismissal. These are browser viewport simulations, not physical keyboard or safe-area certification.

Screenshots:

- [Mobile left drawer](community-chat-e2e-2026-10-19/mobile-drawer.jpg)
- [Mobile conversation](community-chat-e2e-2026-10-19/mobile-chat.jpg)
- [Desktop light theme](community-chat-e2e-2026-10-19/desktop-light.jpg)

## Remaining product and release gaps

- Chat attachment upload and shared-post message payloads are not implemented in the current text composer. Complete media authorization, quarantine and derivative checks before claiming attachment support.
- Community message search/indexing, typing indicators and mention composition remain outstanding. Member lookup is not message search.
- Mention/reply/followed-thread notification delivery workers and end-to-end push delivery were not established by this audit. Presenter tests alone do not prove delivery.
- Complete moderation reporting/evidence and staff sanction UI/API flows remain outstanding. Existing timeout/ban contribution policies do not cover the full planned moderation surface.
- Native private-thread creation and the rest of the native UX require completion and device acceptance. `adb devices -l` reported no connected device; no Android or iOS physical run was performed.
- No sustained 5,000-viewer/50-message-per-second test, million-message dataset, deployment/reference RTT benchmark, or real 100,000-member performance test was run.
- Redis reconnection loss, queue loss, worker crashes, slow-consumer stress, long-history anchor drift, account-wide cache eviction, 100 room switches and memory bounds still need dedicated failure/performance testing.
- Actual screen-reader, mobile keyboard, back-gesture, notification-link and physical safe-area acceptance remain pending. Keyboard focus and accessibility semantics were checked on web.
- Production build, canary rollout and rollback rehearsal were not run. The full DM/den regression suite was not run; only the relevant notification presentation regressions listed above were included.

## Execution notes and cleanup

The HTTP harness initially exceeded the existing authentication burst budget (30 requests per five seconds), which could surface as temporary unauthenticated responses. The harness now paces requests; security limits were not weakened. Authentication behavior under sustained chat load remains a release concern to validate.

The development watcher initially served stale compiled service code and did not discover an existing route until refreshed. After refresh, the final HTTP run passed. This is a development execution caveat, not production reliability evidence.

HTTP-created temporary channels are archived in cleanup, and mute preferences are restored. Synthetic fixture accounts and their test sessions remain available locally. The browser-created `browser-audit` channel and its audit messages may remain as reviewable test data; seeded channels were preserved.

## Reproduction

With local services, the populated playground and the web application running:

```sh
bun --env-file=.env.test test --parallel=4 --timeout 30000 ./packages/db/src/communities/
bun test packages/messages/src/community-chat.test.ts packages/messages/src/community-chat-features.test.ts packages/messages/src/community-chat-timeline.test.ts
bun test apps/web/src/lib/communities/chat-navigation.test.ts apps/web/src/lib/communities/chat-events.test.ts
bun test apps/mobile/src/features/communities/lib/community-chat-api.test.ts
bun test packages/notifications/src/shared/presenter.test.ts
bun test apps/web/src/lib/auth/login-return-path.test.ts
bun scripts/testing/community-chat-acceptance.ts
bun run check
bun run check-types
```

The acceptance harness is deliberately restricted to localhost and the synthetic playground. It writes test content, archives its temporary channels and overwrites its JSON result artifact. Use per-file isolation (`--parallel=4`) for the community suite to avoid unrelated Redis module mocks leaking between test files.
