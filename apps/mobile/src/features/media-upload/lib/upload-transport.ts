// Byte transport to presigned storage URLs. Uploads stream from disk through
// expo-file-system's native UploadTask (progress, cancellation, response
// headers), so a 250MB video never lands in the JS heap. Multipart parts are
// cut into a temp file first (one 16 MiB slice at a time), uploaded, then
// deleted. The presigned hosts are not our origin, so the install-token
// interceptor correctly never touches these requests.
import { File, Paths } from "expo-file-system";

import { AbortError, HttpError, isAbortError } from "./retry";

function throwIfFailed(status: number, body: string): void {
  if (status >= 200 && status < 300) {
    return;
  }
  throw new HttpError(
    `Storage rejected the upload (${status})`,
    status,
    body.slice(0, 500)
  );
}

function wrapAbort(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted || isAbortError(error)) {
    throw new AbortError();
  }
  throw error;
}

// Single presigned PUT; Content-Type must equal the type the URL was signed
// for.
export async function putWholeFile(options: {
  contentType: string;
  onProgress: (bytesSent: number) => void;
  signal?: AbortSignal;
  uri: string;
  url: string;
}): Promise<void> {
  const file = new File(options.uri);
  try {
    const result = await file.upload(options.url, {
      headers: { "Content-Type": options.contentType },
      httpMethod: "PUT",
      onProgress: ({ bytesSent }) => options.onProgress(bytesSent),
      signal: options.signal,
    });
    throwIfFailed(result.status, result.body);
  } catch (error) {
    wrapAbort(error, options.signal);
  }
}

function headerValue(
  headers: Record<string, string>,
  name: string
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return value;
    }
  }
  return null;
}

// One multipart part: slice [start, end) into a temp file, PUT it with no
// Content-Type (the part URL is signed without one), return the ETag.
export async function putFilePart(options: {
  end: number;
  onProgress: (bytesSent: number) => void;
  signal?: AbortSignal;
  start: number;
  uri: string;
  url: string;
}): Promise<string> {
  if (options.signal?.aborted) {
    throw new AbortError();
  }
  const source = new File(options.uri);
  const partFile = new File(
    Paths.cache,
    `asm-part-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
  );
  const handle = source.open();
  try {
    handle.offset = options.start;
    const bytes = handle.readBytes(options.end - options.start);
    partFile.create({ overwrite: true });
    partFile.write(bytes);
  } finally {
    handle.close();
  }
  try {
    const result = await partFile.upload(options.url, {
      httpMethod: "PUT",
      onProgress: ({ bytesSent }) => options.onProgress(bytesSent),
      signal: options.signal,
    });
    throwIfFailed(result.status, result.body);
    const eTag = headerValue(result.headers, "etag");
    if (!eTag) {
      throw new HttpError("Storage returned no ETag for a part", 502);
    }
    return eTag;
  } catch (error) {
    return wrapAbort(error, options.signal);
  } finally {
    try {
      partFile.delete();
    } catch {
      // Cache files are reclaimed by the OS anyway.
    }
  }
}
