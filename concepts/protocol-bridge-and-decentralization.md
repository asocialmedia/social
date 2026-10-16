# Protocol bridge, Bluesky aggregation, and decentralization

Recorded: 2026-10-16.

Status: implementation started. The first backend milestone adds `@asm/protocols` and the Elysia-on-Bun service in `apps/protocols`. The full web/mobile and persistence roadmap below is not yet complete. No database contract or deployed infrastructure has changed.

## Purpose

ASM currently has roughly 20 original posts and at most three active users. Bring useful outside content into ASM so people can discover content and start conversations while the native community grows. Keep ASM's own posts, communities, reputation, and identity central to the product.

Start with Bluesky public APIs and Jetstream. Establish a reusable protocol boundary so later integrations do not require rebuilding posts, profiles, discovery, or interaction handling for every network.

This document records the owner's requirements, recommended defaults from the discussion, research findings, and work still needed. Recommendations and provisional implementation choices below are not existing functionality.

## Decisions agreed with the owner

- Support web and mobile through the same shared backend.
- Mix Bluesky content into For You, Trending, and Latest. Provide source filters and dedicated external discovery.
- Select external content using ASM interests and topics, with a curated starting selection for users without enough history.
- Keep first-phase interactions inside ASM. An ASM reaction, follow, Eddy, or response does not publish to Bluesky or notify its author there.
- Browsing, scrolling, and opening a post or external profile do not permanently import that content or account.
- Create durable external references only when needed for deliberate actions, such as following, bookmarking, reacting, sharing, discussing, hiding, blocking, or reporting.
- Keep media upstream by default. Interacting with a post does not require copying its images or videos into RustFS.
- When an original is confirmed deleted, remove its source text and media from ASM's rendered and cached representations. Preserve ASM users' discussions under an “Original post removed” notice.
- Show a small Bluesky source icon beside an external author's handle. Link the icon to the original profile and the name/avatar to an ASM-rendered external profile.
- Include the original Bluesky profile among that profile's social links.
- Load external profiles and their feeds from the source. Hide unsupported tabs and actions.
- Target the current self-hosted VPS. No additional paid infrastructure is required by this proposal.
- Keep native decentralization in the long-term roadmap, while describing the first aggregation release accurately.

## Current infrastructure and repository

The owner reports a VPS with two CPU cores, 16 GB RAM, and 200 GB total storage, with around 70% or more storage free. Normal memory use is approximately 1–2 GB. Dokploy runs web, auth, media processing, Redis, Postgres, RustFS, OpenObserve, Umami, and related services on that machine.

The reported headroom is reasonable for a bounded initial integration. Two CPU cores, especially during media transcoding, are the main resource constraint to measure. Upgrade only when measured traffic, latency, or resource contention warrants it.

Repository foundations inspected during discussion:

- `packages/aggregator/hackernews`: existing external reads, Redis caching, and rate limiting.
- `packages/db/prisma/contract.prisma`: native posts require native authors; comments, votes, bookmarks, responses, and community shares reference native objects.
- `packages/db/src/recommendation`: existing interest profiles, candidate scoring, diversity rules, and feed ranking.
- `apps/web/src/app/api/posts`: native feed and interaction APIs.
- `apps/web/src/components/home`: feed rendering, native query caching, pagination, and new-content probes.
- `apps/web/src/app/(main)/users/[username]` and `apps/web/src/components/profile`: native profile routes, actions, social links, and tabs.
- `apps/mobile/src/features/feed`: native feed transport, normalization, caching, virtualized rows, and engagement handling.
- `apps/media-processing`: an existing separate-worker deployment pattern.

The native post model cannot simply represent a Bluesky post unchanged. Creating a fake ASM user for each external author would confuse ownership, login, reputation, notifications, and account counts. Native and external identities need explicit types and relationships.

The database uses Prisma 8, with `contract.prisma`, emitted contract artifacts, and graph-based migrations. Future database work must follow the package's `AGENTS.md` and installed Prisma 8 references rather than Prisma 7 workflows.

## What decentralization means for ASM

