# Media processing

asocialmedia’s media worker turns uploaded files into safe, playable, searchable media. It runs separately from the web and native apps, handling expensive scanning, encoding, and content analysis without making those apps do the work.

The worker serves two connected purposes: prepare media for delivery, then extract useful meaning for accessibility, discovery, and recommendations.

## From upload to playback

1. **Quarantine and inspect.** Uploads enter private storage. The worker validates their type and structure, checks resource limits, and runs the malware-scanning stage before publication.
2. **Prepare delivery copies.** Images become responsive derivatives. Audio and video are remuxed or transcoded into compatible formats, with posters, waveforms, and streaming variants where supported. Metadata is scrubbed from delivery copies; exact uploaded originals remain private under the asset’s retention policy.
3. **Publish playable media.** Successfully processed assets become available through the application’s media routes. Visibility and authorization checks still apply.
4. **Analyze asynchronously.** Cloud services extract visible text, transcribe speech, classify content, and generate semantic vectors. These stages enrich an already playable asset.
5. **Reconcile incomplete work.** Checkpoints preserve successful stages. Retries and bounded archive sweeps revisit missing work without making a completed OCR request or silent-audio check start over unnecessarily.

Malware or validation failure prevents publication. An unavailable AI provider delays enrichment while published media remains available.

## What understands the content

| Service | Job | What the result contributes |
| --- | --- | --- |
| Google Cloud Vision | Read text in images and sampled video frames | OCR text for content understanding and discovery |
| Google Gemini Flash-Lite | Transcribe speech | Searchable speech text and WebVTT captions |
| Cloudflare Clef Flash | Evaluate independent safety and topic questions | Explicit-content labels, graphic-violence signals, and semantic topics |
| Google Gemini Embedding 2 | Encode text and, optionally, media into 384-dimensional vectors | Similarity between content and a viewer’s interests |

The production defaults use Cloud Vision’s managed stable OCR model, the `gemini-flash-lite-latest` transcription alias, `clef-flash`, and `gemini-embedding-2`. Clef Omni is available to the evaluation runner for comparison. “Latest” aliases can change upstream; a newer or larger model is not automatically a better choice for this workload.

External image safety uses the separately hosted SwiftFormer XS classifier. Optional semantic classification, OCR, transcription and embeddings use managed APIs. FFmpeg, libvips/Sharp, malware scanning, metadata handling, silence checks, similarity calculations, and queue coordination run in the media worker.

## Production work limits and recovery

Analysis is limited to one active job globally. External safety also runs one job globally, with a maximum start rate of two jobs per second; each image group contains at most four images. BullMQ stores these limits in Redis so adding worker replicas does not multiply inference pressure. Image scores are cached by content and model revision for seven days, with ownership-checked Redis claims preventing concurrent inference across replicas.

Unreadable image sources checkpoint a one-hour cooldown; fully undecodable images wait 24 hours. Changed source fingerprints bypass the cooldown. Logs include sanitized failure codes, phase and candidate index rather than private object keys. Published media remains available. Embedding provider errors and quotas delay jobs without consuming ordinary failure retries; successful classification checkpoints survive those retries, and unchanged post aggregate embeddings are reused.

The worker emits a `media worker operational summary` once per minute with process RSS/CPU, queue counts, sampled oldest pending age, classifier latency percentiles and cache-hit/miss counts. The `/metrics` endpoint also exposes classifier samples. Process CPU excludes FFmpeg child CPU; container-level monitoring remains necessary. On the shared two-CPU main host, start with process concurrency 1, scan concurrency 2, a 1 CPU limit and a 2 GiB memory limit; validate video-processing peaks and queue age before increasing them. The US east classifier retains its 1 CPU / 2 GiB allocation.

## How the results work together

A clip can contain useful information in three places: its pictures, visible writing, and spoken audio. Bounded scene sampling supplies representative pictures; OCR and transcription supply the missing text. Classification combines these signals into topics and safety decisions. Post aggregation joins the post’s own text, tags, and attachment results before generating its recommendation embedding.

