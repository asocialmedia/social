# SwiftFormer XS media classifier

An independent CPU inference service for OwenElliott/image-safety-classifier-xs. The service returns SFW, NSFW and NSFL probabilities. It does not change feed eligibility, assign recommendation topics, detect AI provenance or make deletion decisions.

The ONNX artifact is pinned to revision 54f4560bd9c5ee92d45dc30418a8f8680e80de6d and SHA-256 8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689. Its graph already includes normalization and softmax. Input preparation rotates image orientation, decodes RGB, stretches to 224×224 with bilinear interpolation and supplies NCHW float32 pixels in the 0–255 range. Input decoding accepts single-frame JPEG, PNG and WebP up to 4 MiB and 16 million pixels. An image or thumbnail assessment does not establish safety of an entire video.

## API

Measured on the production 2-vCPU / 16 GB worker: approximately 12 images/s, 74 ms median and 109 ms p95 within-VPS HTTP latency at concurrency one; approximately 95 MiB RAM under load. Two inference threads with 1.5 CPUs did not improve throughput. Public uploads from the development machine had a warm median of 477 ms for a 49 KB JPEG and 872 ms for a 357 KB PNG. Those public measurements used the two-thread profile. These short measurements do not establish classification accuracy or sustained daily capacity.

All v1 endpoints require `Authorization: Bearer <CLASSIFIER_API_TOKEN>`. Image URLs and JSON payloads are unsupported. Clients download permitted images before sending bytes; the server has no arbitrary-URL fetch endpoint.

- `GET /health` and `GET /ready`: minimal public readiness, available after the verified model loads.
- `GET /v1/model`: artifact identity, preprocessing version, thread settings, counters and queue state.
- `POST /v1/classify`: binary image request, returning probabilities, the highest-scoring label, model identity and decode/inference/queue/total timing in milliseconds.

```sh
curl --fail-with-body "$CLASSIFIER_BASE_URL/v1/classify" \
  -H "Authorization: Bearer $CLASSIFIER_API_TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @image.jpg
```

One inference runs at a time, with eight waiting requests by default. Full capacity returns 503 with Retry-After: 1; request cancellation/deadline returns 408, unsupported media type 415, invalid decoded media 422 and oversize uploads 413. There is no result cache, so repeated-image benchmarks execute the model each time.

## Configuration

Structured stdout logs also export through the OpenTelemetry SDK to OpenObserve over OTLP/HTTP. Set OTEL_EXPORTER_OTLP_ENDPOINT to the organization base (for example http://openobserve-dev:5080/api/default), OPENOBSERVE_USER, OPENOBSERVE_PASSWORD and OPENOBSERVE_LOG_STREAM=asm_classifier_logs. OTEL_EXPORTER_OTLP_LOGS_ENDPOINT overrides the full log endpoint; OTEL_EXPORTER_OTLP_HEADERS supports collector headers. Local Docker supplies the same development credentials as its OpenObserve container. Production uses its existing OpenObserve deployment credentials. OTEL_SDK_DISABLED=true disables export while preserving stdout logs.

Startup, shutdown and 30-second request summaries are logged. Images, request bodies and authentication headers are excluded. The exporter batches with a bounded 512-record queue and a three-second HTTP timeout. Collector outages do not block inference or readiness; queued telemetry can be dropped under prolonged failure. Shutdown flushes pending records.

Fractional attributes are exported as strings because this OpenObserve deployment rejects OTLP JSON doubleValue fields. Stdout preserves the original numeric values.

| Variable | Default | Meaning |
| --- | --- | --- |
| CLASSIFIER_API_TOKEN | Required | At least 32 characters; generated separately from protocol credentials |
| PORT | 3014 | HTTP listener |
| CLASSIFIER_THREADS | 1 | ONNX intra-operation threads, maximum two |
| CLASSIFIER_QUEUE_LIMIT | 8 | Maximum waiting requests, maximum 16 |
| CLASSIFIER_REQUEST_TIMEOUT_MS | 10000 | Total admitted request deadline, maximum 30000 |
| CLASSIFIER_MODEL_PATH | model.onnx | Read-only pinned model file |

## Build and verification

The release image is `ghcr.io/asocialmedia/asm-classifier:latest`, associated with this repository through its OCI source label. CI publishes amd64 and arm64 images when classifier runtime source, model download code, Docker inputs, runtime lock or dependencies change. Shared application changes, documentation, tests and version-only stamps do not rebuild the classifier. A successful publish redeploys the existing worker using the DOKPLOY_US_EAST credentials and DOKPLOY_US_EAST_CLASSIFIER_APP_ID secret.

`bun run docker:dev` builds the local classifier from apps/classifier and starts it at http://127.0.0.1:3014. Local development requires no GHCR login or production credentials. Its development-only token matches apps/media-processing/.env.development. From apps/media-processing, run `bun scripts/classifier-smoke.ts /path/to/image.jpg` to exercise the configured app client. The client returns verified model probabilities for evaluation and does not alter the safe-feed gate.

Use Bun workspace dependencies for development. Docker builds use runtime.bun.lock, a standalone lock generated from this workspace's package.json. Regenerate it in an isolated temporary directory with `bun install --lockfile-only --ignore-scripts` whenever dependencies change. This keeps a small deployment archive independent of the rest of the monorepo. Install scripts are disabled; the CPU native libraries ship in the ONNX Runtime package.

```sh
bun run --cwd apps/classifier model:download
bun test --parallel=4 apps/classifier/src
bun run check
bun run check-types
```

Build with apps/classifier as the Docker context. Configure Dokploy runtime CPU/memory ceilings and a separate authenticated route. Keep the classifier independent of the live recommendation path until throughput, content accuracy and co-resident protocol latency have been evaluated. ONNX inference already in progress is allowed to finish before its queue slot is released, even if its client disconnects.

The model card declares MIT licensing; its base SwiftFormer configuration declares Apache-2.0. See the pinned upstream model card and base architecture license for notices. Author-reported accuracy is not production acceptance evidence, and gore data is underrepresented in the published training dataset.

Sources: [model card](https://huggingface.co/OwenElliott/image-safety-classifier-xs), [pinned metadata](https://huggingface.co/api/models/OwenElliott/image-safety-classifier-xs/revision/54f4560bd9c5ee92d45dc30418a8f8680e80de6d) and [SwiftFormer](https://github.com/Amshaker/SwiftFormer).
