# SwiftFormer XS production VPS benchmark

Measured on 2026-10-24 on the worker VPS behind dash.amemorymachine.cc: two Intel Xeon virtual CPUs at 2.20 GHz and 16,761,929,728 bytes of host RAM. Dokploy names its existing protocol worker `asm-protocols-us-east-4avlei`; the classifier is deployed alongside that worker on the user's requested secondary host. This report identifies the tested machine without independently asserting its geographic region.

The selected configuration is one ONNX thread, a one-CPU container ceiling, a 2 GiB memory ceiling, one active request and eight waiting slots. The public base URL is https://protoalt.asocialmedia.cc/classifier. Existing services keep their routes. Feed integration is not enabled.

## Method

The load generator ran in a separate container on the same VPS, limited to half a CPU. Each concurrency stage lasted 15 seconds, including final in-flight request completion in the throughput denominator. It rotated three real PNG photographs of 357,460–694,498 bytes. Every request decoded and executed the pinned graph; there is no result cache. The JSON artifacts record corpus URLs and SHA-256 hashes, model identity, stage timing, HTTP statuses and co-resident protocol health probes. Image downloads happened before timing, so throughput excludes downloading remote media.

Runtime: Bun 1.4.4, ONNX Runtime Node 1.30.0 and sharp 0.35.5. Model revision: 54f4560bd9c5ee92d45dc30418a8f8680e80de6d. Both profiles used the same model and preprocessing. The one-thread run used source ca2ef4777634964b2c4e92f10e27912d9308078f; the two-thread run used 732cefb9bedaf5f6006e38c31477cea02f5ee874, whose runtime change made health checks honor PORT. Later download-path and benchmark-reporting fixes do not change inference.

## Within-VPS HTTP results

| Concurrent requests | One thread / 1 CPU, images/s | p50 latency, ms | p95 latency, ms | Successful requests | HTTP 503 |
| --- | --: | --: | --: | --: | --: |
| 1 | 12.26 | 73.75 | 109.38 | 185 | 0 |
| 2 | 11.80 | 164.86 | 248.70 | 179 | 0 |
| 4 | 12.53 | 311.26 | 357.92 | 191 | 0 |
| 8 | 11.94 | 643.89 | 783.68 | 186 | 0 |
| 16 | 11.15 | 777.43 | 1295.22 | 175 | 805 |

At concurrency one, median decode time was 19.42 ms and median graph inference was 46.17 ms. Across the run, 916 requests succeeded, with no transport errors or unexpected HTTP errors. At concurrency 16, deliberate queue-capacity rejections returned 503; this rejection count depends on the generator's 100 ms retry pause and is not a normal-traffic failure-rate estimate.

The two-thread / 1.5-CPU profile delivered 11.28, 11.82, 12.31, 12.44 and 10.82 images/s at the same five concurrency levels. Its single-request p95 was 149.23 ms. Allocating more CPU did not produce a useful throughput improvement in this test, so production returns to one thread / one CPU.

Docker samples showed approximately 95 MiB of classifier RAM during the one-thread load, with a 104.2 MiB peak across the sampling window. CPU reached approximately 102% of one logical core. The two-thread profile reached approximately 148% of a core. Resource samples are periodic observations rather than high-resolution peak measurements.

Protocol health had no failures: 30 baseline probes plus 30 per stage for each profile. For the one-thread run, baseline p95 was 1.32 ms, normal-stage p95 was 3.53–4.63 ms, and the concurrency-16 stage reached 15.52 ms. This checks the health endpoint under load, not complete protocol/feed request performance.

## Public HTTPS upload results

Separate probes from the development machine traversed the public Cloudflare route with a persistent HTTPS connection, 12 sequential successful requests per image variant. These were performed while the two-thread profile was deployed. Warm figures exclude the first connection-establishing request.

| Uploaded image | Bytes | Warm median round trip | Warm maximum | First round trip |
| --- | --: | --: | --: | --: |
| Original PNG | 357460 | 872 ms | 1498 ms | 3337 ms |
| 512-pixel JPEG | 49373 | 477 ms | 756 ms | 1179 ms |

These network measurements include image upload and the public route. They must not be confused with the 74 ms within-VPS median. A production worker on another continent will need its own end-to-end measurement. The final one-thread deployment is smoke-tested separately.

## Operational interpretation

Use a small number of asynchronous consumers, initially one or two, with backoff for 503. Increasing outstanding requests mostly adds queueing. Keep classification off the page-rendering path, deduplicate media by identity and prioritize likely feed candidates. Approximately 12 images/s would mathematically approach one million images/day only at continuous saturation; this short test does not establish sustained daily capacity, burst headroom or support for thousands of users. Multiple images and video frames each consume separate work.

This is a throughput and API-contract benchmark on three benign photographs. It does not measure recall for adult/gore content, adversarial robustness, recommendation quality, AI-generated-media detection or whole-video safety. Accuracy and thresholds require a separate representative evaluation before using the scores to admit content to safe feeds.

## Recorded results

- [One thread / one CPU](benchmarks/2026-10-24-benchmark-one-cpu.json)
- [Two threads / 1.5 CPU](benchmarks/2026-10-24-benchmark-two-threads.json)
- [Public PNG requests](benchmarks/2026-10-24-external-probe.json)
- [Public JPEG requests](benchmarks/2026-10-24-external-probe-jpeg.json)

Run `bun apps/media-classifier/scripts/benchmark.ts` from a private worker with CLASSIFIER_API_TOKEN, BENCHMARK_BASE_URL and optionally BENCHMARK_PROTOCOL_URL configured. This produces real load; use only an authorized environment with CPU limits. BENCHMARK_STAGE_MS controls stage duration.
