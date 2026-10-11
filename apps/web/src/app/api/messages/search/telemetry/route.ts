import { consumeRateLimit } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import { parseMessageSearchClientMetricBatch } from "@/lib/messages/search-client-metric-contract";
import { recordMessageSearchClientMetrics } from "@/lib/messages/search-client-metrics";

const MAX_BODY_BYTES = 4096;

async function readBoundedBody(
  request: Request
): Promise<
  | { status: "ok"; text: string }
  | { status: "too-large" }
  | { status: "invalid" }
> {
  if (!request.body) {
    return { status: "ok", text: "" };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- sequential reads preserve stream backpressure
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        try {
          // eslint-disable-next-line no-await-in-loop -- stop reading before returning the size error
          await reader.cancel();
        } catch {
          return { status: "too-large" };
        }
        return { status: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { status: "invalid" };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      status: "ok",
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { status: "invalid" };
  }
}

export async function POST(request: Request): Promise<Response> {
  let userId: string | undefined;
  try {
    const session = await getSessionFromApi();
    userId = session?.user?.id;
  } catch {
    return Response.json(
      { error: "Telemetry is temporarily unavailable" },
      { status: 503 }
    );
  }
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await consumeRateLimit({
    bucket: "message-search-telemetry",
    identifier: userId,
    limit: 30,
    windowSeconds: 60,
  }).catch(() => null);
  if (!rateLimit) {
    return Response.json(
      { error: "Telemetry is temporarily unavailable" },
      { status: 503 }
    );
  }
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many telemetry requests" },
      {
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        status: 429,
      }
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json(
      { error: "Telemetry request is too large" },
      { status: 413 }
    );
  }

  const boundedBody = await readBoundedBody(request);
  if (boundedBody.status === "too-large") {
    return Response.json(
      { error: "Telemetry request is too large" },
      { status: 413 }
    );
  }
  if (boundedBody.status === "invalid") {
    return Response.json(
      { error: "Invalid telemetry request" },
      { status: 400 }
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(boundedBody.text);
  } catch {
    return Response.json(
      { error: "Invalid telemetry request" },
      { status: 400 }
    );
  }
  const events = parseMessageSearchClientMetricBatch(body);
  if (!events) {
    return Response.json(
      { error: "Invalid telemetry request" },
      { status: 400 }
    );
  }

  recordMessageSearchClientMetrics(events);
  return Response.json({ accepted: events.length }, { status: 202 });
}