### Aggregation

ASM reads another network's public content and displays it alongside native content. ASM users, original posts, Eddies, follows, and local discussions still live in ASM's own database.

This is the first proposed release. Accurate description: “ASM aggregates decentralized social networks.” Reading public APIs or Jetstream alone does not make ASM's native accounts federated.

### Connected interactions

A user explicitly connects a Bluesky account and authorizes ASM to publish or interact through it. ASM acts as a client of that network. Its native accounts can remain a separate system.

Account linking must prove control. Matching handles, display names, or avatars is not proof that two accounts belong to one person. Local-only actions must never silently become remote actions when an account is linked later.

### Native network participation

ASM's own users and supported public content become discoverable and interactive through an open protocol. Two main paths require a later architectural decision:

- AT Protocol participation: protocol identities, public records in users' Personal Data Servers, OAuth access, and application services that read and publish those records. Define whether ASM supports existing PDS accounts, offers account hosting, or both. Define custom Lexicons for ASM-specific public features where appropriate.
- ActivityPub federation: ASM exposes actors and exchanges supported activities with other servers, including discovery, inbox/outbox delivery, signatures, follows, posts, replies, deletes, undo operations, and moderation handling.

Both can eventually be supported, but identity mappings, reply semantics, audience rules, deletion, and duplicate propagation need explicit handling. This is more substantial than adding two read adapters.

One VPS can run a participating node. Decentralization comes from independent compatible services, interoperable identities and content, and meaningful user choice; it does not require distributing ASM's own microservices across several machines.

Public posts, private messages, communities, and Aura may have different decentralization boundaries. This proposal does not promise to federate private messages, private community content, or reputation balances.

Useful foundations now: stable identifiers independent of display handles, explicit ownership, exportable native data, source attribution, protocol capabilities, and separate local and remote interaction records. Exact identity, export, portability, and federation guarantees remain future design work.

## First-phase product behavior

### Source attribution and navigation

- Display a compact Bluesky icon beside the external handle on post cards, profiles, and relevant previews.
- Give the icon an accessible name such as “View on Bluesky.” It identifies the source; it is not an ASM verification badge.
- Clicking the author name or avatar opens the external author's page inside ASM.
- Clicking the source icon opens the original Bluesky profile. A post also has a clear link to its original URL.
- Keep source handles distinct from ASM usernames. A similar handle never establishes shared ownership.
- Provide All sources, ASM, and Bluesky filters. Extend the source list as adapters are added.

### External profiles

Use ASM's profile layout to display the source avatar, banner, display name, handle, bio, and supported public feeds. Label the account's network. Fetch on demand with expiring caches.

Use the account DID as Bluesky's stable identity. Handles can change, including after someone follows the author in ASM. Resolve and refresh identity mappings rather than permanently keying follows to a handle.

Recommended initial tabs:

- Posts: the public author feed, preserving repost attribution when present.
- Replies: supported Bluesky replies, named distinctly from ASM Eddies and Responses.
- Media: author posts containing media, using the API's author-feed media filter.

Hide unavailable or unsupported tabs instead of presenting broken controls. Do not expose another person's private likes, bookmarks, preferences, or authenticated-only data. Do not infer a complete media archive by filtering one ordinary feed page.

Do not invent ASM Aura, membership roles, local verification, or messaging capability for an external identity. If both upstream follower counts and ASM follow counts are displayed, label them separately.

### Follows and Following

“Follow in ASM” persists a relationship from an ASM user to the external stable identity. It does not create an ASM login for the external author, follow them on Bluesky, or deliver a Bluesky notification.

Following can make the author's public posts eligible for ASM's Following feed and improve discovery affinity. It does not import the author's history. Unfollowing removes the local relationship; retain only references still needed for other local actions or moderation state.

Actual Bluesky follows belong to the later authenticated-interaction phase and need an explicit user choice.

### Local discussions and actions

Make the boundary visible in product language: “Discuss in ASM,” “Follow in ASM,” and “View on Bluesky” describe different actions.