For example, a cooking clip might show a dish, display an ingredient list, and explain a technique aloud. Those signals can connect it to food and cooking interests even when the author supplied a short caption. Scene sampling and frame deduplication limit repeated work. They do not inspect every moment of a long video.

Semantic topics also update a shared Redis topic graph, including Unicode tags and words. The recommendation engine combines model-compatible vectors and topic relationships with freshness, followed creators, social signals, and qualified viewing activity. Author, topic, and duplicate-media diversity help keep a feed from becoming repetitive. Every candidate still passes visibility, block, and explicit-content preference checks. Merely having an OCR result or transcript earns no extra relevance bonus.

## Labels, provenance, and recovery

An explicit-content label is separate from moderation: an automated result does not remove a post or penalize an account, and a negative result does not clear an author’s manual label. Anime is a topic, not an explicit-content rule. AI provenance badges reflect embedded declarations rather than an appearance-based guess. Re-upload attribution uses eligible public matches and remains heuristic.

Provider requests share usage budgets across worker instances. Fresh uploads take priority over background repairs, and exhausted budgets defer analysis instead of recording a false success. Successful empty OCR and silent/no-audio transcription are valid completed outcomes. Failed embeddings remain pending; placeholder local vectors do not enter semantic recommendations.

## Measuring usefulness

The project includes reviewed-media evaluation tools for OCR/transcription errors, classification mistakes, retrieval relevance, and provider latency. A separate benchmark compares the bounded Redis semantic index with exact cosine neighbors before recommending a dedicated vector index. Attributed web/native feedback and stable experiment cohorts support measured ranking changes.

These parts are designed to complement one another, but more providers do not guarantee better recommendations. Extraction mistakes can propagate into labels and vectors. Representative reviewed content and production experiments are needed to establish quality; synthetic fixtures only verify that the plumbing works. Optional multimodal embeddings and ranking experiments stay opt-in until there is evidence to enable them.

Provider configuration and budget behavior are described below. Use the tracked environment defaults and Docker health checks when operating the worker.

## Classification providers and budget exhaustion

Remote Clef classification is opt-in in every environment: `MEDIA_CLEF_ENABLED` defaults to `0`, even when Cloudflare credentials are configured. Local development also sets `MEDIA_CLEF_DAILY_NEURONS=0`. For native ASM posts, gusts and attachments, production sets `MEDIA_CLEF_ENABLED=1` and a positive daily budget so semantic topic labels continue feeding recommendations. `MEDIA_EXTERNAL_CLEF_ENABLED` independently defaults to `0`: Bluesky safety checks cannot spend that allowance. Optional external escalation requires both flags to be `1`. Disabled calls defer before image preparation or provider access, and semantic/post classification backfills do not enqueue new work. Existing stored decisions remain available; new semantic topic labels and contextual text judgments stay pending rather than receiving fabricated results.

When enabled, Clef reserves its maximum model cost in shared Redis before each request. `MEDIA_CLEF_DAILY_NEURONS` defaults to 9000 outside the development env file and is clamped to 0–9500. Zero disables new requests. This bounds this application's use across replicas, not the account's combined usage with other applications. It cannot guarantee account-wide free-tier availability. Budget exhaustion, provider errors and rate limits defer affected jobs. Upload/transcoding queues and feed APIs continue serving.

SwiftFormer XS runs separately in apps/classifier. Local Docker development starts its API at http://127.0.0.1:3014 with matching MEDIA_CLASSIFIER_URL and MEDIA_CLASSIFIER_API_TOKEN defaults in .env.development. `bun scripts/classifier-smoke.ts image.jpg` evaluates a local image through the app client. Production credentials remain deployment secrets. External image safety uses the existing conservative local thresholds, a seven-day content-hash cache, and shares concurrent identical assessments within each worker. Ambiguous images remain `uncertain` and withheld by default; missing local configuration also stays uncertain without image downloads. The uncertainty result is cached for five minutes and its queue claim is released, avoiding a permanently delayed cloud job. Optional Clef escalation asks the three safety questions only, with a separate cache from full topic classification. The local SFW/NSFW/NSFL model does not produce semantic topics or contextual text judgments; thresholds and provider changes still need representative accuracy evaluation.
