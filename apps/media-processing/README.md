# Media processing and delivery

The worker scans uploads before publication, creates delivery derivatives, and analyzes content asynchronously. Deploy it alongside the web application; native clients use the same authenticated media routes. These changes do not require a database migration.

## Delivery

- Exact uploaded originals remain private for the lifetime of the asset by default (`MEDIA_PRESERVE_ORIGINALS=1`). Deleting the asset still deletes its objects. Existing originals that were already removed by an older retention policy cannot be recovered by this change.
- JPEG/PNG/WebP metadata is scrubbed structurally. The opaque ASM media ID is embedded without another pixel encode. Other supported static raster containers use a lossless WebP fallback. Audio/video metadata is removed through stream-copy remuxing. Scrub failures retry privately.
- Responsive WebP and optional AVIF images are generated with libvips. Lossless graphics preserve decoded pixels. Lossy WebP/AVIF must pass local SSIM >= 0.99 and RGB PSNR >= 40 against the resized reference; WebP falls back to lossless and AVIF is omitted on failure. These automated checks support the visual-quality target, but do not prove perceptual identity for every possible image. JPEG preview copies remain available for compatibility.
- AVIF is negotiated only for supported clients and when smaller than the compatible candidate. An image derivative larger than the scrubbed source reuses that source. Animated sources retain their motion through original delivery.
- H.264 MP4 is published before the HLS ladder. Clips over 15 seconds get adaptive HLS; short clips keep progressive delivery. Optional AV1/Opus WebM is retained only when smaller than MP4. HDR sources use an SDR tone-map for compatible playback. Originals remain available for recovery and future encoders.
- Feed playback buffers are bounded. HLS playlists pin their object generation so cached playlists cannot mix old initialization segments with new media segments.
- Every request checks access before conditional caching or range delivery. Private responses use no-store; public derivatives have short revalidation windows and ETags. Downloads and source uploads still transfer source bytes when requested; preserving originals does not reduce the initial upload payload.

`MEDIA_AV1_ENABLED=0` disables optional AV1 encoding. `MEDIA_BACKFILL_ENABLED=0` disables existing-asset sweeps. The delivery watcher cursor-pages registered READY assets every minute, queues at most five upgrades per pass, and yields when the processing queue is full. New uploads take priority over backfill. It does not publish arbitrary bucket objects.

## Clef labels and recommendation features

Set these secrets in the media worker deployment, using Cloudflare's Workers AI token template:

- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: a token created with the Workers AI template.
- `MEDIA_CLEF_DAILY_NEURONS=9000`: this worker's daily allowance; maximum 10,000.

Clef Flash replaces the local NSFW classifier and Gemini vision classifier. A combined request returns independent sexual-content, graphic-violence, and topic probabilities. Anime is a topic, not an explicit-content rule. A sexual-content probability of at least 0.85 sets the explicit label. It does not set `moderated`, remove content, or apply an account penalty. A negative result does not clear an author's existing explicit label. Video analysis currently evaluates its representative poster plus available transcript/OCR; it is not exhaustive frame-by-frame review. Thresholds and topic coverage still need evaluation against a labeled production-representative dataset.

A dedicated analysis queue handles media, text-only posts, and replies. Text edits are conditionally checked before writing results; reconciliation sweeps recover missed jobs. Existing media is re-evaluated under the new classifier version. Failed requests and exhausted quota defer analysis instead of treating content as safe. Published content remains available while analysis is pending.

Redis provides cross-worker deduplication, 30-day result caching, provider cooldowns, and atomic daily budget reservations. Requests reserve the maximum model context and refund validated unused tokens. The default 9,000-neuron ceiling leaves headroom within Cloudflare's 10,000-neuron daily free allocation. That allocation is shared with other Workers AI usage on the account; this worker cannot budget unrelated applications. Keep Redis persistent and monitor Cloudflare's account usage. No paid-plan change is made by this code.

Gemini remains responsible for `gemini-embedding-2` embeddings (384 dimensions) and speech transcription. Existing local hash-vector fallback behavior remains when Gemini is unavailable; those vectors are not semantically interchangeable with Gemini vectors. OCR remains local PP-OCRv4. Transcription uploads use compact mono Ogg/Opus instead of uncompressed WAV and captions remain WebVTT.

## AI provenance and re-upload attribution

The AI badge reflects embedded C2PA/IPTC declarations, including AI editing. It is not an appearance-based verdict or proof that unlabeled media is human-created. Signature trust is not asserted without trust-chain validation. Image derivatives carry portable declarations; feed serialization preserves the badge for web/native.

Re-upload attribution combines opaque ID hints with perceptual matching. Only eligible public posts can supply a public attribution label; private messages and private communities are excluded. Matching is bounded and heuristic, not proof of copyright ownership, and metadata can be removed. The media ID resolves the asset's current context through the database rather than embedding conversation or private-account details in downloaded files.

## Operations and validation

`/health` checks process liveness. `/ready` checks Redis, database, object storage, and running worker pools with a bounded timeout. Run multiple instances with durable Redis/Postgres/object storage and external restart/alert policies for production availability. Separate scan, encode, and analysis queues prevent model latency from occupying encoding slots. Replacement generations keep existing derivatives readable during repair. Superseded generations are currently retained; capacity planning must account for them.

Delivery smokes require local Postgres/RustFS and HTTP smoke requires the web server. They clean up their fixture rows and objects. `clef-smoke` makes a small real API request using configured credentials. `clef-pipeline-smoke.ts` additionally requires a running worker pointed at the same local database and Redis namespace. Run the signed Android release smoke against the emulator for client validation.

From the repository root, run `bun run check`, `bun run check-types`, and `bun run test`. For live delivery checks, run `bun --env-file=.env.test run apps/media-processing/scripts/delivery-smoke.ts`, then `bun --env-file=.env.test run apps/media-processing/scripts/delivery-http-smoke.ts`. Run `bun run apps/media-processing/scripts/clef-smoke.ts` to verify the configured token and result cache.

Local checks cannot establish a 99.9999% production availability SLO. Deployment, capacity/load testing, a representative moderation evaluation set, and sustained production metrics are still required.

References: [Clef Flash API](https://developers.cloudflare.com/workers-ai/models/clef-flash/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [token setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [Sharp encoders](https://sharp.pixelplumbing.com/api-output/), and [C2PA specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html).