An external post should have one canonical external reference for local discussion. The same original encountered through several feeds, its author's profile, a bookmark, or a share should resolve consistently.

Keep upstream counts separate from ASM reactions, Eddies, and responses. Upstream likes do not create Aura, local votes, or native notifications. Define how ASM's reputation rules apply to genuine local contributions without awarding reputation to fake external accounts.

Native reshares or Responses should reference the external original while remaining authored ASM content. The exact integration with existing Posts, Comments, notifications, and Aura needs a reviewed data-model design before implementation.

Do not publish accumulated ASM discussions to Bluesky retroactively after account linking. Future remote publishing needs a deliberate action, authorization, and applicable source reply permissions.

### Communities

Recommended default: community feeds remain centered on their members' native posts. Members can explicitly share an external post into a community, subject to its existing visibility, membership, and moderation rules.

Later, owners can opt into curated external feeds or source rules. Avoid automatically filling every community with outside content. Private ASM community activity must not leak into public protocol records.

## Feed behavior

### For You: interest first

Use interests to select external candidates as well as rank them. An anime fan should receive relevant anime posts from ASM and external networks without downloading the entire network first.

Use existing ASM preference and topic signals where available. Include a bounded exploration allowance and author/topic diversity. For guests or new accounts, use curated seed feeds and selected language/topic preferences.

Permanent content import must not be triggered by impression or dwell tracking. If ephemeral viewing signals are used, define their retention separately from permanent references. Deliberate hides and blocks are durable user preferences and should be honored across discovery surfaces.

### Trending: momentum with lighter personalization

Prioritize recent activity and momentum, with a lighter interest preference than For You. An anime fan can receive more trending anime while still seeing important activity from other topics.

Use selected upstream feeds and bounded observations. Lifetime popularity counts alone do not establish current momentum. Three local active users are not enough to support a claim of broad network-wide trends.

Normalize or rank source pools separately before blending. Do not directly compare raw Bluesky likes with ASM Aura. Cache successive metrics only for a bounded candidate pool if measuring velocity.

### Latest: chronological within a relevant selection

Interests, language, source choices, and followed authors determine candidate eligibility. Publication time determines order. An older highly relevant post must not jump above a newer eligible post because of a ranking score.

Describe this as the latest content in ASM's selected discovery coverage. It is not a complete real-time view of every post on Bluesky. Define timestamp handling for skewed or future-dated source records.

### Adaptive source mixing

Avoid a rigid 50/50 allocation. With around 20 native posts, it would repeat stale material and leave discovery sparse.

- Give fresh, eligible native originals a modest boost in ranked feeds.
- Let external content fill most slots while native activity is low.
- Preserve chronological ordering in Latest.
- Bound repeated authors, topics, and duplicate originals.
- Do not repeatedly surface old ASM posts merely to fill a native quota.
- Keep source filters and explainable feed behavior available.

Exact weights and caps are provisional. Validate them with realistic small-community fixtures before tuning against actual use.

### Pagination and refresh

Each upstream has its own cursor and ordering. Use a versioned composite cursor or a short-lived feed session that tracks the native position, external positions, unconsumed candidates, selection, and ranking generation.

Keep already-rendered order stable while scrolling. New arrivals should use the existing explicit new-content reveal pattern. Avoid losing candidates when a source returns more items than a mixed page consumes.

Deduplicate by protocol and canonical record identity. Preserve the distinction between an original post and a local authored share. An upstream outage must not break native feeds; a failed source must not silently be marked permanently exhausted.

## Storage model and lifecycle

### Temporary state

Use a shared, bounded Redis cache for fetched profiles, post representations, selected feed pages, resolved identities, short-lived ranking metrics, and pagination sessions. Add expiration, maximum entry sizes, namespace budgets, and request coalescing.

TTL alone does not bound memory under high key cardinality. Avoid unbounded per-query caches, per-user full-feed archives, Redis KEYS scans, and unlimited history lists. Do not change the shared Redis instance's global eviction policy without considering auth, queues, and other consumers.

