# Community chat implementation review — 18 October 2026

## Judgment

The implemented direction fits asocialmedia: communities retain their a/slug identity, avatar, accent palette, community role art, typography, Posts navigation, and tactile controls. Channels, announcements, threads, pins, replies, reactions, and slow mode use familiar server-chat terminology. Community remains the product noun. The transcript uses communal message rows rather than DM bubbles or receipts.

This is a functional, gated text-chat foundation, not completion of the entire launch contract. The 100,000-member ceiling is enforced transactionally; the 5,000-viewer / 50-send-per-second capacity target has not been proven. Production enablement should wait for the unfinished work and release evidence below.

## Corrections made during review

- Batch message hydration supplies actual community roles, reply references, aggregate reactions and pin state. Member and private-thread visibility filters apply before pagination.
- Concurrent sends and thread retries deduplicate; slow mode is checked under the timeline transaction lock. Stale message changes cannot overwrite newer revisions or resurrect tombstones.
- History respects both the 100-message and 1 MiB limits. Shared transcript merging respects 800 messages / 8 MiB with directional trimming. Permalinks load around the requested message.
- Live message broadcasts reuse parsed events and serialized bytes per process. Viewers no longer fetch history individually for each message. Durable changes recover gaps, Last-Event-ID reconnects and Redis subscription-generation changes. Replay is serialized and bounded; streams have authorization leases and buffer limits.
- Web anchoring preserves the visible message across prepend and transcript changes. Jump-to-latest fetches the current tail when older history is open. Reconnect status is distinct from new activity.
- Revoking room access removes the complete web/native chat presentation, including any open message, pin or thread panels; a delayed request cannot make those panels visible again.
- Web read state advances only while the page is visible and focused at the live tail. Native read state uses actually viewable messages while focused and foregrounded. Account and timeline changes remount private client state.
- Web message actions, pin browsing, reply context, named public threads, private-thread invitations, deletion confirmation and channel settings use existing app primitives. Private-thread creation explicitly discloses staff access.
- Native thread routes, notification channel/thread/message destinations, message actions, reactions and reply context are connected. Native members can edit/delete their own messages and follow/unfollow threads; staff can pin/unpin and remove messages. Pins open their message destination. Revision conflicts retain the edited draft and refresh the current preview. The channel drawer scrolls within a bounded height and exposes modal semantics.
- At 390 px, compact secondary header actions preserve the channel title. Message bodies keep the full available text width. Drawer creation controls no longer overlap its close button.
- Community accents resolve from the app theme class, including portaled dialogs and drawers. Light-theme accent values no longer leak into dark-mode chat.
- Backend, web and native feature gates prevent accidental production exposure. A separate write switch supports read-only rollback without removing stored messages or migration history.

## Verification completed

- `bun run check`: passed.
- `bun run check-types`: passed across all 12 configured monorepo tasks.
- 59 focused unit tests passed: payload limits, transcript bounds and stale-event handling, shared realtime serialization, rollout defaults, notification presentation, native notification destinations and revision-aware native management requests.
- 18 database-backed tests passed against a separate local PostgreSQL review database, including access by community visibility, private-thread exclusion, leave/rejoin invitation removal, concurrent retries, concurrent slow-mode sends, tombstones, UTF-8 history limits and the 99,999-member concurrent join boundary.
- All 14 migrations replayed successfully into that isolated database. The existing application development database was not migrated by this review.
- Browser inspection used the actual chat components with temporary deterministic API fixtures, at desktop and 390 px widths, in light and dark themes. Channel settings, pins, drawer navigation and the private-thread disclosure were exercised. The fixture route was removed afterward. This verifies rendering and control discovery, not an authenticated end-to-end browser workflow.

## Remaining implementation and release blockers

| Area | Required work |
| --- | --- |
| Media and shared posts | Connect the existing upload/scan/render pipeline; enforce room and source-message authorization on every derivative and serving path; retain source-post access rules. Current sends intentionally accept text only. |
| Search | Implement the separate community index, bounded revision-aware workers, authorized filters and keyset pagination, API and community search UI, incomplete-coverage states. |
| Notifications | Consume durable outbox work; resolve followers in resumable batches; deduplicate mention/reply/follow reasons; enforce mute/access at delivery; use generic private-thread push text. Presentation and deep-link support alone are insufficient. |
| Moderation | Complete reports and restricted evidence, staff sanction/audit endpoints and UI, ban/join/approval enforcement and timeout enforcement across posts and comments, and role-boundary regression tests. Existing chat sanction checks do not certify these broader workflows. |
| Realtime operations | Add coalesced community activity and scoped typing; prove stream behavior under proxy timeouts, Redis/queue loss, worker crashes and slow consumers. Long-running replicas and proxy buffering settings need deployment validation. |
| Client completion | Add mention composition, unread separators, durable account-scoped drafts/pending-send recovery, account-wide inactive-room cache budgets and native parity for private invitations and channel settings. Prove anchoring after late media measurement and resizing. |
| Membership | Expand approval/join mixed-race tests and audit every membership mutation and backfill at production scale. The existing join-race test changes the counter to the boundary; it does not insert 100,000 fixture members. |
| Capacity | Run the full one-hour 100,000-member / one-million-message fixture with 5,000 viewers and 50 sends/s, search and notification workers enabled. Record latency, index lag, rows/queries per send, locks, queue age, memory and bandwidth at each membership size. |
| Devices and rollout | Run authenticated browser end-to-end tests, physical iOS/Android keyboard/back/accessibility/deep-link tests, DM/den regressions, 100 room-switch memory checks, selected-community canary and rollback rehearsal. |

## Feature gates and rollback

| Environment variable | Purpose |
| --- | --- |
| `COMMUNITY_CHAT_ENABLED` | Server routes and server-rendered chat pages. |
| `COMMUNITY_CHAT_WRITES_ENABLED` | All chat mutation endpoints; disabled writes return 503 with `READ_ONLY` and `Retry-After: 60`. Read APIs remain available when the server gate is enabled. |
| `NEXT_PUBLIC_COMMUNITY_CHAT_ENABLED` | Web Chat navigation and chat page availability. |
| `EXPO_PUBLIC_COMMUNITY_CHAT_ENABLED` | Native Chat navigation and screen availability. |

Only the exact value `true` enables a flag explicitly. Missing flags default on in development/test, off in production or an unknown environment. Public flags are build-time values; changing them requires rebuilding the corresponding client. Server flags are process environment values and require the deployment's usual process restart. Server checks remain authoritative for old clients.

For write rollback, set `COMMUNITY_CHAT_WRITES_ENABLED=false` and restart replicas. For full disablement, also disable the server and public client gates. Preserve tables, durable work and migration state. Selective community canary targeting and the operational rehearsal remain unfinished.
