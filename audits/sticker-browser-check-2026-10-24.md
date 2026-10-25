# DM expression keyboard browser acceptance — 2026-10-24

Status: mocked browser acceptance completed for the cases below. This is not a live storage/worker or two-account end-to-end pass.

The localhost in-app Chromium browser used the production DM components with tab-scoped intercepted conversation, sticker-library, delivery, GIF, upload, and processing responses. The peer, messages, library entries, and delivery records were disposable browser fixtures. No actual DM or sticker library entry was created by these mocked interactions.

## Results

| Case | Result |
| --- | --- |
| Emoji, GIF, and Sticker tabs | Passed |
| Emoji insertion in the middle of a typed draft | Passed |
| GIF selection, attachment staging, send, and preserved caption | Passed with mocked provider/upload responses |
| Static image and animated GIF creation, naming, save, and sending | Passed with mocked processing/output responses |
| Failed delivery preparation and retry | Passed; the retry reused its operation ID |
| Simulated 1,000-sticker rejection and retry without reupload | Passed after retaining pending creation controls |
| Draft preservation while sending stickers | Passed |
| Static/animated sticker image rendering | Passed with local WebP fixtures; actual conversion fidelity remains unverified |
| Shared Media gallery excludes stickers | Passed after correction; the GIF remained in Media |
| Favorites, Recent, and removal | Passed against disposable library responses |
| Pagination | Passed: 40 → 80 → 83 tiles; final page removed Load more |
| Narrow-screen web picker | Passed at a 390 × 844 viewport; tabs, library, creation, scrolling, and composer remained usable |
| Oversized-file browser rejection | Unverified; the file chooser stalled and the resulting run was inconclusive |

## Corrections

- Excluded sticker payloads and persisted sticker references from the conversation Media gallery and shared-media index while retaining the media reference needed for send authorization.
- Kept processed pending sticker sources and Save/name controls visible after a save failure on web and native, allowing retry without another upload.

## Automated checks

- Focused conversation-media and shared-reference tests: **44 passed, 0 failed, 98 assertions**, including five new static/animated/persisted sticker regression cases.
- Web and mobile package typechecks passed.
- Scoped formatting and lint checks passed for the six changed source/test files.

## Evidence and cleanup

- [Desktop picker](sticker-browser-check-2026-10-24/desktop.jpg)
- [Narrow-screen picker](sticker-browser-check-2026-10-24/mobile.jpg)

Request interception was cleared, the viewport override was reset, the browser returned to the real empty Messages list, temporary public fixtures were removed, and the loopback screenshot receiver was stopped. Screenshots are retained as audit artifacts.

Live worker/S3 conversion, actual quota enforcement and concurrency, recipient-device delivery, incognito expiry, cross-account authorization, and physical native-device playback remain release validation work. The 1,000-sticker browser case exercises UI error recovery against a simulated server rejection; it does not prove the database quota.
