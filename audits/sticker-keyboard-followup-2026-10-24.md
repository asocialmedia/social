# Sticker keyboard follow-up — 2026-10-24

Implemented automatic sticker paging, a shared keyboard height, saving visible ordinary stickers, and larger phone controls.

## Product changes

- Web loads another 40 stickers when the scroll sentinel approaches the viewport. There is no Load more button. The native picker requests the next page near the bottom of its scroll view.
- Web keeps all three panels mounted, preloads the first library page, and caches visited collections for the lifetime of the account-scoped composer. Returning to the sticker tab does not refetch its library. Thumbnail images load lazily and decode asynchronously.
- Emoji, GIF, and Sticker panels share one bounded keyboard height on web and native.
- Phone sticker tiles have a separate full-width actions button below the send target. The web button measures 44 px tall, with 48 px favorite/remove menu rows; native uses a 44 px action button and 52 px sheet rows. Favorite and Remove no longer overlap the image's send target.
- Opening a transcript sticker offers Add to My stickers on web and native. The server checks the originating DM/den message or community message, copies both variants to a private owner-bound source, and applies the same atomic 1,000-item and 500 MiB library limits. Repeated saves are idempotent per viewer/source. Incognito, view-once, and disappearing messages cannot be retained through this action.
- Dens can use the sticker keyboard. Community web chat has a sticker picker and an authorized send path. Community sticker rendering and saving work on web and native. Community bytes are served through a message-specific access check; the sender's private library is never made public.
- Community deliveries are independent copies, bound to their message and retained by worker cleanup while that message is live. Delivery claims and retries are checked in the message transaction.

## Browser acceptance

Used the production components in an in-app Chromium tab with a disposable DM named anny, 85 fixture stickers, intercepted APIs, and fixture image responses. These browser sends did not write real DMs or library entries.

| Check | Result |
| --- | --- |
| Automatic paging | Scrolling loaded 40 → 80 → 85 stickers without a manual paging control |
| Sending | Two stickers sent through browser encryption and appeared in the transcript; a third send passed after installing the self-contained demo |
| Draft preservation | The typed draft remained after sends, saving, and tab switches |
| Saving | Add to My stickers changed to its disabled success state and the new entry appeared in the library |
| Warm tab return | Zero additional library requests after Emoji → Stickers |
| Keyboard heights | Emoji/GIF/Stickers each measured 420 px at the original viewport; each measured approximately 399 px under the narrow-screen override |
| Phone favorite action | Separate button measured 44 × 68 px; menu row measured 48 × 207 px; selecting Favorite issued one PATCH, changed the menu to Remove from favorites, and did not send another message |

Evidence: [DM](sticker-keyboard-followup-2026-10-24/dm.jpg), [phone actions](sticker-keyboard-followup-2026-10-24/mobile.jpg).

The browser is intentionally left on a usable, page-local anny demo. Its temporary fetch mock and fixture image observer handle the demonstration only; reloading removes them. CDP request interception was cleared, the viewport override reset, and the temporary screenshot receiver stopped. No public fixture assets were added.

## Checks

- Received-sticker API: 11 passing tests, including authorization, protected sources, private copies, quota rejection, and partial-copy cleanup.
- Community messaging integration: 10 passing tests against the configured local test database, including a prepared sticker, message binding, idempotent replay, and outsider denial. Disposable database fixtures are cleaned up.
- Conversation gallery/shared-reference regressions: 44 passing tests.
- Shared payload parsing: 6 passing tests.
- Full workspace typecheck and scoped formatting/lint checks passed.

Live object-storage copy/worker behavior and physical iOS/Android playback and touch interaction were not exercised in this follow-up. Browser network timing used immediate mock responses; the warm-tab result proves eliminated refetching, not a production latency benchmark.

## Top-right menu revision

The later requested layout supersedes the below-image actions described above. Web and native now place a 44 × 44 px menu button at each sticker's top-right corner. On web, hover-capable fine pointers see it on tile hover, keyboard focus, or while the menu is open. Touch pointers always see it. The two options are Add to favorites (Remove from favorites when already saved) and Delete sticker.

Browser verification confirmed desktop opacity 0 away from hover and 1 on hover; touch emulation reported no hover/fine pointer and a visible 44 × 44 px button. The menu opened with both options and favoriting changed its action to Remove from favorites. Touch emulation and viewport overrides were reset afterward. Web/mobile typechecks and scoped formatting/lint passed. [Updated phone menu](sticker-keyboard-followup-2026-10-24/top-right-menu.jpg).
