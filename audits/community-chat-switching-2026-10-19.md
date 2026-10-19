# Community channel loading — 19 October 2026

## Cause

Channel selection performed a server-component page navigation, re-authenticated and reloaded community context, remounted the chat, and then requested channels, history and threads. The transcript waited for all three responses. Local development mount replay also launched duplicate requests because cleanup only ignored results instead of cancelling requests.

## Change

- Room changes inside a mounted community now use Next's supported native history integration and `usePathname`. Refreshes and initial deep links retain the server routes and their access checks.
- The channel list lives in a viewer-and-community-scoped workspace. Switches reuse the list for 15 seconds, with stale metadata refreshed in the background on room changes. They do not re-record a community visit.
- History and thread requests run independently; slow or failed thread metadata cannot hold up the transcript. Metadata failures have their own retry state.
- New room timelines remain isolated and get fresh server-authorized history. No message cache was introduced. Kind, room ID and thread parent checks are retained in the client transition path.
- Leaving a room aborts outstanding requests and ignores late responses. Abandoned development mounts do not start requests.
- Initial server page loads fetch session and community identity in parallel.
- The community avatar's accent ring/shadow is removed on web, and its native border is removed as well.
- Loading no longer briefly claims the viewer cannot send before permissions arrive.

## Local browser observations

Before, a switch from slow-mode to announcements made a server-page request; the client chat requests began about 494 ms after that request began. History requests returned headers in about 449 and 517 ms; thread requests took about 482 and 523 ms. Both resources and the channel list were requested twice. The critical network chain was roughly one second.

After, an announcements-to-field-notes switch made no server-page request, channel-list request or visit request. It made one history request (about 192 ms to headers) and one thread request (about 203 ms), followed by the normal private read update and room event stream.

These are individual localhost development observations with different channels and cache warmth, not a production benchmark or percentile measurement. The eliminated request chain and duplicate work are the verified improvement.

The header avatar's computed border width is `0px` and box shadow is `none`.

## Verification

- Channel switching, thread summary links, Back to channel, browser Back/Forward and a refreshed thread deep link.
- Leaving chat for Posts and returning with browser Back.
- Unit coverage for independent history loading, failed/denied resources, cancellation, abandoned mounts, URL parsing and thread parent validation, plus existing navigation regression coverage.
- `bun run check` and `bun run check-types` passed, including native avatar type validation.

No physical native-device performance or load benchmark was run. Native timeline loading is unchanged; the navigation/request optimization is in the web client.
