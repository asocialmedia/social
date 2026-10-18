# ASM protocols service

Elysia on Bun, in the existing Bun workspace. This service runs the Bluesky read boundary and an optional Jetstream consumer. Shared network adapters live in `@asm/protocols`; they do not depend on Elysia, Next.js, React, or the database.

Web and mobile Home feeds now render public Bluesky discovery alongside ASM posts, with an All sources / ASM / Bluesky dropdown beside the Home feed tabs. Durable external references, ASM comments, bookmarks, amplifications, and authored responses are implemented. Web cards, media, loading states, and Eddies reuse ASM components. Web author links open ASM-hosted profiles with public Posts, Replies, and Media tabs. Native profile parity, protocol-native writes, and federation remain later work. Starting this service does not import Bluesky history, create external ASM accounts, or enable remote writes.

Web discovery uses browser language and timezone-derived country as coarse relevance hints, with explicit device-language, English, and all-language choices. Locale is part of discovery cache and cursor identity. Declared languages and longer untagged text are filtered before recommendation-visibility reads; regional affinity boosts eligible candidates without guaranteeing nearby content. Cached Home pages survive detail/profile navigation, while new candidates wait behind the existing new-content badge until the badge is clicked or the reader scrolls back to the top. Web and native share one feed SSE connection per viewer and locale. ASM writes publish change hints after commit. Jetstream invalidations wake bounded discovery reconciliation; active public-generator candidate pools also reconcile on the server every twenty seconds to discover previously unseen authors. Only changed heads emit hints. Clients coalesce bursts and fetch only the head, keeping loaded pages and scroll position. Streams pause in the background, reconnect with a reconciliation greeting, and release their shared Redis subscriptions on abort.

## Packages

- Elysia: validated internal HTTP routes and health/readiness endpoints.
- `@atproto/lex` and `@bsky/sdk`: official public XRPC client, generated Bluesky schemas, and response validation.
- `@atproto/syntax`: AT identifiers, DIDs, NSIDs, and canonical record URI parsing.
- `@bsky/jetstream`: official v2 wire decoding and live transport, with explicit resource bounds and worker-owned reconnect/checkpoint policy.
- `@asm/logger`: Pino locally and OTLP export to OpenObserve, reusing the project's existing configuration.
- ioredis: ownership lease, checkpoint fencing, and ephemeral invalidation notifications. No source post bodies are written to Redis by the worker.

`@atproto/common-web` is a utility package, not an additional synchronization service. Add a direct dependency only when consuming one of its utilities. `@atproto/tap` connects to a separate Tap service for selective verified repo synchronization and backfill. It is not needed for the public AppView/Jetstream read path; reconsider it when implementing retained-reference reconciliation or native AT Protocol synchronization.

## Run locally

Install dependencies from the repository root with `bun install`. There is one root `bun.lock`; do not initialize this folder as a standalone project.

`bun run dev` at the root starts this service through Turbo alongside web, auth, and media processing. `apps/protocols/.env.development` supplies local defaults: loopback port 3012, readable Pino logs, an internal development credential, Redis, service-specific OpenObserve streams, and a Jetstream subscription restricted to the single `bsky.app` DID. No Bluesky API key is needed.

The service prints its version, URL, health URL, readiness URL, read status, and tracked-account count. `readsEnabled: false` means the internal credential is missing; it does not mean that the process failed to start. A stream can briefly report not ready while it acquires its Redis lease and connects.

Environment priority is injected variables, `apps/protocols/.env.local`, `apps/protocols/.env`, the root `.env`, then development defaults. The scripts disable Bun's implicit environment loading so this order stays consistent when launched from the root or the workspace. When `NODE_ENV` is absent, source execution defaults to development, matching the other local services. Production containers explicitly set `NODE_ENV=production`, never load `.env.development`, and reject the committed development credential.

Use `.env.local` for private local overrides. Root secrets and explicit values take precedence over development defaults. OpenObserve's local credentials match the existing development infrastructure; production credentials must be provided separately. The internal credential stays on the server and must never be added to `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` variables.

