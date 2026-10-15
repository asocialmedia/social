# Media worker operations

For the service overview and data flow, see [README.md](README.md).

The worker scans uploads before publication, creates delivery derivatives, and analyzes content asynchronously. Deploy it alongside the web application; native clients use the same authenticated media routes. Recommendation provenance requires the additive `20261015T0901_media_embedding_provenance` migration before deploying this revision.

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

Clef Flash replaces the local NSFW classifier and Gemini vision classifier. A combined request returns independent sexual-content, graphic-violence, and topic probabilities. Anime is a topic, not an explicit-content rule. A sexual-content probability of at least 0.85 sets the explicit label. It does not set `moderated`, remove content, or apply an account penalty. A negative result does not clear an author's existing explicit label. Video classification inspects up to four bounded scene windows per clip, removes near-identical frames, and includes available transcript/OCR. OCR defaults to the representative poster. This is not exhaustive frame-by-frame review. Thresholds and topic coverage still need evaluation against a labeled production-representative dataset.

A dedicated analysis queue handles media, text-only posts, and replies. Text edits are conditionally checked before writing results; reconciliation sweeps recover missed jobs. Existing media is re-evaluated under the new classifier version. Failed requests and exhausted quota defer analysis instead of treating content as safe. Published content remains available while analysis is pending.

Redis provides cross-worker deduplication, 30-day result caching, provider cooldowns, and atomic daily budget reservations. Requests reserve the maximum model context and refund validated unused tokens. The default 9,000-neuron ceiling leaves headroom within Cloudflare's 10,000-neuron daily free allocation. That allocation is shared with other Workers AI usage on the account; this worker cannot budget unrelated applications. Keep Redis persistent and monitor Cloudflare's account usage. No paid-plan change is made by this code.

Gemini remains responsible for `gemini-embedding-2` embeddings (384 dimensions) and speech transcription. Failed embedding requests remain pending without a local hash-vector fallback. OCR uses Google Cloud Vision `TEXT_DETECTION` through its REST API; no local OCR model/runtime is installed. Transcription uploads use compact mono Ogg/Opus instead of uncompressed WAV and captions remain WebVTT.

## Cloud Vision OCR setup

1. Enable billing and the Cloud Vision API (`vision.googleapis.com`) in the Google Cloud project that owns the key.
2. Add `GOOGLE_CLOUD_VISION_API_KEY` to the **media worker** deployment secrets. Use a Google Cloud API key restricted to Cloud Vision; where practical, restrict it to the worker's outbound IP. The Gemini key is not automatically reused. Never expose this key to web/native clients.
3. Keep `MEDIA_OCR_ENABLED=1` (default). `MEDIA_OCR_TIMEOUT_MS=30000` is the optional request timeout. `MEDIA_OCR_ENABLED=0` explicitly skips extraction.

The worker sends the existing image derivative or video poster inline to `https://vision.googleapis.com/v1/images:annotate`, requesting only `TEXT_DETECTION`. Video OCR defaults to its poster. Set `MEDIA_VIDEO_OCR_FRAMES=2` through `4` to include sampled scene frames, with the poster counting toward that limit. Completed per-frame OCR is reused after partial quota failures; existing completed OCR is preserved. Text feeds the existing classification/search/recommendation inputs. Successful text and empty results are checkpointed per media row with the provider identifier, so later analysis retries reuse them. Existing local OCR checkpoints/text remain valid and are preserved; this switch does not trigger a paid re-OCR of the archive.

Quota, timeout, network, and transient server failures defer the analysis job. `Retry-After` is honored when present; credential/API configuration errors retry after 15 minutes. Missing credentials also leave OCR pending. Other input failures use the queue's normal bounded retry policy and can be replayed after repair. Classification/transcription can still save their independent results, and published media remains available. No failure is recorded as successful empty OCR. Inline rasters above 7 MB fail before an API call to stay under the base64 JSON request limit; normal poster/image derivatives are smaller.