Avoid persisting external feed bodies into web or mobile offline storage without explicit retention and invalidation rules. Permanent client cache behavior must not undermine the server's temporary-content policy.

### Durable state

Persist only what deliberate actions and operation require:

- External identity references needed by follows, blocks, saved content, or discussions.
- Canonical external post references needed by bookmarks, reactions, shares, reports, Eddies, and responses.
- ASM-authored discussion content and its relationships.
- Local follows, hides, blocks, and moderation decisions.
- Minimal source status, reconciliation metadata, and worker checkpoints.

Potential logical entities include ExternalActor, ExternalPostReference, ExternalFollow, ExternalInteraction, and local-to-external post links. These are proposed responsibilities, not a finalized schema or an instruction to implement those exact model names.

Do not retain complete external profiles, source post text, raw events, or media indefinitely just because someone followed or reacted. If a limited source snapshot is later proposed for discussion context, define its purpose, retention, and deletion behavior explicitly.

### Deletion, changes, and unavailability

On confirmed source deletion, remove the source text/media from active caches and rendered views, mark retained references appropriately, and preserve local discussion under a tombstone. Handle account deletion and deactivation as well as individual post events.

Use both live invalidation and periodic revalidation of retained references. A stream disconnect, missed event, or expired replay window must not leave an eternal stale copy.

A timeout, rate limit, or server error is not confirmed deletion. Distinguish available, temporarily unavailable, deleted, restricted, and locally hidden states. Handle updates and changed visibility preferences retroactively.

Prevent replayed or stale create events from resurrecting deleted content. Cache and worker writes need idempotency, ordering/version checks, and appropriate reconciliation.

Deleting a source does not automatically require deleting independently authored ASM discussion, although local moderation or a valid removal request can affect that discussion separately. Removal from caches already delivered to devices is eventually consistent; do not promise instantaneous erasure from every client.

## Shared architecture

### Protocol boundary

Recommended structure: a shared `packages/protocols` workspace named `@asm/protocols`, plus a separately deployed `apps/protocols` for long-running background work. These solve different problems: the package separates reusable code; the worker separates process lifecycles and failures. Both workspaces have now been created. The owner selected `apps/protocols` as the service name and Elysia on Bun for its HTTP framework.

Suggested layout, to finalize during implementation:

```text
packages/protocols/
  src/contracts/
  src/atproto/bluesky/
  src/atproto/jetstream/
packages/aggregator/
apps/protocols/
apps/web/src/app/api/
```

Use explicit package exports to keep browser-safe contracts and helpers separate from server-only adapters, streaming transports, and credentials. `@asm/protocols` should not depend on Next.js, React, or the native database model. Inject transport and infrastructure dependencies where needed, and validate upstream payloads inside the relevant adapter.

Responsibilities:

- `@asm/protocols`: stable external identities, canonical references, capability contracts, protocol-specific parsing and normalization, public API transports, and stream event contracts. Keep Bluesky application records distinct from general AT Protocol machinery.
- `@asm/aggregator`: ASM-specific candidate selection, curated sources, ranking/blending, bounded cache orchestration, and composition of native and external feeds. Reuse the existing Hacker News integration; do not move it merely to satisfy a new folder structure.
- `@asm/db`: authored persistence contracts and queries for local state and durable references. Keep native permission, moderation, ownership, and interaction rules in shared backend services rather than embedding them in network transports.
- `apps/protocols`: the process entry point for Jetstream connections, checkpointing, invalidation, reconciliation, scheduled refresh, and health/telemetry. Reuse package implementations rather than duplicating adapters here.
- `apps/web`: the authenticated/public API boundary and web presentation. Mobile consumes the same backend; it does not receive database credentials or run the shared server stream.

Add later protocol modules only when implementing them. Mastodon client API reads and ActivityPub federation should have distinct responsibilities even though they interoperate. RSS, Nostr, and Matrix need their own supported-capability and visibility rules.

### Deployment boundary

Initially, web API handlers call shared server-side aggregation/protocol code directly. The worker runs as a small separate Dokploy service on the same VPS, reusing existing Redis and Postgres. A worker is independently restartable background execution; it does not need a public protocol API, a public domain, or a new request hop for every feed read.