For deployment, use `.env.example` as the configuration reference and supply a generated production token. The minimal read-only settings are:

```text
PROTOCOLS_HOST=127.0.0.1
PROTOCOLS_PORT=3012
PROTOCOLS_INTERNAL_TOKEN=replace_with_a_random_url_safe_token_of_at_least_32_characters
PROTOCOLS_JETSTREAM_ENABLED=false
REDIS_URL=redis://your_internal_redis:6379/0
OTEL_SERVICE_NAME=asm-protocols
OPENOBSERVE_LOG_STREAM=asm_protocols_logs
OPENOBSERVE_METRIC_STREAM=asm_protocols_metrics
OPENOBSERVE_TRACE_STREAM=asm_protocols_traces
```

Generate a credential with `bun -e 'console.log(crypto.randomUUID() + crypto.randomUUID())'`. Do not commit the generated credential. The example placeholder is not a deployment credential.

From the root:

```sh
bun run --filter @asm/protocols-app dev
```

The environment loader uses the workspace location rather than the shell's current directory. Keep service-specific telemetry names explicit when the root environment contains another application's names.

For JSON stdout use `NODE_ENV=production`; development uses the existing Pino pretty output. Use the existing `OPENOBSERVE_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT` and credentials. Endpoint overrides and stream names follow `@asm/logger`. Tests verify exports against a local HTTP collector, not a production OpenObserve account.

## HTTP boundary

- `GET /health`: public liveness, independent of upstream availability.
- `GET /ready`: HTTP read readiness; returns 503 while draining or while configured Redis is recovering. Stream connection and leadership are reported separately, so a standby replica can serve reads.
- `GET /v1/capabilities`: supported sources, tabs, and write capabilities.
- `GET /v1/bluesky/discover?mode=latest`: public discovery with opaque continuation cursors. The default source is Bluesky's public What's Hot generator, which supplies posts from many authors instead of a fixed publisher list. Each refresh reads at most 30 candidates; selection favors distinct authors before filling remaining slots from repeat authors. Latest sorts the selected candidate window by date; ranked modes retain generator order among equally represented authors. `personalized` accepts ASM interest topics for candidate search and ranking; the web gateway derives them from the signed-in ASM recommendation profile and applies viewer exclusions. Logged-out readers share the locale-aware discovery fallback; Trending remains a popularity ranking rather than a Bluesky account timeline. Generator candidates respect recommendation opt-outs in every mode, with at most three concurrent policy reads. Unconsumed posts stay in temporary continuations, and canonical URIs deduplicate subsequent pages.
- `GET /v1/bluesky/profile?actor=bsky.app`: public profile represented as an external identity.
- `GET /v1/bluesky/author-feed?actor=bsky.app&tab=media&limit=20`: posts, replies, or media, with opaque cursor pagination.
- `GET /v1/bluesky/feed?feed=at%3A%2F%2F...`: an explicitly selected public feed generator.
- `GET /v1/bluesky/post?uri=at%3A%2F%2F...`: one public post; missing results are not proof of deletion.

All `/v1` routes require `Authorization: Bearer <PROTOCOLS_INTERNAL_TOKEN>`. With no configured token they return 503. Keep this credential on the backend. This is not ASM user authentication, a browser-facing API, or a substitute for per-user permissions. Do not expose the service directly to public traffic. Web/mobile integration must preserve ASM authorization and source visibility rules.

Routes return `Cache-Control: no-store`. Temporary upstream caching happens in the service, not in a shared HTTP cache containing internal credentials. Request IDs are validated or generated. Logs contain operation names, duration, status categories, and trace correlation rather than bearer credentials, query strings, or source content.

## Current limits and visibility

