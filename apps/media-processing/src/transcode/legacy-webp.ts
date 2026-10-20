import { createHash } from "node:crypto";

import { publishedKey } from "@asm/media";
import sharp from "sharp";

// One legacy writer replaced the WEBP form type with the chunk-body length.
// Match that exact signature and validate every chunk before trying a complete decode.
export async function prepareLegacyWebpRepair(source: Buffer, mediaId: string) {
  if (
    source.length < 30 ||
    source.toString("ascii", 0, 4) !== "RIFF" ||
    source.toString("ascii", 8, 12) === "WEBP" ||
    source.readUInt32LE(4) !== source.length - 8 ||
    source.readUInt32LE(8) !== source.length - 20
  ) {
    return null;
  }
  let offset = 12;
  let hasImage = false;
  while (offset + 8 <= source.length) {
    const kind = source.toString("ascii", offset, offset + 4);
    const size = source.readUInt32LE(offset + 4);
    if (
      ![
        "VP8X",
        "VP8 ",
        "VP8L",
        "ALPH",
        "ICCP",
        "EXIF",
        "XMP ",
        "ANIM",
        "ANMF",
      ].includes(kind)
    ) {
      return null;
    }
    hasImage ||= ["VP8 ", "VP8L", "ANMF"].includes(kind);
    offset += 8 + size + (size % 2);
    if (offset > source.length) {
      return null;
    }
  }
  if (offset !== source.length || !hasImage) {
    return null;
  }
  const bytes = Buffer.from(source);
  bytes.write("WEBP", 8, "ascii");
  await sharp(bytes, { limitInputPixels: 100_000_000 })
    .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, hash, key: publishedKey(mediaId, "webp", hash) };
}