Keep the Jetstream connection outside Next.js request handlers and rendering processes. Configure worker ownership so accidental additional replicas do not duplicate subscriptions or process the same work unsafely; use an appropriate lease or partition strategy when needed, with idempotent handlers regardless.

The owner subsequently selected Elysia on Bun for `apps/protocols` to support future growth. Its initial read API is internal and token protected; do not expose it directly to web/mobile clients or treat its internal token as user authorization. The Next.js-facing API integration remains a separate milestone. Keep HTTP request handlers separate from long-lived stream ownership and preserve stable client contracts as deployment boundaries evolve.

The service now provides private, token-protected public-data read endpoints and health/readiness routes. It remains framework-independent at the shared-adapter boundary and does not require another server. Deployment is not performed automatically.

### Normalized content

Normalize enough to render and route content consistently: protocol, canonical record ID, revision when supplied, stable author ID, source URL, text/rich-text segments, media references, timestamps, labels, provenance, and supported actions.

Preserve protocol-specific information instead of forcing everything into the native PostData shape. Adapters advertise capabilities such as author feeds, media filtering, search, thread reads, remote writes, or streaming. Unsupported capabilities remain unavailable rather than fabricated.

Keep native authorization, community visibility, and local interaction rules in shared backend services. Both web and mobile consume the same external-content API contracts.

### Public Bluesky reads

Prefer `https://public.api.bsky.app` for supported unauthenticated public reads. Candidate functions include profile reads, author feeds, feed generators, individual post hydration, and threads. Validate each required endpoint and selected custom feed against its current authentication and pagination behavior.

The authenticated user's Bluesky Following timeline is not an unauthenticated public feed. Public search is not a guaranteed complete, stable archive or a substitute for all discovery.

Treat upstream payloads as untrusted. Validate responses, bound payloads and nesting, handle unknown embed variants, and render rich text safely. Bluesky facets use UTF-8 byte offsets, which require care around emoji and other multibyte text.

Retain text alternatives, dimensions, attribution, quotes, and unavailable embeds where supported. Do not feed external media through ASM's upload pipeline or attach ASM-generated provenance claims to media ASM did not process.

Use fixed or explicitly trusted upstream endpoints, safe outbound URLs, bounded concurrency, timeouts, retry budgets, and backoff. Do not turn profile resolution or media proxying into unrestricted server-side URL fetching.

### Visibility and moderation

Apply source labels and ASM's local moderation before display. Do not treat raw Jetstream records as automatically safe hydrated feed cards.

Respect source public-web opt-outs, including `!no-unauthenticated`, and recommendation preferences such as `hideFromAlgorithmicRecommendations`. An ASM login is not a Bluesky login and must not be treated as authorization to bypass a source restriction.

Define how visibility choices affect general recommendations versus explicitly selected topical feeds. Keep restricted content out of public SSR, previews, and search indexing. Until external SEO behavior is reviewed, favor conservative indexing defaults for mirrored profile and content pages.

Support reports, local author/source blocks, removal requests, and moderation overrides. Review Bluesky's developer requirements before enabling production access.

### Jetstream

Use one shared worker in `apps/protocols`, with narrow filters, bounded buffers, reconnect backoff, checkpointing, and graceful shutdown. A small separate Dokploy service can run on the current VPS.

Jetstream provides record changes, not a personalized, fully hydrated feed. Use the public API to obtain display-ready posts and current moderation/profile information as needed.

The documentation reviewed recommends Jetstream v2 for new projects. Its live filters include collections, DIDs, and event kinds; they are not general anime/topic/language queries. Discover topics through selected feeds or bounded local candidate processing rather than expecting the stream to filter arbitrary interests server-side.

Watch tracked or curated authors, invalidate relevant cached objects, and update bounded candidate sets. Do not subscribe separately for every viewer or retain the entire firehose. Handle account and identity events even when collection filtering is enabled.