The in-process upstream cache has a 16 MiB UTF-8 payload/key budget and at most 256 entries; object/runtime overhead is additional. Profiles expire after 60 seconds, feed heads after 10 seconds, continuation feed pages after 30 seconds, and batched post reads after 10 seconds. The service permits at most sixteen concurrent upstream reads (the reusable adapter defaults to four), a five-second timeout per attempt, and a two-MiB response cap. The adapter retries transient read failures once with jitter; SDK retries are disabled. Invalid data, access restrictions, and 429s are not retried. A 429 starts a cooldown of at most five minutes within that reader. Five failed reads open a 30-second circuit; one probe tests recovery before normal reads resume. Shutdown cancels in-flight reads and retry waits.

Production discovery requires Redis even with Jetstream disabled. Discovery pages and continuations are shared across replicas in a temporary cache bounded to 32 MiB of keys/payloads and 512 entries. Redis object overhead is additional. Atomic refresh leases prevent replicas from refreshing the same page together and reject stale writes. A process coalesces identical requests and admits at most 32 distinct discovery requests, with a 12-second deadline. At most two cache misses build pages concurrently; each uses up to six rolling recommendation-policy workers. Independent feeds no longer wait behind a single discovery queue. Overload returns a retry hint instead of growing an unbounded queue. Active heads remain readable while a fenced background refresh builds their replacement. Head cache entries last sixty seconds, and reconciliation emits only after the replacement is stored. Continuation cache entries last thirty seconds, and their snapshots remain independent of head refreshes. Empty or duplicate continuation windows advance up to three cursors per load-more operation. Upstream adapter caches and circuits remain per process; use one replica initially and measure upstream traffic before increasing the replica count.

The web gateway caps concurrent protocol requests at 64 per process and applies shared Redis budgets before reads or feedback writes. Production ingress budgets use the trusted proxy identity; configure that proxy correctly. Feedback additionally has an account budget. Bodies have a two-KiB limit and deadline, cross-origin browser writes are rejected, and service redirects are disabled. Dependency failures produce safe errors with request IDs and retry hints; clients retain rendered content and retry transient failures with bounded backoff.

The current unauthenticated policy hides all actively labelled profiles/posts. This is intentionally conservative; it is not a complete implementation of Bluesky moderation, personalized label preferences, or recommendation visibility declarations. Ranked discovery now reads `app.bsky.actor.contentVisibilityDeclaration` and excludes authors who opted out of algorithmic recommendations. An outage or invalid declaration fails closed for that source. Unsupported embeds are omitted, and restricted/unavailable quotes do not expose their original content.

Browsing creates no database records and downloads no media into RustFS. The first authenticated bookmark, amplification, or comment creates one canonical external reference and a validated snapshot, capped at 64 KiB. Separate engagement and comment tables keep remote identities out of ASM accounts, native posts, and Aura. Unique keys deduplicate concurrent first interactions and retried comments. Saved lists and discussions resolve their source posts again through the AppView. Confirmed absence clears the retained snapshot while preserving ASM discussion. Upstream failures return a retryable error, preserving an already displayed post instead of replacing it with a successful unavailable result. Stream invalidation clears temporary adapter reads, with bounded TTLs on other replicas.

## Enable Jetstream

Set `PROTOCOLS_JETSTREAM_ENABLED=true`, `REDIS_URL`, `PROTOCOLS_ASM_URL` (the web service origin), and the same `PROTOCOLS_INTERNAL_TOKEN` used by web. `NEXT_PUBLIC_URL` is a fallback for the web origin; development defaults to `http://localhost:3000`. The protocol service reads the authenticated ASM follow registry every thirty seconds and reconnects only changed subscriptions. Database follows survive service/Redis restarts. `PROTOCOLS_BLUESKY_DIDS` is now an optional comma-separated seed list, never a user follow database. Do not rewrite environment files for follows. With no seeds or stored follows, the worker opens no socket. Each subscription contains at most 1,000 DIDs; at most 16,000 followed authors and 1,000 seeds are admitted. Empty filters can never turn into a network-wide stream.

