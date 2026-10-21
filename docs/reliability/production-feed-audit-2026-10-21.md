# Production feed, safety, media, and Trending audit — 2026-10-21

## Delivery status

The fixes described here are prepared for pull-request review, not a production deployment. Production measurements describe the existing deployed version. No production object was overwritten during this investigation. The test account's original Network preferences were restored after testing, with adult content still disabled.

## Findings and changes

### Trending sidebar

The signed-in production refresh succeeded with HTTP 200 in 231 ms but displayed an empty Trending section. The server first retained only five Bluesky topics and then reduced the mixed list to seven entries. The browser applied interests afterward. A relevant anime topic was ninth in the upstream response and never reached that filter.

The server now retains up to 20 Bluesky candidates and 30 mixed candidates; the browser applies interests and avoidance before the seven-row display limit. The cache namespace changes so truncated results are not reused. Refresh uses a tracked mutation, prevents duplicate button submissions, retains loaded results on refresh failure, and distinguishes an empty interest match from an empty source. Browser query caches are scoped to the viewer. A regression test covers the topic beyond the old cutoff.

### Slow and stale recommendations

Warm production personalized heads with eight selected interests took 238–579 ms in the browser; server stages took 44–258 ms. Continuations took 349–1,244 ms, with 1,041 ms spent retrieving the sparse page. A separate cold five-topic source read took 4,145 ms and was partial; an individual anime search exhausted its 2,503 ms deadline. These measurements do not establish universally subsecond latency or 1K-user capacity.

Verified sparse inventory now returns immediately while a bounded background refill continues with the original invalidation fence. Empty inventories still perform bounded source retrieval. Source selection covers all five topics supported by the discovery contract, with five concurrent source reads instead of serial batches. Background watches rotate by last attempt rather than insertion order and warm a latest companion pool for personalized feeds.

The read worker now distinguishes a remote transport/authentication failure from a particular upstream generator's 401/403/502. Repeated transport failures open a node circuit; restricted remote operations can fall back locally without poisoning unrelated reads. Non-JSON upstream errors retain their HTTP status rather than becoming misleading JSON parse failures. Policy hydration reserves capacity for both author-policy reads.

### Follow-registry retries

Production service tokens matched. Authenticated GET of the follow registry succeeded. Authenticated reconciliation POST returned HTTP 403 with `install-token-required` because the web proxy enforced a browser install token before the service route could authenticate the protocol worker.

Only the exact internal follow-registry path is exempted from that browser token requirement. The route's timing-safe service-token check and cross-site protections remain. Warning logs now include reconciliation HTTP statuses.

### Adult and fetish content with opt-in disabled

The reported unlabelled artwork had no useful post labels or alt text. Its author's full profile described a fetish artist and prohibited minors; that full profile was not part of the old recommendation check. A live classification of its correctly decoded JPEG produced explicit probability 0.8461 and sexualized probability 0.9126, taking about 4.29 seconds. The previous explicit threshold of 0.85 alone would miss it.

Default author checks now inspect the full profile in addition to recommendation policy, including fetish/no-minors cues and sexualized labels. Obvious adult generator metadata is excluded before fetching feeds. Safe-author and feed cache versions change.

A shared Redis/BullMQ assessment gate now withholds unknown external visual posts until the existing Clef provider returns a safe verdict. Assessment is asynchronous, outside the feed's inference path, and uses the existing background analysis budget. It covers visual posts and quoted posts on discovery, search, author feeds, Following, archived feed results, threads, batch reads, and bookmarks. Explicit opt-in bypasses this additional default restriction. Cache hits are rechecked rather than trusted implicitly.

Jobs accept only bounded Bluesky image/thumbnail URLs, do not follow redirects, enforce byte/pixel/time limits, normalize images to JPEG, and publish a feed refresh after assessment. Admission is limited to 500 jobs per 15-minute bucket with a 500-waiting-job ceiling, deduplication, bounded retries, and 15-minute job freshness. Provider/Redis failures never create a safe verdict.

Availability tradeoff: new visual posts can remain absent while classification is pending or the existing provider budget is exhausted. Video assessment currently checks the poster image, not all video frames. Classification is probabilistic; these changes do not prove perfect visual safety. Additional models or a full video-analysis service would need separate evaluation.

### Repeated media failures

Both repeatedly failing originals were fetched read-only from production storage. Each was a structurally valid WebP container except that bytes 8–11 contained a length instead of the `WEBP` signature. The repository already had a strictly validated legacy repair helper, but neither analysis nor integrity sweeps called it. The helper successfully repaired and decoded both sampled objects locally.

Analysis now repairs this exact defect in its temporary raster input. The integrity sweep validates the repair, writes a new content-addressed object, and updates the READY record only if its source key is unchanged. It preserves the old object and queues derivative/analysis regeneration. No production repair has run yet.

Permanent decode failures now record a source fingerprint and recovery deadline. Unchanged unusable sources are not repeatedly retried by every semantic backfill; changed sources can recover immediately and unchanged ones are probed after a day. Tests cover the real defect shape and preservation of the damaged original.

### Social-card images and connection resets

The media URL from the web warning currently returns 404. Social-card rendering previously passed media URLs directly to Satori, which also cannot decode every delivered WebP/AVIF. The new loader fetches bounded public image bytes, converts decodable images to JPEG, and renders a text card when the asset is absent or unsupported.

The two `aborted`/`ECONNRESET` events are evidence of closed incoming connections, not proof the entire app was unavailable. Their precise request/proxy cause has not been reproduced or fixed. No process-wide exception suppression was added.

### Repeated posts

The feed now clusters the reported multiline meme prompt and near-identical substantial text, preserving the highest-ranked copy. Ordinary short captions remain distinct. This operates on the candidates being filtered; it is not global semantic or image deduplication across every future page/session.

## Rollout and verification

1. Deploy the media worker with the new assessment consumer and the protocol coordinator/read workers, then deploy web. All must share the existing Redis. No schema migration is required.
2. Watch the assessment queue, provider budget/cooldowns, withheld-content rate, partial/empty pages, and feed retrieval/safety timing. Unknown images remaining absent is intentional; a missing worker must not be mistaken for a successful rollout.
3. Confirm follow reconciliation stops receiving `install-token-required`, node cooldowns isolate their actual failures, and watched topic freshness rotates fairly.
4. Verify the integrity sweep reports the two repaired records, their new images decode, and original storage objects remain available.
5. Repeat guest and signed-in opt-out checks, account/profile switches, explicit opt-in, cold/warm multi-interest pagination, and Trending refresh. Reproduce a connection reset with a correlated request before changing that handling.
6. Run staged and burst load validation before making a 1K-user readiness claim. No such new claim is made here.

## Validation

Validation passed: `bun run check`, `bun run check-types` (14 workspaces), the web production build, and `bun run test` (7,029 passed, two optional Gemini tests skipped, zero failures). An additional run against real Redis passed all 11 inventory/ingestion integration tests. The regular repository suite excludes database integration without local Postgres. Additional real-Redis tests exercise inventory TTL/deletion fences, persona isolation, author cooldown recovery, remote hydration, and disappeared-consumer reclamation. Production build success is a compile/render check, not a deployment or live verification of these local changes.
