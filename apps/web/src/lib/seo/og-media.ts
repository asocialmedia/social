import sharp from "sharp";

// Resolve public bytes before Satori renders; missing/private assets fall back to a text card.
export async function ogMediaDataUrl(
  url: string | null
): Promise<string | null> {
  if (!url) {
    return null;
  }
  const limit = 5 * 1024 * 1024;
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("image/") ||
      Number(response.headers.get("content-length")) > limit
    ) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) {
      return null;
    }
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- stop the download before accepting an over-limit body.
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        bytes += chunk.value.byteLength;
        if (bytes > limit) {
          return null;
        }
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => null);
      reader.releaseLock();
    }
    const image = await sharp(Buffer.concat(chunks), {
      limitInputPixels: 16_000_000,
    })
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${image.toString("base64")}`;
  } catch {
    return null;
  }
}
