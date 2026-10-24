import { ClassifierError } from "./error";
import { maxImageBytes } from "./model";

export async function readImageBody(request: Request, signal: AbortSignal) {
  signal.throwIfAborted();
  const reader = request.body?.getReader();
  if (!reader) {
    throw new ClassifierError("invalid_image", 422);
  }
  const abort = () => {
    // oxlint-disable-next-line promise/prefer-await-to-then -- an abort event cannot await cancellation of the blocked reader.
    void reader.cancel().catch(() => {
      /* empty */
    });
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      // oxlint-disable-next-line no-await-in-loop -- each chunk must fit the byte limit before accepting another.
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > maxImageBytes) {
        throw new ClassifierError("image_too_large", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {
      /* empty */
    });
    reader.releaseLock();
  }
}
