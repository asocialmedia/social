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

All neural inference uses cloud APIs. FFmpeg, libvips/Sharp, malware scanning, metadata handling, silence checks, similarity calculations, and queue coordination still run in the worker. Those local operations prepare and protect media; they do not load local neural models.

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

Clef requests reserve their maximum model cost in shared Redis before calling Cloudflare. MEDIA_CLEF_DAILY_NEURONS defaults to 9000 and is clamped to 0–9500, below the current 10,000-neuron free daily allocation. Zero disables new requests. Oversized settings cannot enable paid inference or prevent startup. The production setting is 9500. Cached decisions remain usable; exhausted budgets, provider errors and rate limits defer affected analysis jobs. The workers, upload/transcoding queues and feed APIs continue serving. Pending media does not receive a fabricated safe verdict. The allowance is shared by this application's replicas and models in the same account; other applications using that Cloudflare account must share the account's overall free allocation.

SwiftFormer XS runs separately in apps/classifier. Local Docker development starts its API at http://127.0.0.1:3014 with matching MEDIA_CLASSIFIER_URL and MEDIA_CLASSIFIER_API_TOKEN defaults in .env.development. `bun scripts/classifier-smoke.ts image.jpg` evaluates a local image through the app client. Production credentials remain deployment secrets. The client does not replace Clef's topic, sexualized-content or text decisions; safe-feed admission requires a representative accuracy evaluation before changing providers.
