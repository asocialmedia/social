# Community navigation verification — 19 October 2026

Community: The Open Table (`community-chat-playground`), local app, signed in as `anny`.

## Change

Posts and Chat share community navigation. Desktop uses a collapsed icon rail that expands into community identity, Posts/Chat links and channels. Expansion preference persists across routes and reloads. Mobile uses a left drawer; selecting a destination dismisses it. Existing Posts/Chat section tabs remain available on Posts. Chat retains thread-to-channel back navigation. Native Posts and Chat reuse one safe-area-aware left drawer with channel loading/retry and Android back dismissal.

Channel shortcuts use the existing authorized channel endpoint and load only when navigation opens. Only the desktop expansion preference is persisted; channel and private-thread data are not stored in the navigation preference.

## Browser checks

- Desktop: expand/collapse rail, switch channel, Chat → Posts → channel, retained expansion.
- Mobile: shared drawer available from both Posts and Chat; Posts → field-notes channel; channel selection dismisses drawer.
- Thread: opened public thread from channel message, retained separate sidebar action and Back to channel; returned to field-notes.
- Keyboard: Escape dismisses drawer and restores focus to its trigger after the exit animation.
- Narrow viewport: 320 × 800 CSS pixels; document width 320; transcript width 320 and height 665.8; composer bottom 784.5, within viewport.
- Landscape: 800 × 400 CSS pixels; document width 800; transcript width 798.5 and height 265.8; composer bottom 384.5, within viewport.

## Automated verification

- `bun test apps/web/src/components/communities/page/community-workspace-navigation.test.tsx`: 4 passed, 18 assertions.
- `bun run check`: passed.
- `bun run check-types`: passed across all 12 typecheck tasks, including web and native.

## Limits

Native Android/iOS behavior has type validation and uses the existing routing/API pipelines, but physical-device keyboard, back gesture and screen-reader acceptance were not run for this change. This navigation audit does not certify the broader messaging load targets.

Screenshot: `community-sidebar-2026-10-19/mobile-drawer.png`.