ASM users can follow up to 100 public Bluesky accounts without connecting Bluesky. Web exposes Follow in ASM on external profiles and a management list beside the connection settings. Native exposes the action in each Bluesky post menu and management through the Bluesky library. Local follows populate the mixed Following feed and supply priority candidates to discovery; algorithmic candidates still honor recommendation opt-outs. Linking/unlinking Bluesky does not change this graph and no remote Bluesky follow is written. See [the design and research notes](../../docs/bluesky-local-follows.md) for cleanup, pagination, failure, and deployment behavior.

The default endpoint is `wss://jetstream.us-east.bsky.network`; the west v2 endpoint is also allowed. The worker subscribes to posts, profiles, content visibility declarations, thread gates, and post gates, retaining identity/account/sync events. Each incoming event is handled in order, the read cache is invalidated, and a Redis Lua script checks current ownership before advancing its cursor and publishing minimal invalidation metadata.

The transport has a one-MiB unread byte cap and a 256-KiB individual-message cap. It uses the official SDK's live-only flow and does not request metered archive replay. The worker owns retry backoff, deduplicates already committed sequences, and scopes checkpoints by endpoint and filter set. A changed endpoint or account/filter selection deliberately has a different checkpoint.

A Redis lease prevents duplicate active subscriptions for the same scope. A standby instance remains available for reads and reports its stream state separately. Lease loss aborts the socket; stale owners cannot advance checkpoints or release another owner's lease. Redis commands fail promptly while disconnected rather than accumulating offline; reconnection continues automatically and readiness recovers without a restart. Worker retries back off with jitter and resume from committed progress.

An outdated-cursor advisory pauses/reconnects without silently skipping to the tip. If it persists, operational reconciliation is needed; automatic historical recovery is not implemented. Do not describe this milestone as guaranteed gap-free synchronization. Source deletions invalidate temporary reads. Saved lists and discussions also revalidate retained records when read; this is read-time reconciliation, not guaranteed historical synchronization.

SIGINT/SIGTERM stop the stream, release ownership, stop Elysia, disconnect Redis, and shut down the OpenTelemetry providers. Use one replica initially. Multiple differently filtered instances can overlap authors; no cross-scope deduplication guarantee is implemented.

## Tests and checks

From the repository root:

```sh
bun test packages/protocols/src apps/protocols/src
bun run check
bun run check-types
```

The suite exercises official SDK response validation, safe normalization, UTF-8 facets, visibility restrictions, cache capacity and TTLs, concurrent request coalescing, timeouts, upstream cooldown, Elysia authentication/validation/errors, a real loopback WebSocket, replay/checkpoint behavior, standby ownership, cancellation, and Pino/OTLP correlation with a local collector.

Set `PROTOCOLS_TEST_REDIS_URL` explicitly to a test Redis to run real lease-fencing and discovery-storage integration tests. They use unique test keys and remove only those keys; they never flush a database. Without that explicit URL these integration tests are skipped. Tests do not need Bluesky credentials or internet access. Recovery tests cover bounded retries, circuit opening and a single recovery probe, cancellation of stalled transports, lease-renewal loss, a thousand coalesced discovery readers, cross-replica continuation reuse, and Redis byte/entry limits and expiration.

## Latest local validation

Validated on 2026-10-16:

- Hardening validation: the repository suite passed with 6,692 tests and four skips; the expanded focused protocol/feed/feedback suite passed all 71 tests, including both real Redis tests. Root formatting/lint and type checks passed. A separate service process started with Redis unreachable, became ready automatically when Redis returned, stayed live through a second outage, recovered readiness again without restarting, and shut down cleanly. The thousand-reader test verifies request coalescing with controlled upstream fixtures; production capacity and sustained traffic still require deployment measurements.
- The full repository suite passed: 6,680 passed, five skipped, and zero failed. This includes discovery continuations, recommendation opt-outs, feedback/Undo, native thread grouping, real Redis lease fencing, environment precedence, and Pino/OTLP correlation.
- Root `bun run check` and `bun run check-types` passed. Live Redis validation confirmed feedback persistence, expiry, author mute, and Undo; browser checks confirmed live cards, the source dropdown, post dismissal, and author mute/Undo on desktop and a 390-pixel viewport.
- A signed x86_64 release APK built, installed successfully, and matched the changed source modules. Because release API resolution rejects cleartext localhost overrides, the actual local Home feed was checked in an isolated Expo development app on `emulator-5554`: live posts, source switching, post dismissal, author mute, both Undo paths, and native error logs passed. The installed main app and its account data were retained. Production API deployment remains unverified.
- Live HTTP smoke returned 200 for health, readiness, capabilities, the Bluesky public profile, and a media author feed containing two posts.
- The running development service on port 3012 returned readiness with `stream: connected`; public profile/media reads succeeded, and the matching request log was found in the real local OpenObserve logs stream. This does not validate replay after a production outage.
- A clean frozen-lockfile production-only install started, rejected unauthenticated reads, served a live profile, and stopped cleanly without leaking its credential. The container image has not been built locally: the installed Docker-compatible runtime fails before building with a user-namespace/pause-process error. Production deployment and production OpenObserve delivery remain unverified.

