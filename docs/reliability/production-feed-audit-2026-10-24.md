# Production feed audit: October 24, 2026

## Scope and evidence

Web and shared APIs only. The audit used the signed-in parazeeknova browser session, both supplied Dokploy OpenAPI documents, service configuration, container statistics, the last hour of protocol logs, and read-only Redis inventory counters. Credentials and raw private configuration remain outside the repository. No Git commands, production configuration changes, deployments, or account preference changes were performed during diagnosis.

The checkout had no changed tracked files before implementation, checked against the Git index without invoking Git. Current branch metadata names dev. Existing incident reports dated October 21 describe earlier fixes; the present audit tests current production behavior independently.

## Production topology

| Service | Main deployment | Worker deployment | Role |
| --- | --- | --- | --- |
| Web | ASM, ghcr.io/asocialmedia/asm-web:latest, one replica | None | Next.js web and shared API orchestration at asocialmedia.cc |
| Auth | ASM Auth, asm-auth:latest | None | Better Auth at auth.asocialmedia.cc |
| Protocols | ASM Protocols, asm-protocols:latest, one coordinator | ASM Protocols US East, same image, read-worker mode | Public AppView reads, discovery, Jetstream and hydration |
| Protocol domains | proto.asocialmedia.cc | protoalt.asocialmedia.cc | Internal-token coordinator API and dedicated-token read worker |
| Worker limits | No per-app CPU/memory cap configured | One CPU, 1 GiB, upstream concurrency eight | The worker host has substantially more memory than this container's limit |
| Shared Redis | Redis 8.6.2 | Worker connects to the same Redis | Temporary public inventory, cache, cursor leases, events, BullMQ |
| Database | Postgres 18.3 | None | Users, preferences, persona signals, native posts and sessions |
| Media | ASM Media Processing, asm-media-processing:latest | None | Scan, transcode, analysis and asynchronous external visual-safety assessment |
| Supporting services | ClamAV, object storage, OpenObserve | Telemetry exported to main observability | Existing services reused |

The running protocol health endpoints reported version 0.1.69. All four primary app containers and the remote worker were healthy. The migration container had exited successfully. Health checks alone do not establish usable feed supply.

At one sampled instant web used about 465 MiB, main protocols 205 MiB and 34% CPU, and the remote protocol worker 87 MiB and 11% CPU. These are point measurements, not sustained capacity estimates. Unrelated applications on the shared main host were inventoried but not changed.

## Request and data paths

1. Home uses components/home/home-feed.tsx and components/protocols/use-bluesky-feed.ts. Native and Bluesky queries stay independent. The mixed list deduplicates content, tracks cross-surface exposures, and prefetches using an 8,000 px sentinel margin.
2. Gusts uses app/(main)/gusts/client-gusts.tsx, the same Bluesky hook with content=video, progressive discovery positions, sparse-page delay, video delivery, and a near-end prefetch threshold of eight remaining rows.
3. The browser requests /api/protocols/bluesky/discover. The web route resolves auth, request budget, network preferences, active persona, aliases and neighboring topics, then checks a shared head cache and calls the protocol service. Social/followed candidates join only where applicable.
4. The route applies interest, avoidance, language, explicit-content, feedback, safety and trending gates. It infers topic metadata, ranks and diversifies candidates, reads ASM interaction state, signs observation tokens, and returns Server-Timing.
5. apps/protocols/src/index.ts chooses DiscoveryInventory before live BlueskyDiscovery. Safe and explicit inventories are separate; opted-in readers can combine validated safe inventory with their explicit pool. Redis snapshots have byte/count caps and deletion/author invalidation fences.
6. BlueskyDiscovery keeps source buffers and opaque continuation snapshots. Focused profiles search selected interests; catalog generators and date-window recovery provide deeper source paths. Cached heads and continuations have separate leases and expiry.
7. createReadWorkerPool shares bounded public reads between local and optional remote capacity. The remote worker authenticates internal requests and allows only supported public operations. User credentials are not sent to workers. The client uses the cached public AppView except where search requires api.bsky.app.
8. Background watch reconciliation refreshes shared scopes. warmDiscoveryInventory follows source continuations. Jetstream queues relevant record IDs, getPosts hydrates batches of at most 25, and author-policy checks precede inventory insertion. Ranking remains on the coordinator/web side. Remote hydration uses the existing BullMQ queue.
9. New-post detection uses a shared SSE connection per viewer/locale plus bounded head polling. Pending items stay separate from visible query pages until merged or the pill is clicked. useSeamlessFeedHead also merges when the reader deliberately returns to the feed head.
10. External AI badges originate from explicit AI labels/self-labels, mapped by externalPostView into media fields. Native provenance processing is a separate pipeline. Unknown remote AI content is not automatically verified by the badge.
11. Better Auth's session-create hook and the security sessions endpoint enforce a transactionally serialized limit. Old session rows are deleted and revocation events are published. Web guards consume revocations; server-side session validation remains authoritative.

## Measured failures