Treat delivery as at least once. Confirm the selected version's cursor semantics, endpoint failover behavior, and lookback limits before implementation. Keep checkpoint advancement consistent with successfully processed work.

After a gap, revalidate tracked references and refresh bounded discovery pools. Do not require a full-network historical backfill for ordinary recovery. Measure API request load so every event does not trigger a hydration request.

### Resource limits and operations

Use configurable limits for selected feeds, topics per request, authors per subscription, pages per profile, cache bytes, in-flight reads, event queue depth, and retries. Actual values should be measured against the current VPS.

Avoid AI analysis of every incoming external post. Reuse upstream metadata and ASM's existing interest model; budget any additional classification for a bounded candidate pool.

Observe upstream latency and 429s, cache hit rate and size, worker lag/reconnects, dropped discovery candidates, deletion reconciliation, source availability, and mixed-feed latency. Use existing logging and monitoring infrastructure.

Add a kill switch and source-level degradation controls. Disabling external discovery should leave native posting, feeds, communities, and stored local discussions usable.

## Cost assumptions

The proposed public Bluesky reads do not require buying an API subscription. The live Jetstream connection is documented as unauthenticated and not metered. Rate limits still apply.

Jetstream historical replay and snapshots are separate features requiring an API key on the archive HTTP calls, with download-byte metering. Metering by itself does not establish a particular price; verify any allowance or pricing before enabling those features. Bulk historical replay is not required for this first phase.

ASM still spends its own CPU, RAM, cache/database capacity, and bandwidth. Direct source media delivery reduces ASM storage use; proxying media can add substantial bandwidth and cache use. Existing VPS headroom may absorb the initial workload without a higher bill. No capacity or cost guarantee has been benchmarked yet.

## Delivery roadmap

The first backend foundation is implemented. The remaining milestones are still pending; the order creates testable vertical slices while retaining the complete first-phase scope. See the implementation checkpoint below and the service README for current limitations.

### 1. Contracts and live read foundation

- Establish `@asm/protocols` exports and the dependency boundary with `@asm/aggregator`; avoid empty future protocol scaffolds.
- Define external identities, references, capabilities, safe normalized content, and error states.
- Build validated public Bluesky reads with bounded caching and request coalescing.
- Add fixtures and tests for rich text, embeds, labels, identity changes, timeouts, malformed data, and pagination.
- Keep browsing free of durable content/account writes.

### 2. External discovery and profiles on web and mobile

- Add source indicators, original-source links, and ASM-rendered external profiles.
- Add supported profile tabs and explicit loading, empty, restricted, and error states.
- Add dedicated Bluesky discovery and source controls.
- Verify matching capabilities and shared backend behavior on both clients.

### 3. Selective persistence and local interactions

- Finalize the external-reference schema and native discussion/share relationships.
- Emit and review a replayable Prisma 8 migration; test against a local database.
- Add local follows, bookmarks, reactions, hides, blocks, reports, Eddies, and Responses as appropriate to existing ASM behavior.
- Preserve ownership, native authorization, idempotency, moderation, and reputation boundaries.
- Add retrieval surfaces for saved references and followed external authors.

### 4. Mixed Home and Following feeds

- Select external candidates using curated starting feeds and available ASM interests.
- Implement distinct For You, Trending, and Latest semantics.
- Add source-aware blending, diversity, deduplication, stable pagination, and explicit refresh.
- Include locally followed external authors in Following.
- Preserve native and private-community visibility rules and existing feed cache behavior.

### 5. Live updates, reconciliation, and deployment

- Add `apps/protocols` with bounded Jetstream consumption, checkpointing, event invalidation, and retained-reference reconciliation.
- Implement tombstones without destroying local discussions.
- Add Dokploy/container configuration, resource controls, health checks, and operational documentation.
- Test disconnections, duplicates, delayed deletes, source outages, and a busy media worker.

### 6. Staged rollout and measurement

- Start with a small curated source set and a source kill switch.
- Validate guest, signed-in, web, and mobile flows.
- Monitor content relevance, native-content exposure, latency, cache growth, upstream usage, and CPU contention.
- Tune limits and ranking from observed behavior. Upgrade infrastructure only when measurements warrant it.

