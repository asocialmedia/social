// oxlint-disable no-await-in-loop -- Sequential cryptography, database mutations and bounded streams preserve ordering and memory limits.
export async function parseBoundedJsonBody(
  request: Request,
  maxBytes = 100_000
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new Error("BODY_TOO_LARGE");
  }
  if (!request.body) {
    return null;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("BODY_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      return null;
    }
  } finally {
    reader.releaseLock();
  }
}
