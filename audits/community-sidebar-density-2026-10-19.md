# Community sidebar spacing review — 19 October 2026

## Findings and changes

The previous chat sidebar used 56 px channel rows with 8 px gaps, large rounded selections, and an extra two-line introduction above the list. Seven channels pushed the thread section far down the drawer. Posts and Chat also used different row spacing.

- Replaced the introduction with a single Channels heading and count, alongside a quiet create control.
- Standardized web channel and thread rows on one shared layout: 44 px minimum height, 2 px gaps, 8 px corners and aligned icons/text.
- Replaced large Posts/Chat pills with compact underlined tabs.
- Kept the app's typography, community accent, tactile outer surface and icon system.
- Narrowed tablet drawers from 384 to 320 px, retaining the exposed dismissal edge on small phones.
- Grouped Threads below a light divider, with the parent channel name as context. Long thread names can wrap to two lines.
- Added community slug beneath the mobile identity, improved metadata legibility, and reduced the selection marker's visual weight.
- Kept channel creation tucked behind its control; input, type options and submit button have touch-sized targets. The toggle exposes its expanded state and offers a clearly labelled cancellation action.
- Applied the same hierarchy to native, retaining 48 px native channel targets and native animation behavior.

The reverse-close dock fix was committed separately as `08a7fdc8` before this layout refinement.

## Verification

- 320 × 800 CSS-pixel phone: channel rows measured 44 px; document width remained 320. The thread shortcut ended at y=574.2, above the dock beginning at y=738.5. All seven channels and the thread shortcut were visible without list scrolling.
- Tablet drawer: compact 320 px panel, channel and thread navigation usable.
- Desktop expanded sidebar: inspected both app themes; thread title wraps within the narrower rail.
- Chat → Posts → field-notes route round trip passed with the shared navigation.
- Create-channel form opened, focused its name field, and cancelled without writing data.
- Thread shortcut and Back to channel retained their route context.
- Navigation render tests: 4 passed, 18 assertions.
- `bun run check` and `bun run check-types`: passed, including commit hooks.

Screenshots: `community-sidebar-density-2026-10-19/`.

Native changes have type validation; physical Android/iOS visual acceptance remains outstanding. The original dark theme and normal browser viewport were restored after testing.