## Automated builds and releases

Protocols uses the existing main-branch CI pipeline. Changes under `apps/protocols` select `asm-protocols`; shared package or root dependency changes select it with the other service images. CI builds `linux/amd64` and `linux/arm64` and publishes to `ghcr.io/<repository-owner>/asm-protocols` with `protocols-v<app-version>`, `protocols-sha-<commit>`, and `latest` tags. The GitHub Release lists the published image and its app-specific version.

The existing pre-commit version hook increments both protocols workspaces and updates their root lockfile entries. Service logs, health responses, and telemetry read the app manifest version instead of a hardcoded value. No separate lockfile or manual version bump is needed.

CI runs the real Redis checkpoint test using its Redis service. Repository tests also cover image selection, app-version tags, optional deployment target selection, environment precedence, and release-note metadata.

## Dokploy

Build `apps/protocols/Dockerfile` with the repository root as its context. Set `PROTOCOLS_HOST=0.0.0.0` in the container, port 3012, and the service-specific environment variables above. Use `/health` for container liveness and `/ready` for read readiness; inspect its stream fields separately. Keep the service on the internal application network; no new public domain is necessary.

The existing VPS is the target. Monitor CPU contention with media processing, cache size, upstream 429s, request latency, stream disconnects, and Redis availability before increasing limits. The live Jetstream connection/public read endpoints do not require an API subscription; archive replay is a separate capability and is not enabled here.

Set GitHub secrets `DOKPLOY_PROTOCOLS_APP_ID`, `DOKPLOY_API_URL`, and `DOKPLOY_API_TOKEN` to enable the existing deployment API step for this app. Optional `PROTOCOLS_HEALTH_URL` enables the same observational health probe used by other services. Missing deployment secrets do not prevent image publishing. Keep production Redis, OpenObserve credentials, and the generated internal token in the Dokploy app environment. No workflow build secret is needed for Bluesky public reads or live Jetstream.

The protocol container does not require the Prisma contract, database migration, media tools, or object-store credentials. It installs the filtered production dependency graph from the root lockfile and runs as the unprivileged Bun user.

## Home feed UI

Web and mobile consume `/api/protocols/bluesky/discover` through the web backend. Configure `PROTOCOLS_SERVICE_URL` and the matching `PROTOCOLS_INTERNAL_TOKEN` in the web runtime as well as the protocols service; local web defaults are committed in `apps/web/.env.development`. Neither value is exposed as a public browser/native environment variable.

The source dropdown sits on the right of For you / Latest / Following rather than adding a second tab row. Latest orders the selected content chronologically. Ranked feeds preserve ASM ranking and blend the curated external selection without comparing remote likes to Aura. Native reply groups stay together. Following and community feeds retain their existing membership behavior.