## Implementation checkpoint: backend foundation

The owner selected Bun with Elysia, named workspaces, the single root Bun lockfile, proper tests, Pino locally, and OpenObserve through the existing OpenTelemetry setup.

Implemented in `packages/protocols` and `apps/protocols`:

- Browser-safe external-content contracts and explicit server-adapter exports.
- Official `@atproto/lex` public reads using generated `@bsky/sdk` schemas, `@atproto/syntax` identifiers, and `@bsky/jetstream` live decoding.
- Validated profiles, author feeds, selected feed generators, and individual posts; safe text/media normalization and conservative labelled-content filtering.
- A cache bounded by bytes and entry count, request coalescing/concurrency limits, timeout/response limits, and shared rate-limit cooldown.
- Elysia health/readiness and internal token-protected read endpoints with safe errors and request IDs.
- An opt-in, filtered Jetstream worker with bounded transport buffering, worker-owned retry, Redis lease fencing, checkpoints, and cache invalidation.
- Pino logs and correlated OTLP logs/traces/metrics through `@asm/logger`, with a real local-collector integration test.
- Unit/route tests, a real loopback WebSocket test, replay/failure tests, and an explicit opt-in Redis lease integration test.
- A Dockerfile and operational guidance in `apps/protocols/README.md`; the image has not been deployed.

Live read checks succeeded through Elysia for a public Bluesky profile and a two-item media feed. The local OpenObserve-compatible collector test verified all three signal exports and trace correlation. The actual Docker/Redis deployment path must be verified in an environment with functioning container access and an explicitly isolated test Redis.

Still pending: web/mobile screens, source filters/icons, shared user-facing API integration, stable mixed-feed sessions and interest-based candidate selection, persisted follows/bookmarks/reactions/discussions, database migrations, complete recommendation visibility handling, durable tombstones, and automatic recovery/reconciliation after a stream history gap. The service does not yet make Bluesky content appear in ASM's existing feed.

`@atproto/common-web` is a utility package rather than a synchronization requirement. `@atproto/tap` is a client for a separately running Tap service, which supports selective synchronization and verification. It remains a later evaluation rather than an unused dependency or an assumption that the entire network must be mirrored.

## First-phase acceptance criteria

- Native ASM posts and interactions continue to work with Bluesky enabled or disabled.
- All three discovery feeds contain both sources when eligible content exists, with the distinct behaviors described above.
- Source icons and original links work, and external profiles use stable identities and supported tabs.
- Browsing does not create native accounts, durable source post copies, or RustFS media objects.
- Deliberate actions persist only necessary references and local state.
- Local actions are visibly ASM-only and create no Bluesky writes.
- Followed external authors can appear in ASM Following without importing their history.
- Source counts do not become Aura or imply local account ownership.
- Deleted/restricted content is reconciled and removed from display while local discussions remain usable.
- Pagination does not lose unconsumed candidates or repeatedly display the same original.
- Source failures degrade gracefully and retries remain bounded.
- Cache size, worker queues, concurrency, and history retention are bounded and observable.
- Both clients share contracts and pass relevant unit, route, integration, and user-flow checks.

## Future integrations and goals

The owner's proposed direction is Bluesky public APIs and Jetstream first, followed by public ActivityPub/Mastodon-facing APIs, RSS/Atom, authenticated AT Protocol interactions, ActivityPub federation, and possible Nostr, Matrix, and other integrations.

