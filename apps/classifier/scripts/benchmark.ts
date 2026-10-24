// Each worker issues sequential requests; concurrency is controlled by the worker count.
// oxlint-disable no-await-in-loop
import { createHash } from "node:crypto";
import { cpus, totalmem } from "node:os";

const baseUrl = process.env.BENCHMARK_BASE_URL;
const token = process.env.CLASSIFIER_API_TOKEN;
if (!baseUrl || !token) {
  throw new Error("BENCHMARK_BASE_URL and CLASSIFIER_API_TOKEN are required");
}
const durationMs = Number(process.env.BENCHMARK_STAGE_MS ?? 15_000);
if (
  !Number.isSafeInteger(durationMs) ||
  durationMs < 1000 ||
  durationMs > 30_000
) {
  throw new Error("BENCHMARK_STAGE_MS must be from 1000 to 30000");
}
const auth = { authorization: `Bearer ${token}` };
const urls = [
  "https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/beignets-task-guide.png",
  "https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/cats.png",
  "https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/coco_sample.png",
];
const assets = await Promise.all(
  urls.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Benchmark image download HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url,
    };
  })
);
const metadata = await fetch(`${baseUrl}/v1/model`, { headers: auth });
if (!metadata.ok) {
  throw new Error(`Model metadata HTTP ${metadata.status}`);
}
console.info(
  JSON.stringify({
    assets: assets.map(({ url, sha256, bytes }) => ({
      bytes: bytes.byteLength,
      sha256,
      url,
    })),
    event: "benchmark.start",
    host: {
      cores: cpus().length,
      cpu: cpus()[0]?.model,
      memoryBytes: totalmem(),
    },
    model: await metadata.json(),
  })
);

const percentile = (samples: number[], fraction: number) => {
  const sorted = samples.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
};

function readTiming(value: unknown) {
  if (!value || typeof value !== "object" || !("timing" in value)) {
    return null;
  }
  const { timing } = value;
  if (
    !timing ||
    typeof timing !== "object" ||
    !("inferenceMs" in timing) ||
    !("decodeMs" in timing) ||
    !("queuedMs" in timing)
  ) {
    return null;
  }
  const { decodeMs, inferenceMs, queuedMs } = timing;
  if (
    typeof decodeMs !== "number" ||
    typeof inferenceMs !== "number" ||
    typeof queuedMs !== "number" ||
    ![decodeMs, inferenceMs, queuedMs].every(Number.isFinite)
  ) {
    return null;
  }
  return { decodeMs, inferenceMs, queuedMs };
}

const protocolProbe = async () => {
  const url = process.env.BENCHMARK_PROTOCOL_URL;
  if (!url) {
    return null;
  }
  const start = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    await response.arrayBuffer();
    return { ms: performance.now() - start, status: response.status };
  } catch {
    return { ms: performance.now() - start, status: 0 };
  }
};

const baseline = [];
for (let index = 0; index < 30; index += 1) {
  const probe = await protocolProbe();
  if (probe) {
    baseline.push(probe);
  }
}
console.info(
  JSON.stringify({
    event: "benchmark.protocol_baseline",
    failures: baseline.filter((p) => p.status !== 200).length,
    p50Ms: percentile(
      baseline.map((p) => p.ms),
      0.5
    ),
    p95Ms: percentile(
      baseline.map((p) => p.ms),
      0.95
    ),
    samples: baseline.length,
  })
);

for (const concurrency of [1, 2, 4, 8, 16]) {
  let sequence = 0;
  const started = performance.now();
  const deadline = started + durationMs;
  const latency: number[] = [];
  const inference: number[] = [];
  const decode: number[] = [];
  const queued: number[] = [];
  const status: Record<string, number> = {};
  const protocol: { ms: number; status: number }[] = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      const asset = assets[sequence % assets.length];
      sequence += 1;
      if (!asset) {
        throw new Error("Missing benchmark asset");
      }
      const start = performance.now();
      try {
        const response = await fetch(`${baseUrl}/v1/classify`, {
          body: asset.bytes,
          headers: { ...auth, "content-type": "image/png" },
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        });
        status[String(response.status)] =
          (status[String(response.status)] ?? 0) + 1;
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 503) {
            await Bun.sleep(100);
          }
          continue;
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          status.invalid_response = (status.invalid_response ?? 0) + 1;
          continue;
        }
        const timing = readTiming(body);
        if (timing) {
          latency.push(performance.now() - start);
          inference.push(timing.inferenceMs);
          decode.push(timing.decodeMs);
          queued.push(timing.queuedMs);
        } else {
          status.invalid_response = (status.invalid_response ?? 0) + 1;
        }
      } catch {
        status.transport_error = (status.transport_error ?? 0) + 1;
      }
    }
  });
  const monitor = async () => {
    while (performance.now() < deadline) {
      const probe = await protocolProbe();
      if (probe) {
        protocol.push(probe);
      }
      await Bun.sleep(500);
    }
  };
  await Promise.all([...workers, monitor()]);
  const elapsedMs = performance.now() - started;
  console.info(
    JSON.stringify({
      concurrency,
      decode: {
        p50Ms: percentile(decode, 0.5),
        p95Ms: percentile(decode, 0.95),
      },
      elapsedMs,
      event: "benchmark.stage",
      inference: {
        p50Ms: percentile(inference, 0.5),
        p95Ms: percentile(inference, 0.95),
      },
      latency: {
        p50Ms: percentile(latency, 0.5),
        p95Ms: percentile(latency, 0.95),
        p99Ms: percentile(latency, 0.99),
      },
      protocol: {
        failures: protocol.filter((p) => p.status !== 200).length,
        p50Ms: percentile(
          protocol.map((p) => p.ms),
          0.5
        ),
        p95Ms: percentile(
          protocol.map((p) => p.ms),
          0.95
        ),
        samples: protocol.length,
      },
      queued: {
        p50Ms: percentile(queued, 0.5),
        p95Ms: percentile(queued, 0.95),
      },
      status,
      successful: latency.length,
      throughputImagesPerSecond: (latency.length * 1000) / elapsedMs,
    })
  );
}
const final = await fetch(`${baseUrl}/v1/model`, { headers: auth });
if (!final.ok) {
  throw new Error(`Final model metadata HTTP ${final.status}`);
}
console.info(
  JSON.stringify({ event: "benchmark.complete", model: await final.json() })
);