| Probe | Observation |
| --- | --- |
| Initial signed-in Home | Bluesky discovery 3,480 ms; another page 2,635 ms; suggestions 6,015 ms |
| Native API sample | For You continuation 3,008 ms; Latest 3,103 ms |
| Media sample | Several derivative requests took 6,397–6,973 ms; resource timing reported HTTP 200 |
| Warm personalized head | 20 items in 367 ms; Server-Timing total 108 ms |
| Video continuation chain | Item counts 4, 0, 0, 0, 1; wall times 230, 1,127, 1,276, 1,214, 415 ms; all partial with continuations |
| Protocol logs | 83 local getFeed 502 cooldowns, 14 remote getFeed 502 cooldowns, 16 remote search 403 cooldowns in the captured sample |
| Jetstream logs | Reconnects, abnormal WebSocket closures, heartbeat timeout and cursor reconciliation |
| Safe inventory sample | 381 snapshots, 108 videos; only 12 captions mentioning anime, two of those videos; about 714 KB |
| Discovery cache capacity | Both safe and explicit source caches were exactly at the 512-entry cap, using about 12.1 MB and 6.8 MB of their former 32 MiB byte budgets |
| Persona | One selected interest, anime; neighboring terms included many encyclopedia partitions |
| Session listing | Four active sessions, matching the old configured limit |
| New-post pill | Collected 20+ new posts, remained at viewport y=69 while scrollTop=1,800, and click returned scrollTop to zero |

Counts are diagnostic samples and do not prove whole-hour totals, average latency, sustained throughput, or 1,000-user readiness. The sampled cooldown statuses were predominantly 502/403 rather than 429. A public.api.bsky.app search probe returned 403 while api.bsky.app returned 200. Moving all search traffic to the cached host would break that tested path.

A later probe against the unchanged production release returned 20 novel items on each of three personalized pages in 543–670 ms and three Latest pages in 519–563 ms. Trending returned 20, eight, then zero items in 401, 381 and 1,339 ms. This shows that warm ordinary inventory can be fast while sparse supply remains a separate failure. These are baseline observations, not results from the unshipped fixes.

## Implementation

- Scope remote search denials to the exact search request. A denied opaque cursor no longer blocks unrelated topics or fresh date-window searches for five minutes. Real 429 handling still respects the affected node/host's cooldown.
- Raise source snapshot storage to 4,096 entries and inventory continuation storage to 8,192 entries, each with a 64 MiB cap. Every writer sharing a source namespace uses the same limits; a lower-capacity background writer must not evict the larger reader's continuation set. The previously saturated 512-entry stores could evict deeper continuation snapshots before TTL expiry.
- Extend denied-cursor date-window recovery to ordinary discovery as well as video.
- Retain validated temporary inventory for ten minutes instead of two. The 2,000-post and 24 MiB caps, freshness gates, separate explicit policy, and immediate invalidation fences remain. Longer retention reduces repeated hydration during slow continuation warming, but increases the stale-metadata window when upstream invalidation is unavailable.
- Coalesce up to three sparse source pages per inventory refill within eight seconds. Persist every completed source position before attempting another page. The foreground still waits at most its existing one-second budget when no local rows are available; late arrivals remain consumable.
- Warm up to six video pages or three ordinary pages off the viewer request path, with an eight-second invocation deadline and retained continuation progress.
- Filter encyclopedia administration/partition queries and prioritize shorter usable neighboring concepts before long article titles. Explicitly selected interests and safety gates still determine eligibility.
- Probe Latest for new arrivals on personalized Home, keeping Trending and Following semantics. A stable ranked head no longer hides fresh eligible posts from this check. Advance the web query cache version.
- Preserve Bluesky AI declaration source when Gusts renders the badge, keeping the explanation accurate.
- Set the shared session limit to three newest active sign-ins and update web settings text.
- Include sanitized warmup failure codes, without cursors, payloads or credentials.

## Capacity decision

Do not add IP rotation as a substitute for shared caching, upstream backoff and approved AppView capacity. The captured failures do not establish an IP quota as the main issue. Additional ingestion replicas cannot repair denied cursors or guarantee that third-party generators respond.

Keep the existing coordinator, Redis and remote hydration worker for this rollout. Cloudflare Durable Objects can coordinate a long-lived WebSocket consumer, but that would add deployment and checkpoint ownership work and would still need AppView hydration and policy checks. A plain per-request Worker is not a persistent ingestion daemon. Evaluate a Cloudflare migration only against measured ingestion lag, resilience, traffic and operating cost after these fixes are deployed.

Sources: [Bluesky rate-limit guidance](https://bsky.network/docs/advanced-guides/rate-limits/), [Bluesky Jetstream client](https://github.com/bluesky-social/bsky/tree/main/packages/jetstream), [Cloudflare WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

## Verification and rollout

Validation completed:

- Repository suite: 7,688 passed, 12 skipped, zero failures across 888 files.
- Explicit real-Redis cache capacity and lease tests: two passed, including retaining an early continuation after 1,000 subsequent writes. These tests are skipped by the ordinary suite when PROTOCOLS_TEST_REDIS_URL is absent.
- Focused real Redis/Postgres inventory and session tests: ten passed, including concurrent three-session pruning, retention, opt-out/deletion fencing, and sparse continuation recovery.
- bun run check passed.
- bun run check-types passed for all 14 workspaces.
- The production web build passed.
- The Gust AI-label rendering regression and fresh-arrival probe regressions passed.

Production has not yet received these source changes. Git authorization was requested because AGENTS.md prohibits Git commands until explicitly authorized. No claim of skeleton-free production scrolling is justified until an immutable image containing the changes is built and deployed.

Deploy protocol coordinator/read-worker images first, then web and auth. No schema migration is required. Keep the current immutable image digests and environment backups for rollback. Confirm actual image digests and readiness, then repeat cold/warm personalized, Latest, Trending and Gusts continuation chains with default-safe and explicit-opt-in accounts. Test the new-post pill during scrolling and use disposable accounts for the fourth-sign-in eviction test.

Measure p50/p95 latency, items per page, consecutive empty pages, upstream request rate/status, inventory depth by active topic/video, Jetstream lag/reconnects, safety-queue delay, and provider budget. A longer buffer is not evidence that 1,000 concurrent viewers are supported. Production media failures and unlabelled AI detection need separate acceptance evidence.
