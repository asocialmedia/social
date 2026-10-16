# ASM protocols service

Elysia on Bun, in the existing Bun workspace. This service runs the Bluesky read boundary and an optional Jetstream consumer. Shared network adapters live in `@asm/protocols`; they do not depend on Elysia, Next.js, React, or the database.

This is the first backend milestone. Web/mobile discovery and profile screens, mixed feeds, durable external references, and ASM-only follows/discussions are not wired yet. Native federation is a later milestone. Starting this service does not import Bluesky history, create external ASM accounts, or enable remote writes.

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
- `GET /ready`: readiness; returns 503 while draining or while an enabled stream lacks a live owned connection. Idle read-only mode is ready.
- `GET /v1/capabilities`: supported sources, tabs, and write capabilities.
- `GET /v1/bluesky/profile?actor=bsky.app`: public profile represented as an external identity.
- `GET /v1/bluesky/author-feed?actor=bsky.app&tab=media&limit=20`: posts, replies, or media, with opaque cursor pagination.
- `GET /v1/bluesky/feed?feed=at%3A%2F%2F...`: an explicitly selected public feed generator.
- `GET /v1/bluesky/post?uri=at%3A%2F%2F...`: one public post; missing results are not proof of deletion.

All `/v1` routes require `Authorization: Bearer <PROTOCOLS_INTERNAL_TOKEN>`. With no configured token they return 503. Keep this credential on the backend. This is not ASM user authentication, a browser-facing API, or a substitute for per-user permissions. Do not expose the service directly to public traffic. Web/mobile integration must preserve ASM authorization and source visibility rules.

Routes return `Cache-Control: no-store`. Temporary upstream caching happens in the service, not in a shared HTTP cache containing internal credentials. Request IDs are validated or generated. Logs contain operation names, duration, status categories, and trace correlation rather than bearer credentials, query strings, or source content.

## Current limits and visibility

The in-process cache has a 16 MiB UTF-8 payload/key budget and at most 256 entries; object/runtime overhead is additional. Profiles expire after 60 seconds, selected feed pages after 30 seconds, and post reads after 15 seconds. There are at most four concurrent upstream reads, a five-second request timeout, a two-MiB response cap, and no automatic SDK HTTP retries. A 429 starts a bounded shared cooldown.

The current unauthenticated policy hides all actively labelled profiles/posts. This is intentionally conservative; it is not a complete implementation of Bluesky moderation, personalized label preferences, or recommendation visibility declarations. General algorithmic recommendations must not be enabled until the recommendation visibility policy is implemented. Unsupported embeds are omitted, and restricted/unavailable quotes do not expose their original content.

No database models or migrations are added in this milestone. No media is downloaded into RustFS. Cached source data can change before expiry. Stream invalidation clears this process's cache; invalidations are also published for later integration with other consumers. Durable tombstones, source revalidation, and preservation of local discussions remain part of the next milestones.

## Enable Jetstream

Set `PROTOCOLS_JETSTREAM_ENABLED=true`, `REDIS_URL`, and `PROTOCOLS_BLUESKY_DIDS` to a comma-separated curated/tracked DID list. An empty list is rejected, so the worker cannot accidentally subscribe to the whole network. The initial cap is 1,000 accounts.

The default endpoint is `wss://jetstream.us-east.bsky.network`; the west v2 endpoint is also allowed. The worker subscribes to posts, profiles, content visibility declarations, thread gates, and post gates, retaining identity/account/sync events. Each incoming event is handled in order, the read cache is invalidated, and a Redis Lua script checks current ownership before advancing its cursor and publishing minimal invalidation metadata.

The transport has a one-MiB unread byte cap and a 256-KiB individual-message cap. It uses the official SDK's live-only flow and does not request metered archive replay. The worker owns retry backoff, deduplicates already committed sequences, and scopes checkpoints by endpoint and filter set. A changed endpoint or account/filter selection deliberately has a different checkpoint.

A Redis lease prevents duplicate active subscriptions for the same scope. A standby instance remains alive but reports not ready for streaming. Lease loss aborts the socket; stale owners cannot advance checkpoints or release another owner's lease. Redis reconnection is bounded per operation and worker retries back off.