Cards use ASM post spacing, avatar shapes, typography, and action controls, with a small Bluesky indicator beside the handle. They show rich text, images, link previews, quoted context, separate Bluesky counts, and links to the original. Web videos have playback controls; native video previews open Bluesky. Source cards use dedicated ASM interactions and never call native Aura votes or native impression counters. The down arrow records Not interested for that external post; the overflow menu can mute the author in ASM. Signed-in feedback saves only post/author identifiers in Redis, with 90-day retention and a 500-signal cap per account; subsequent discovery responses apply those preferences. Guest feedback lasts for the current session. Both offer Undo. No Bluesky vote, moderation action, or Aura change is sent. Comments, bookmarks, and amplifications stay local to ASM. No remote write or remote author Aura award is implied. Broader topic learning and in-app external profiles remain separate work.

Discovery sessions retain unconsumed source candidates and deduplicate originals in the shared temporary Redis cache. Development without Redis uses an 8 MiB / 256-entry memory cache. Continuations expire after fifteen minutes, may be evicted earlier under pressure, and cap at twenty pages; an expired cursor asks the reader to refresh. Complete pages are cached for ten seconds and partial pages for one second. Buffered posts are resolved again before a new page is published so expired snapshots cannot indefinitely serve deleted or edited records. One source failure leaves healthy content available with an inline retry. Client feed bodies stay in memory; the native feed releases them on unmount or after two inactive minutes. Browsing writes no external accounts, posts, media, or interactions to the database or object store.

## Durable interactions and guest abuse controls

The web gateway gives guests a signed, HttpOnly, SameSite browsing cookie, with a one-day lifetime. Normal reading permits 120 protocol reads per minute with a 30-request burst per guest. An account permits 120 reads per minute with a 20-request burst, and 30 writes per minute with a ten-request burst. A broad ingress budget accommodates shared networks: 6,000 reads per minute with a 600-request burst. A service-wide budget and the existing 64-request process cap remain effective when cookies or ingress identities are rotated. No CAPTCHA is added to browsing. These budgets are shared through Redis and return Retry-After; they are not a substitute for origin protection.

Production must put the web origin behind the configured trusted Cloudflare ingress and restrict direct origin access as described in `docker/cloudflare-origin-lockdown.md`. Client-supplied forwarding headers cannot establish a trusted network identity by themselves. `PROTOCOLS_GUEST_SECRET` can be configured separately; otherwise the server-only protocol token signs the guest cookie. Keep it consistent across web replicas. Rotation resets guest cookies but does not bypass ingress or service budgets.

Creating interactions additionally permits at most 1,000 retention-producing actions per account per UTC day. Removing bookmarks/amplifications and deleting comments remain possible when this storage budget is exhausted. No guest mutation retains posts or comments. Mutation bodies reject unknown fields, including client-provided snapshots. Comments are plain text, limited to 1,500 characters, have stable client request IDs, and can be deleted only by their author. Banned accounts cannot write. Source content is fetched by the server before a new interaction; redirects and arbitrary fetch destinations are disallowed. Empty or invalid requests do not create references.

`GET /api/protocols/bluesky/interactions?uri=...` reads a source post and paginated ASM discussion. `POST` accepts explicit bookmark/amplify state, comment creation, and comment deletion. `GET` with `kind=bookmarks` or `kind=amplified` lists the authenticated account's saved or amplified external posts with keyset pagination. Guests can read discussions. The web route `/network/bluesky?uri=...` and native `/external-post` expose local discussions. Web bookmarks include a Bluesky tab; mobile bookmarks link to the saved/amplified Bluesky library.

Deploy the additive `20261016T1137_external_post_interactions` migration before the new web service, and deploy protocols with the batched `/v1/bluesky/posts` read endpoint before enabling these interactions. The three new tables have foreign keys, unique constraints, and pagination/count indexes. Browsing still retains no source posts. Snapshot revalidation erases unavailable remote content while retaining local comments and interactions. The database package disables declaration emission during its no-emit check because generated Prisma migration getters expose nonportable inferred declaration types; migrations themselves remain framework-generated and type-checked.

Native and external web cards share `FeedPostSurface`, including the border, padding, hover surface, and avatar primitive. Native external cards reuse the native post styles and action components. The common `feedAvailability` helper selects one state for all selected sources; a failed source cannot appear above an empty-feed illustration. Healthy content remains visible through partial failures.
