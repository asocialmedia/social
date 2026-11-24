import { setTimeout } from "node:timers/promises";

import { isStorageBucketMissing } from "@asm/media";

const storageErrorCodes = new Set([
  "AccessDenied",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "ENOTFOUND",
  "InternalError",
  "InvalidAccessKeyId",
  "NoSuchBucket",
  "RequestTimeout",
  "ServiceUnavailable",
  "SignatureDoesNotMatch",
  "SlowDown",
  "TimeoutError",
]);

export function profileObjectErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { code: "unknown" };
  }
  const { Code, code, name, cause, $metadata } = error as {
    Code?: unknown;
    code?: unknown;
    name?: unknown;
    cause?: { code?: unknown };
    $metadata?: { httpStatusCode?: unknown };
  };
  // Provider messages, stacks and request metadata may include signed URLs.
  const knownCode = [Code, code, name, cause?.code].find(
    (value) => typeof value === "string" && storageErrorCodes.has(value)
  );
  const status = $metadata?.httpStatusCode;
  return {
    code: knownCode ?? "unknown",
    ...(typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
      ? { upstreamStatus: status }
      : {}),
  };
}

export type ReadProfileObject = (
  key: string,
  signal: AbortSignal
) => Promise<{
  Body?: { transformToWebStream: () => ReadableStream<Uint8Array> };
  ContentLength?: number;
  ContentType?: string;
}>;

export async function retryProfileObjectRead<T>(
  read: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isStorageBucketMissing(error) || signal.aborted) {
      throw error;
    }
    await setTimeout(250, undefined, { signal });
    return read();
  }
}
