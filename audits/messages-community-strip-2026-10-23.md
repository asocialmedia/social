# Messages community navigation audit

Scope: desktop, tablet, and mobile web Messages. Preserve the existing DM/den list and Asocialmedia surfaces while adding an icon-only community strip inside the Messages workspace.

| Finding | Implemented behavior |
| --- | --- |
| Messages offered no direct route into joined community conversations. | A 64px strip shows active joined communities with their existing avatars. Desktop icons link to community chat; hover or keyboard focus reveals the existing community card. |
| Hover alone cannot serve touch screens. | Touch opens a dismissible popover with the same card and an explicit 44px Open community chat action. Escape and outside interaction dismiss it; focus returns to the trigger. |
| A permanent strip would reduce phone transcript width. | The strip is mounted on the mobile inbox and removed when a DM/den is opened. Desktop retains it while reading. Community navigation remains independent of DM encryption identity readiness. |
| Unread dots must reflect actual private read state. | A single batched database activity query checks readable rooms and message sequences. Own messages, tombstones, archived rooms/parents, unauthorized private threads, pending memberships, and bans do not generate activity. Community mute suppresses the dot while retaining the shortcut. Listing the inbox never advances read watermarks. |
| Many memberships must not create many subscriptions or client requests. | One viewer-scoped endpoint refreshes every 15 seconds in the foreground, on remount, and on focus. No per-community SSE connections or recipient fanout. Existing indexed membership, room, message-sequence, and read-state storage is reused; no migration. |
| Cached content must not cross accounts or shared caches. | The query key includes the viewer ID, requests support cancellation, and responses use private/no-store with Vary: Cookie. Failed refreshes replace shortcuts with a retry control rather than presenting stale protected previews. |
| Landscape previews can put the primary action below the viewport. | Previews have a viewport-bound height and scrolling content; the opaque action footer stays visible. |
| The discovery card's default aura value would show a misleading zero. | Compact previews omit aura when no aura summary was loaded. Directory cards retain their current behavior. |

## Browser verification

Tested in the in-app Chromium browser using the local @anny fixtures, with touch emulation for phone/tablet interaction.

| Viewport   | Strip width | Icon target | Document overflow | Search width |
| ---------- | ----------- | ----------- | ----------------- | ------------ |
| 320 × 740  | 64px        | 44 × 44px   | 0px               | 131px        |
| 390 × 844  | 64px        | 44 × 44px   | 0px               | 202px        |
| 768 × 1024 | 64px        | 44 × 44px   | 0px               | 163px        |
| 844 × 390  | 64px        | 44 × 44px   | 0px               | 163px        |
| 1440 × 900 | 64px        | 44 × 44px   | 0px               | 195px        |

- Community icons have 8px vertical gaps, visible keyboard focus, accessible community names, and an unread announcement in addition to the colored dot.
- Desktop pointer hover and keyboard focus open the preview. Escape dismissal was exercised.
- Touch preview, dismissal/focus return, chat navigation to the general channel, and browser-back return to Messages were exercised.
- The 320px preview stays within horizontal bounds. The landscape preview is 366px high inside a 390px viewport, with its chat action visible.
- Both app themes were visually checked. Under prefers-reduced-motion, the preview's computed animation is none.
- Existing app navigation remains accessible; bottom safe-area/dock clearance is reserved in the strip.

## Automated verification

22 tests passed: four PostgreSQL integration tests, four endpoint tests, three shortcut rendering tests, five conversation-list regressions, and six list-layout regressions. Coverage includes 64-bit read watermarks, repeated reads without side effects, private invitations/removal/staff access, parent archival, own/deleted messages, mute, bans, membership removal, pending applicants, endpoint authentication, feature gates, cache headers, errors, touch semantics, and the existing DM/den list states.

`bun run check`, `bun run check-types`, and `git diff --check` passed.

## Limits

This is responsive web implementation. Physical iOS/Android devices, native screens, assistive-technology output, high-volume membership/traffic loads, and network-failure browser injection were not tested. The local account has no DM rows; conversation-list regression tests cover those layouts. A fabricated missing-conversation deep link remained on the existing Opening conversation fallback, so it is not counted as a successful live DM transcript acceptance test. Unread indicators intentionally update on the foreground refresh interval rather than immediately through an account-wide live stream.

## Screenshots

- [Desktop preview](messages-community-strip-2026-10-23/desktop.png)
- [Mobile inbox](messages-community-strip-2026-10-23/mobile.png)
- [Mobile preview](messages-community-strip-2026-10-23/mobile-preview.png)