- Mastodon public APIs: read from selected instances, respect instance-specific access rules, and identify objects by canonical URI rather than assuming numeric IDs match across instances. Public API aggregation is distinct from ActivityPub federation.
- RSS/Atom: articles and updates, feed discovery, conditional fetching, sanitization, source attribution, and canonical-link deduplication. Many feeds have no remote social interaction capability.
- Authenticated AT Protocol: OAuth, secure credential/session lifecycle, explicit account linking, remote likes/follows/replies/posts, reply gates, disconnect, and clear local-versus-remote actions.
- Native AT Protocol participation: decide identity and PDS strategy, public record formats, portability, export, moderation, and how ASM-specific features relate to shared records.
- ActivityPub federation: native ASM actors, incoming/outgoing delivery, identity discovery, signatures, retries, idempotency, visibility, editing/deletion, abuse controls, and migration expectations.
- Nostr: signed-event identity, relay selection, event kinds, retrieval, and protocol-specific deletion limitations. Do not promise that deleting an ASM cache removes every distributed copy.
- Matrix: evaluate a concrete public-content use case first. Rooms, membership, permissions, encryption, and conversational semantics do not map automatically to a public social feed. Do not ingest private rooms or messages as discovery content.
- Custom Home and community feeds: reusable source selections, topic/language rules, follow sets, ordering, and owner-controlled community curation.
- Multi-protocol publishing: explicit per-network destinations, capability-aware formatting, identity proof, delivery state, and loop/duplicate prevention. Avoid automatic blind cross-posting.

## Open design work for resumption

- Choose and verify the initial curated feeds, languages, and topic mapping. Anime is an example of personalization, not the only intended audience.
- Finalize native-post and external-reference relationships, including shares and Responses.
- Decide detailed notification and Aura rules for local discussion of external content.
- Finalize cache budgets, TTLs, reconciliation frequency, cursor design, and rollout configuration.
- Review external media delivery, accessibility, embeds, source visibility preferences, and SEO behavior.
- Decide whether native AT Protocol participation or ActivityPub federation is the first decentralization milestone.
- Define the identity, portability, data export, community, private-message, and reputation guarantees ASM intends to make.

These decisions can be resumed from this document without treating provisional designs as already implemented.

## Research and references

Reviewed during the 2026-10-16 discussion. Recheck current endpoint behavior, SDK versions, service terms, and limits before implementation. Context7 was also consulted for AT Protocol SDK documentation; its indexed examples can lag the newer official documentation.

- [AT Protocol official documentation](https://atproto.com/)
- [Official SDK directory](https://atproto.com/sdks)
- [Lex client documentation](https://github.com/bluesky-social/atproto/tree/main/packages/lex/lex)
- [Tap client documentation](https://github.com/bluesky-social/atproto/tree/main/packages/tap)
- [Understanding AT Protocol](https://atproto.com/guides/understanding-atproto)
- [Bluesky API hosts and authentication](https://bsky.network/docs/api-directory/)
- [Bluesky rate limits](https://bsky.network/docs/rate-limits/)
- [Bluesky profiles](https://bsky.network/docs/bluesky-api/profiles)
- [Bluesky feeds and author-feed filters](https://bsky.network/docs/bluesky-api/viewing-feeds/)
- [Bluesky custom feeds](https://bsky.network/docs/bluesky-api/custom-feeds)
- [Stable identities and handle resolution](https://bsky.network/docs/resolving-identities/)
- [Content visibility preferences](https://bsky.network/docs/about-bluesky-content/visibility-preferences)
- [Bluesky developer guidelines](https://bsky.network/docs/developer-guidelines/)
- [Jetstream live consumption and filters](https://bsky.network/docs/jetstream/)
- [Jetstream SDK](https://bsky.network/docs/jetstream-sdk/)
- [Jetstream replay, authentication, and metering](https://bsky.network/docs/jetstream-replay/)
- [Bluesky HTTP endpoint reference](https://endpoints.bsky.app/)
- [Bluesky Protocol Services announcement](https://atproto.com/blog/introducing-bluesky-protocol-services)
- [Mastodon public API concepts](https://docs.joinmastodon.org/client/public/)
- [Mastodon ActivityPub federation](https://docs.joinmastodon.org/spec/activitypub/)
- [Prisma 8 migration architecture](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md)

Read-only public API checks during discussion succeeded for a Bluesky profile and an author feed with `posts_with_media`. A public likes request did not succeed; no general likes-tab support was established. These checks are research observations, not an integration test suite or a guarantee that every custom feed supports unauthenticated access.
