# ASM-owned Bluesky follows

An ASM follow is an authenticated preference in ASM, keyed by the remote account's stable DID. It requires neither a Bluesky account nor a connected OAuth session. The explicitly named “Follow in ASM” action never writes `app.bsky.graph.follow` to Bluesky. Connecting or disconnecting Bluesky leaves these follows intact. Native ASM follows keep their existing semantics.

## Research and decisions

- [Bluesky's API directory](https://docs.bsky.app/docs/advanced-guides/api-directory) documents unauthenticated public AppView reads. [getAuthorFeed](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed) provides per-author pagination; ASM uses that read boundary without impersonating a Bluesky user.
- [AT Protocol identity](https://atproto.com/specs/at-uri-scheme) distinguishes stable DID references from mutable handles. The graph stores DIDs; handle/display-name metadata is refreshed separately. A handle being reassigned cannot transfer a follow to its new owner.
- [Jetstream v2's wire contract](https://github.com/bluesky-social/jetstream/blob/main/docs/README.md) uses `dids` for every event kind and `collections` only for commits. Omitted filters match the whole stream. The v2 endpoint is server-push only and rejects v1 options-update messages, so changed DID sets require reconnecting. ASM partitions into bounded nonempty subscriptions, preserves identical subscriptions, and scopes leases/checkpoints by endpoint and filter set.
- [The synchronization specification](https://atproto.com/specs/sync) distinguishes deactivation, suspension, takedown, migration, and deletion. [getRepoStatus](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/sync/getRepoStatus.json) has an explicit `deleted` status; `RepoNotFound` is a separate error. ASM verifies lifecycle hints against the fixed trusted Bluesky relay. No arbitrary DID-controlled PDS URL is fetched, avoiding SSRF. This uses Bluesky's relay view of account status rather than cryptographically verifying repository synchronization.

Jetstream is an invalidation source, not a post-body database. AppView reads remain the source of displayable posts and apply existing public visibility/moderation rules. Followed authors supply recent candidates and a ranking preference; existing language, content, mute, and recommendation-opt-out policies still apply to discovery. Following is a direct subscription feed and uses content/explicit-content/mute policies without recommendation-interest filtering. Freshness is bounded by upstream AppView indexing and caching; this feature does not promise posts before Bluesky itself indexes them.

## Stored data and limits

`external_authors` stores DID, last known handle/display name, account status, and the next reconciliation time. `external_follows` stores the ASM user-to-DID edge and creation time. Both foreign keys cascade; remote authors are never represented as ASM users.

A transaction-scoped advisory lock serializes graph mutations, admission checks, orphan removal, and lifecycle cleanup. Follow/unfollow is idempotent, bans are checked, and simultaneous requests cannot exceed the current limits of 100 follows per ASM user or 16,000 shared author references. Seed DIDs have a separate 1,000-account configuration limit. These are explicit initial operational bounds, not upstream protocol limits. Revisit the global graph lock and shard assignment under measured production load.

Following reads merge live author pages with at most eight requests in flight. A per-viewer Redis lease admits one page build at a time and fences writes after lease loss. Followed-author change hints are filtered against each authenticated SSE viewer's follow set; private graph identifiers are removed before frames reach clients. Pinned posts are excluded, foreign-author reposts are filtered, canonical URIs deduplicate results, and source heads are replenished before selecting the next chronological row. A failed source stays retryable in the next continuation; healthy sources remain visible with `partial: true`. Total source failure is an error, not a successful empty feed.

Following shares an atomic Redis LRU bounded to 32 MiB and 512 entries (plus Redis object overhead), with an eight-MiB per-snapshot maximum. Eviction expires a continuation safely instead of allowing per-viewer keys to grow without a global bound.

Opaque Redis continuations are scoped to the viewer, sorted active DID set, and content-policy revision. They expire after five minutes and contain bounded temporary content, never permanent copies. Head pages cache for at most ten seconds, and incomplete heads for three seconds. Event-driven head probes bypass that cache so a single new-post event cannot be swallowed by a still-fresh cached head. A changed graph or policy invalidates the old continuation; clients reconcile the head. Membership is checked again before returning freshly merged data. No-follows reads contact no upstream authors. Existing source-specific failures retain usable native content.

## Lifecycle behavior

| Condition | Follow edges and stored source data |
| --- | --- |
| Handle or PDS changes | Keep the DID edge; update handle/display-name metadata after a successful public read. |
| Timeout, 429/5xx, malformed response, missing repository, unknown status | Preserve the graph and last known status; retry reconciliation after fifteen minutes. Never infer deletion. |
| Deactivated, suspended, taken down, throttled, desynchronized | Preserve follows, stop including the author in Following/discovery follow candidates, and clear retained source snapshots. Retry after fifteen minutes. |
| Reactivated | Mark active; the existing edges resume without recreating follows. |
| Confirmed `deleted` status | Remove the author reference and all its follow edges; clear its retained source-post snapshots and mark those source references unavailable. Keep ASM-authored discussion and minimal post pointers required for that discussion. |
| One viewer unfollows | Remove only their edge, without an upstream request. Keep the shared author while another viewer follows it. |
| Last viewer unfollows | Remove the now-orphaned shared author. It leaves dynamic subscriptions on the next registry reconciliation. |
| ASM account deleted | Database cascades its edges immediately. The next registry reconciliation removes any newly orphaned author. |
| Bluesky unlinked | No local follow changes. |

Account/identity events trigger immediate verified reconciliation before the worker checkpoints them. A periodic sweep reconciles twenty overdue authors per thirty-second registry cycle, so missed events and downtime are repaired without depending solely on pub/sub. Successful active checks are scheduled six hours out. Inactive/unknown checks retry sooner. Temporary Redis/feed copies expire separately; content is not erased from a user's already-rendered screen by deleting a database row.

## Service boundary and deployment

The database remains owned by web. The protocol worker uses bearer-authenticated `GET/POST /api/internal/protocols/follows` to read the graph and report verified lifecycle states, without importing the database into the protocol image. This endpoint must remain protected by the same strong `PROTOCOLS_INTERNAL_TOKEN` on both services. Do not expose that token as `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`.

Configure the protocol container with `PROTOCOLS_ASM_URL` pointing to web's internal HTTP origin, `REDIS_URL`, `PROTOCOLS_JETSTREAM_ENABLED=true`, and the shared token. Set `PROTOCOLS_SERVICE_URL` on web as before. `PROTOCOLS_BLUESKY_DIDS` can be empty. Registry outages retain the previous bounded subscriptions and retry; they never enable an unfiltered subscription. Jetstream being disabled leaves public follows/feed reads and periodic lifecycle reconciliation usable when the registry credentials and Redis are configured. Only the websocket subscriptions and their immediate event hints are disabled.

Apply the generated Prisma 8 `external_author_follows` migration before deploying either changed service. No indexes are added to existing large tables. Roll out web before enabling the new worker callback; old curated subscriptions remain a fallback during registry recovery.