An outdated-cursor advisory pauses/reconnects without silently skipping to the tip. If it persists, operational reconciliation is needed; automatic historical recovery is not implemented. Do not describe this milestone as guaranteed gap-free synchronization. Source deletions currently invalidate temporary reads; durable-reference reconciliation requires the later persistence milestone.

SIGINT/SIGTERM stop the stream, release ownership, stop Elysia, disconnect Redis, and shut down the OpenTelemetry providers. Use one replica initially. Multiple differently filtered instances can overlap authors; no cross-scope deduplication guarantee is implemented.

## Tests and checks

From the repository root:

```sh
bun test packages/protocols/src apps/protocols/src
bun run check
bun run check-types
```

The suite exercises official SDK response validation, safe normalization, UTF-8 facets, visibility restrictions, cache capacity and TTLs, concurrent request coalescing, timeouts, upstream cooldown, Elysia authentication/validation/errors, a real loopback WebSocket, replay/checkpoint behavior, standby ownership, cancellation, and Pino/OTLP correlation with a local collector.

Set `PROTOCOLS_TEST_REDIS_URL` explicitly to an isolated test Redis to run the real lease-fencing integration test. It uses unique test keys and removes only those keys; it never flushes a database. Without that explicit URL the Redis integration test is skipped. Tests do not need Bluesky credentials or internet access.

## Latest local validation

Validated on 2026-10-16:

- All 41 protocol tests passed as part of the full repository run: 6,662 passed, four skipped, and zero failed. This includes real Redis lease fencing, environment precedence, and Pino/OTLP correlation.
- Root `bun run check` and `bun run check-types` passed.
- Live HTTP smoke returned 200 for health, readiness, capabilities, the Bluesky public profile, and a media author feed containing two posts.
- The running development service on port 3012 returned readiness with `stream: connected`; public profile/media reads succeeded, and the matching request log was found in the real local OpenObserve logs stream. This does not validate replay after a production outage.
- A clean frozen-lockfile production-only install started, rejected unauthenticated reads, served a live profile, and stopped cleanly without leaking its credential. The container image has not been built locally: the installed Docker-compatible runtime fails before building with a user-namespace/pause-process error. Production deployment and production OpenObserve delivery remain unverified.

## Automated builds and releases

Protocols uses the existing main-branch CI pipeline. Changes under `apps/protocols` select `asm-protocols`; shared package or root dependency changes select it with the other service images. CI builds `linux/amd64` and `linux/arm64` and publishes to `ghcr.io/<repository-owner>/asm-protocols` with `protocols-v<app-version>`, `protocols-sha-<commit>`, and `latest` tags. The GitHub Release lists the published image and its app-specific version.

The existing pre-commit version hook increments both protocols workspaces and updates their root lockfile entries. Service logs, health responses, and telemetry read the app manifest version instead of a hardcoded value. No separate lockfile or manual version bump is needed.

CI runs the real Redis checkpoint test using its Redis service. Repository tests also cover image selection, app-version tags, optional deployment target selection, environment precedence, and release-note metadata.

## Dokploy

Build `apps/protocols/Dockerfile` with the repository root as its context. Set `PROTOCOLS_HOST=0.0.0.0` in the container, port 3012, and the service-specific environment variables above. Use `/health` for container liveness and `/ready` to observe stream readiness. Keep the service on the internal application network; no new public domain is necessary.

The existing VPS is the target. Monitor CPU contention with media processing, cache size, upstream 429s, request latency, stream disconnects, and Redis availability before increasing limits. The live Jetstream connection/public read endpoints do not require an API subscription; archive replay is a separate capability and is not enabled here.

Set GitHub secrets `DOKPLOY_PROTOCOLS_APP_ID`, `DOKPLOY_API_URL`, and `DOKPLOY_API_TOKEN` to enable the existing deployment API step for this app. Optional `PROTOCOLS_HEALTH_URL` enables the same observational health probe used by other services. Missing deployment secrets do not prevent image publishing. Keep production Redis, OpenObserve credentials, and the generated internal token in the Dokploy app environment. No workflow build secret is needed for Bluesky public reads or live Jetstream.

The protocol container does not require the Prisma contract, database migration, media tools, or object-store credentials. It installs the filtered production dependency graph from the root lockfile and runs as the unprivileged Bun user.
