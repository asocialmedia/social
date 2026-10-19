# Community drawer and app dock — 19 October 2026

## Result

On web below 1280 CSS pixels, the community sidebar enters from the left over 250 ms. The existing app dock appears independently from below over 240 ms, moving 28 px and scaling from 0.96 to 1. Both stay in the same modal focus scope, so dock links remain accessible while the sidebar is open. Dock navigation closes the drawer. The channel list reserves bottom space to avoid covered destinations. Desktop retains its collapsible rail.

Native reuses the app dock inside the community drawer, with native-driven opacity and transform entrances. The native sidebar slides from the left. Narrow docks remove extra spacing below 360 px so every destination fits.

## Performance and accessibility

- Web animates transform and opacity, with no animated dimensions, blur radius, or looping effects.
- One static 6 px blur with a masked gradient covers only the shallow strip behind the web dock. Browsers without blur support retain the gradient.
- Reduced transparency disables blur. Reduced motion disables the sidebar translation and dock translation/scale, retaining the dock fade.
- Native uses a gradient fallback rather than introducing a blur dependency. Its short animations use the native driver and do not hold an interaction handle.
- Outside taps, Escape, close button and route selection dismiss the drawer. Focus returns to the menu trigger after dismissal.
- Hidden scroll-away web docks are inert and excluded from the accessibility tree.

## Checks performed

- Phone: Posts drawer → field-notes channel; drawer closes and chat retains its composer.
- Chat drawer: app dock Communities link opens the app's community directory and dismisses the drawer; browser Back returns to the chat.
- 320 × 800 CSS-pixel phone: dock bounds x=9.27 through 310.73; all seven actions fit. Document width stays 320.
- 767 × 1000 tablet and 1024 × 800 landscape tablet: drawer and app dock visible; 1024-wide drawer retains the left-slide entrance.
- Reduced-motion and reduced-transparency emulation: computed panel animation is `none`, blur is `none`, dock settles without a transform.
- 4× CPU-throttled browser smoke test: drawer, channel list and dock controls remained usable. This is not a physical low-end-device frame-rate benchmark.
- Outside-tap dismissal verified; zero visible dialogs afterward and focus restored to the trigger.
- Navigation regression tests: 4 passed, 18 assertions.
- `bun run check` and `bun run check-types` pass, including pre-commit validation.

Screenshots are in `community-dock-2026-10-19/`.

Physical Android/iOS and low-end hardware performance checks remain unverified. Temporary browser CPU, media-preference and viewport overrides were reset after testing.
