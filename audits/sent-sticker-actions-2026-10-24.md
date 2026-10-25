# Sent sticker actions

Replaced keyboard tile overflow menus on web and native with actions in the shared sent-sticker preview used by DM, DEN, and community chat. The preview loads the authenticated viewer's library membership before showing Add/Remove from My stickers and Add/Remove from favorites. Favoriting an unsaved sticker saves a private library copy first. Removal leaves sent messages intact. Web rows are at least 48px tall; native rows are 52px tall.

Delivery and saved-copy metadata now preserve the originating sticker media ID. The owner-scoped membership query matches library entries through this identity, and saving another delivery reuses an existing entry. Community message binding preserves the origin metadata. Changes notify open keyboards to reload their collection. Protected/disappearing/incognito media retain the existing save restrictions.

Validation:

- 18 save/membership API tests pass, including viewer access, quota and cleanup, origin matching, and copy reuse.
- One real database integration test passes for canonical/copy matching, owner isolation, favorite updates, and removal.
- All 10 community chat integration tests pass, including preservation of origin metadata during message binding.
- Full `bun run check-types` passes. Scoped oxfmt and oxlint pass. Root autofix was avoided to preserve unrelated local work.
- Browser control checks in the existing mocked anny DM pass: no tile action buttons; favorite add/remove; library removal; direct save-to-favorites; automatic grid refresh; transcript preserved; error/retry recovery; mobile and desktop layouts.
- Native code was typechecked, not exercised on a physical device.

The existing browser-local DM mock was extended for membership responses and left available. It is not persisted to the database and disappears on reload. Screenshot: `sticker-keyboard-followup-2026-10-24/sent-sticker-actions.jpg`.
