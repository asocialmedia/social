# Feed stall and Gust layout incident — 2026-10-21

## Production evidence

The audit inspected the ASM web, auth, media processing, database migration, main protocol coordinator, US East protocol worker, Postgres, Redis, ClamAV, observability, and object storage services through both Dokploy servers. The captured web/auth/database/cache/security-scanner logs contained no relevant errors. The migration container exited successfully. Both protocol containers were healthy but recorded upstream generator failures, restricted search requests, and read-worker timeouts. Healthy container probes did not establish healthy feed continuations.

Production tracing contained 503 responses for discovery continuations across Home and Explore. The browser was then authenticated to the affected account without changing its preferences. Trending returned 6 and 12 posts followed by empty pages with new cursors. Personalized Home returned 13, 7, and 6 posts; Latest returned 13, 13, and 1. Explore videos returned 3 posts followed by four empty pages with advancing inventory cursors. Those samples distinguish sparse continuation behavior from an entirely empty account feed. They are not a capacity or sustained availability test.

## Causes and fixes

- Mixed-source rendering staged all but one loaded post while either source was pending. Home also applied staging during pagination. Repeated continuations could keep successful content hidden. Staging now expires after 600 ms and Home/Gusts apply it only to initial source loading.
- An empty inventory stopped waiting after one second but discarded a refill that completed afterward. Refills now remain coalesced within a bounded 15-second background window, publish their items and next source position, and remain consumable by another inventory instance. A partial response without a cursor does not mark the source exhausted.
- The sentinel could continuously follow new empty cursors or retry failed Explore requests. Home, Following, and Explore now stop automatically after three pages add no new visible IDs, keep their continuation, and offer an explicit load/retry action. Source errors stop automatic retries; successful posts remain visible.
- Failed Network preference reads left disabled feed queries permanently pending. Preference reads now have an abortable deadline, and the feed surfaces offer the illustrated retry state when those reads fail.
- External video safety assessment rejected legitimate thumbnail redirects. A sampled production URL returned 302 from `video.bsky.app` to `video.cdn.bsky.app`, then a valid 112,719-byte, 1080×1080 JPEG. The downloader now manually validates at most three redirects against exact HTTPS image-host/path allowlists, preserving byte, time, and decode limits. Unsupported destinations and failed assessments still cannot publish a safe verdict.
- Explore used native video dimensions, making landscape Gusts short or square. Both providers now use a portrait 9:16 preview frame. Initial and continuation Gust skeletons share the responsive staggered masonry layout; post continuation skeletons use the same masonry construction.
- Home, Following, Explore, and Gust errors now use the existing `error.png`, accessible friendly copy, and premium 3D retry button. The previously empty Following retry handler now retries its failed source.

Earlier follow-registry logs included HTTP 403. During this audit an authenticated registry GET returned 200, and a deliberately invalid POST returned the route's 400 validation response. That probe made no lifecycle changes; it does not establish that every reconciliation task succeeded.

## Validation and delivery

Passed: 7,063 repository tests, two optional Gemini tests skipped, lint, all 14 workspace type checks, web production build, six real-Redis inventory integration tests, and five real-Redis ingestion integration tests. The ingestion readiness test now waits for its Redis connection before asserting coordinator permissions.

Regressions cover source staging expiry, retaining loaded posts through continuation errors, explicit retry, empty/duplicate pagination, completed delayed refills, partial-source recovery, valid video redirects, forbidden redirect destinations, and redirect loops. Actual browser component checks verified a loaded error illustration and working raised retry control, six revealed items after the staging deadline, and two staggered skeleton columns with a measured 0.5625 width/height ratio.

Full-app local browser validation was unavailable without local Postgres. T3 screenshot capture repeatedly timed out, and the terminal-browser fallback requires a terminal with graphics support. Browser DOM/geometry and component integration checks supplied narrower verification; no successful screenshot capture is claimed.

These are code changes prepared for deployment. Production probes above measured the existing release. Upstream Bluesky 403/502 responses and source scarcity remain external availability limits; the changes preserve useful work and present recoverable states rather than promising an unlimited inventory. Deploy the protocol coordinator, media worker, and web changes together before retesting the affected account.