Enable the API and supply the key before deploying, or explicitly disable OCR until configured. Cloud Vision has separate billing/quota from Cloudflare neurons and Gemini. Each image/poster is an OCR unit; configure usage quotas in Google Cloud for your budget. See [Vision API keys](https://docs.cloud.google.com/vision/product-search/docs/auth#using_an_api_key), [OCR responses](https://docs.cloud.google.com/vision/docs/ocr), [limits](https://docs.cloud.google.com/vision/quotas), and [pricing](https://cloud.google.com/vision/pricing).

## AI provenance and re-upload attribution

The AI badge reflects embedded C2PA/IPTC declarations, including AI editing. It is not an appearance-based verdict or proof that unlabeled media is human-created. Signature trust is not asserted without trust-chain validation. Image derivatives carry portable declarations; feed serialization preserves the badge for web/native.

Re-upload attribution combines opaque ID hints with perceptual matching. Only eligible public posts can supply a public attribution label; private messages and private communities are excluded. Matching is bounded and heuristic, not proof of copyright ownership, and metadata can be removed. The media ID resolves the asset's current context through the database rather than embedding conversation or private-account details in downloaded files.

## Operations and validation

`/health` checks process liveness. `/ready` checks Redis, database, object storage, and running worker pools with a bounded timeout. Run multiple instances with durable Redis/Postgres/object storage and external restart/alert policies for production availability. Separate scan, encode, and analysis queues prevent model latency from occupying encoding slots. Replacement generations keep existing derivatives readable during repair. Superseded generations are currently retained; capacity planning must account for them.

Delivery smokes require local Postgres/RustFS and HTTP smoke requires the web server. They clean up their fixture rows and objects. `clef-smoke` makes a small real API request using configured credentials. `clef-pipeline-smoke.ts` additionally requires a running worker pointed at the same local database and Redis namespace. Run the signed Android release smoke against the emulator for client validation.

From the repository root, run `bun run check`, `bun run check-types`, and `bun run test`. For live delivery checks, run `bun --env-file=.env.test run apps/media-processing/scripts/delivery-smoke.ts`, then `bun --env-file=.env.test run apps/media-processing/scripts/delivery-http-smoke.ts`. Run `bun run apps/media-processing/scripts/clef-smoke.ts` to verify the configured token and result cache.

Local checks cannot establish a 99.9999% production availability SLO. Deployment, capacity/load testing, a representative moderation evaluation set, and sustained production metrics are still required.

References: [Clef Flash API](https://developers.cloudflare.com/workers-ai/models/clef-flash/), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [token setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [Sharp encoders](https://sharp.pixelplumbing.com/api-output/), and [C2PA specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html).

## Recoverable enrichment and recommendation retrieval

OCR text, transcripts, caption keys, and terminal silent/no-audio results are saved before classification. Classification also survives later embedding failures. Atomic JSON patches preserve encoder metadata. Published media remains available while quota or provider failures delay enrichment; scanner failures still fail closed before publication. The failed-job CLI below replays a specific job without changing the publication policy.

Gemini vectors carry `embeddingModel` and `embeddingFingerprint`. Unknown historical vectors and vectors from other models never contribute to semantic similarity. Failed Gemini requests leave embeddings pending; topic, freshness, and social signals remain available. Existing content is revisited by the bounded sweeps. Video classification samples up to four bounded scene windows across each clip; near-identical frames are deduplicated.

The feed merges bounded pools from recent content, followed creators, semantic buckets, archive topic matches, collaborative activity, and exploration. Every source passes the same database checks for community visibility, blocks, explicit-content preferences, visits, and dismissals. Ranked IDs are cached for pagination, and eligibility is checked again when reading each page. The semantic buckets are approximate and bounded; their quality must be evaluated on the actual corpus.

Web and native Gust playback share foreground/visibility and advancing-playback rules. Buffering, paused playback, seeks, errors, and background time cannot earn completion. Playback failures and buffering are operational events rather than negative interests. Recent session topics supplement longer-term interests; author, topic, and duplicate-media diversity are applied during ranking.

### Deployment

1. Review the additive provenance and recommendation-attribution migrations with `bun run --cwd packages/db --env-file=../../.env.test prisma db migrate --show` against the intended environment, then apply the reviewed migration through the normal deployment migration command. Do not schema-push production.
2. Deploy the web application and media worker together, then ship the updated native build for the new playback telemetry.
3. Keep the existing Cloudflare/Gemini credentials, scanner configuration, and backfill switches. Configure the new `GOOGLE_CLOUD_VISION_API_KEY` secret as described above for OCR. `MEDIA_MULTIMODAL_EMBEDDING_ENABLED=1` optionally adds image/frame embeddings; it defaults off so evaluation can precede the added inference cost. It introduces no new secret.

Fresh analysis jobs have higher queue priority than backfills. Backfills may consume at most 25% of the configured daily Clef allowance, reserving the remainder for fresh uploads. This quota partition is not a worker-throughput guarantee. Jobs delayed by Clef quota do not consume ordinary retry attempts. Non-quota failures use bounded BullMQ retries and remain inspectable afterward.

### Operations

The worker's internal `/metrics` endpoint reports queue counts, a bounded sample's oldest pending age, p50/p95/p99 stage and upload latencies, labeling coverage, daily Clef reservations/usage, origin delivery payload bytes, and 24-hour playback startup/buffering/error aggregates. The pending age is a lower bound when more jobs exist than the sample. Delivery bytes describe payload offered by origin responses, excluding CDN hits and without measuring bytes actually received after cancellation. Use CDN analytics for end-user data usage.

```sh
bun --env-file=.env apps/media-processing/scripts/queue-ops.ts inspect analyze
bun --env-file=.env apps/media-processing/scripts/queue-ops.ts inspect scan
bun --env-file=.env apps/media-processing/scripts/queue-ops.ts retry analyze <failed-job-id>
```

Keep health/metrics endpoints on the internal service network. Inspection includes failure reasons and attempt counts; replay requires an explicit existing failed job ID.

### Model evaluation

```sh
bun apps/media-processing/scripts/evaluate-models.ts apps/media-processing/scripts/evaluation.example.json
bun --env-file=.env apps/media-processing/scripts/evaluate-models.ts manifest.json /tmp/model-report.json --live
```

The first command only validates the manifest. `--live` uses the configured inference providers and the shared Clef quota. Each manifest item has an ID, category, expected sexual-explicit label, kind (`text`, `image`, `audio`, or `video`), optional local path, and reference text/transcript. Queries contain text and relevant item IDs. Use consented local assets and manually reviewed labels across anime, adult content, ordinary skin exposure, and graphic violence. Graphic violence is evaluated separately from sexual explicitness; neither result changes moderation.

The runner compares Flash with sampled frames/transcripts against Omni with direct audio/video (bounded to a 20-second test clip), and text-only Gemini retrieval against multimodal retrieval. It emits false-positive/false-negative rates by category, per-call latency and charged neurons, plus precision/recall/NDCG for labeled queries. Cached calls consume zero new neurons. The shipped synthetic text fixture validates plumbing; it cannot establish model accuracy or justify switching production models. Longer clips require an evaluation dataset that covers their full duration. Gemini text inference remains the default until representative evaluation supports enabling multimodal embeddings.

## Shared topics, reconciliation, and provider limits

Topic relationships are stored in Redis across worker/web processes, with at most 5,000 topic nodes, 40 neighbors per node, 90-day expiration, and document-fingerprint deduplication. Feed profiles load a bounded two-hop neighborhood. Unicode hashtags and words survive normalization, including non-Latin scripts. OCR/transcript presence alone no longer adds a relevance bonus. New posts start without placeholder hash vectors and receive verified Gemini embeddings asynchronously.

A separate minute sweep cursor-pages READY assets for missing OCR, transcription, post embeddings, and optional multimodal embeddings, even when classification is current. Successful empty OCR and silent/no-audio transcription are terminal. Each pass enqueues at most five jobs, stops when the analysis queue reaches 20 waiting/active/delayed jobs, and leases each asset for six hours. Text-post reconciliation also checks embedding completeness independently of classification. Transcription repairs respect the existing three-attempt ceiling and six-hour retry window; quota deferrals do not consume those attempts. Multimodal checkpoints include the OCR/transcript fingerprint so later extraction can refresh them. Disabling `MEDIA_BACKFILL_ENABLED` stops these archive repairs.

The worker now enforces these shared UTC request-attempt limits before making Vision or Gemini inference calls:

| Worker environment variable | Default | Unit |
| --- | --- | --- |
| `MEDIA_PROVIDER_BUDGET_ENABLED` | `1` | Enable shared limits |
| `MEDIA_VISION_DAILY_IMAGES` | `100` | Image OCR requests per day |
| `MEDIA_VISION_MONTHLY_IMAGES` | `900` | Image OCR requests per month |
| `MEDIA_GEMINI_DAILY_REQUESTS` | `500` | Embedding/transcription requests per day |
| `MEDIA_GEMINI_MONTHLY_REQUESTS` | `10000` | Embedding/transcription requests per month |
| `MEDIA_VIDEO_OCR_FRAMES` | `1` | Poster plus sampled frames, maximum four |

Backfills may reserve at most 25% of each daily/monthly provider limit; fresh uploads can use the remaining allowance. Each network attempt counts, including failed requests and transcription retries. Exhaustion delays jobs to the next applicable UTC period without consuming ordinary retry attempts. Redis failure defers inference for one minute. These limits count this worker's requests, not money or other applications using the account; configure provider-side billing/quota limits too. They do not guarantee a free tier. `/metrics` reports configured provider limits and current reservations. Existing malware scanning and publication gates remain unchanged.

## Recommendation attribution and experiments

Personalized feed pages save canonical request ID, position, candidate sources, ranker version, experiment, variant, and content kind in Redis for 24 hours. Web and native clients send the request ID with qualified impressions/playback events. The server verifies that the authenticated viewer was served the post before persisting `RecommendationEvents.rankingContext`; client-supplied positions or variants are ignored. New attributed events carry retry IDs, while impressions are deduplicated per served exposure. Legacy clients remain accepted as unattributed events with daily impression deduplication. Social actions use the last qualified impression within one hour when available.

`RECOMMENDATION_EXPERIMENT_PERCENT=0` on the web/API deployment keeps everyone in control. A value from 1 through 100 assigns a stable percentage of accounts to `balanced-v1`, which lowers the single-topic share cap from 60% to 45%. Increasing the percentage grows a stable cohort. Deploy the additive `20261015T1413_recommendation_attribution` migration before serving the updated API. It has been applied only to the local test database during development.

```sh
bun --env-file=.env.test apps/media-processing/scripts/report-recommendations.ts /tmp/recommendation-experiment.json
```

The seven-day report reads at most 50,000 events and separates experiment, ranker, variant, and video/post content. It reports saves, completions, dismissals, playback errors, startup p95, and dwell. Rates pair events with an impression in the report window; unpaired and unattributed events remain explicit coverage counts. Reports are descriptive, not proof of causal uplift. Leave experiments disabled until telemetry coverage and per-user sample sizes support a comparison.

## Reviewed evaluation and retrieval benchmark

```sh
bun --env-file=.env.test apps/media-processing/scripts/prepare-evaluation.ts --output=/tmp/evaluation/manifest.json --download
bun apps/media-processing/scripts/evaluate-models.ts /tmp/evaluation/manifest.json
bun --env-file=.env apps/media-processing/scripts/evaluate-models.ts /tmp/evaluation/manifest.json /tmp/model-report.json --live --extraction --require-reviewed
bun --env-file=.env.test apps/media-processing/scripts/benchmark-retrieval.ts --output=/tmp/retrieval-report.json
```

The exporter drafts up to 100 READY media items. Downloads are opt-in; stored labels/text are candidates, never ground truth. Manually verify usage rights, language, category, explicit labels, literal `expectedOcr`/`expectedTranscript`, source, and query relevance before marking items `reviewed: true` and `source: "production"`. Add consented examples to cover missing categories. The coverage gate requires at least 100 reviewed production examples, at least ten each for anime, ordinary skin, adult, graphic violence, memes, screenshots, and video, and ten examples in each of at least two languages. Passing this coverage gate is not an accuracy guarantee. The runner reports OCR character/word error rates, transcription word error rates, classification errors, retrieval metrics, and latency. `--live` incurs provider calls; without it the runner validates the manifest only. The checked-in synthetic fixture verifies plumbing and does not pass the production coverage gate.

The retrieval benchmark compares exact cosine neighbors with the existing bounded Redis semantic buckets over at most 5,000 model-compatible stored vectors and 50 queries. It excludes self matches and reports recall@10 and p50/p95 latency. It is read-only unless `--reindex` explicitly warms Redis using existing vectors. At least 100 corpus vectors and 20 queries are required before its low-recall recommendation can trigger. Recall below 0.90 recommends evaluating a dedicated vector index; no index migration is applied automatically. Production-scale latency/recall and product relevance still need testing before choosing an index. An empty/small local corpus is reported as insufficient evidence.
