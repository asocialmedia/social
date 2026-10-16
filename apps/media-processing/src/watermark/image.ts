// Portable opaque identity without another lossy pixel encode. Attribution
// still requires a matching public asset in the database; metadata is a hint.
import type { WatermarkPayload } from "@asm/media";
import { mediaIdentityXmp } from "@asm/media";
import sharp from "sharp";

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xed_b8_83_20 : 0);
    }
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function riffChunk(name: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(name, 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([
    header,
    payload,
    ...(payload.length % 2 ? [Buffer.alloc(1)] : []),
  ]);
}

export async function watermarkImageBuffer(
  input: Buffer,
  payload: WatermarkPayload,
  maxPixels: number,
  aiGenerated = false
): Promise<Buffer | null> {
  const metadata = await sharp(input, {
    limitInputPixels: maxPixels,
  }).metadata();
  const { height, width } = metadata;
  if (!width || !height) {
    return null;
  }
  const xmp = Buffer.from(mediaIdentityXmp(payload.mediaId, aiGenerated));
  if (metadata.format === "jpeg") {
    const body = Buffer.concat([
      Buffer.from("http://ns.adobe.com/xap/1.0/\0"),
      xmp,
    ]);
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0xff_e1, 0);
    header.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([
      input.subarray(0, 2),
      header,
      body,
      input.subarray(2),
    ]);
  }
  if (metadata.format === "png") {
    let offset = 8;
    while (offset + 12 <= input.length) {
      const length = input.readUInt32BE(offset);
      if (offset + 12 + length > input.length) {
        throw new Error("Invalid PNG chunk");
      }
      const name = input.toString("ascii", offset + 4, offset + 8);
      if (name === "IDAT" || name === "IEND") {
        const data = Buffer.concat([
          Buffer.from("XML:com.adobe.xmp\0\0\0\0\0"),
          xmp,
        ]);
        const nameAndData = Buffer.concat([Buffer.from("iTXt"), data]);
        const chunk = Buffer.alloc(data.length + 12);
        chunk.writeUInt32BE(data.length, 0);
        nameAndData.copy(chunk, 4);
        chunk.writeUInt32BE(pngCrc(nameAndData), data.length + 8);
        return Buffer.concat([
          input.subarray(0, offset),
          chunk,
          input.subarray(offset),
        ]);
      }
      offset += length + 12;
    }
    throw new Error("PNG has no end chunk");
  }
  if (metadata.format === "webp") {
    const chunks: Buffer[] = [];
    let extended = false;
    let offset = 12;
    while (offset + 8 <= input.length) {
      const length = input.readUInt32LE(offset + 4);
      const end = offset + 8 + length + (length % 2);
      if (end > input.length) {
        throw new Error("Invalid WebP chunk");
      }
      const name = input.toString("ascii", offset, offset + 4);
      if (name !== "XMP ") {
        const chunk = Buffer.from(input.subarray(offset, end));
        if (name === "VP8X") {
          if (length !== 10) {
            throw new Error("Invalid WebP extended header");
          }
          chunk[8] = (chunk[8] ?? 0) | 0x04;
          extended = true;
        }
        chunks.push(chunk);
      }
      offset = end;
    }
    if (!extended) {
      const header = Buffer.alloc(10);
      header[0] = 0x04 | (metadata.hasAlpha ? 0x10 : 0);
      header.writeUIntLE(width - 1, 4, 3);
      header.writeUIntLE(height - 1, 7, 3);
      chunks.unshift(riffChunk("VP8X", header));
    }
    chunks.push(riffChunk("XMP ", xmp));
    const header = Buffer.from(input.subarray(0, 12));
    header.writeUInt32LE(
      4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      4
    );
    return Buffer.concat([header, ...chunks]);
  }
  return null;
}

export function watermarkPayloadFingerprint(payload: WatermarkPayload): string {
  return `${payload.mediaId}:${payload.hashedUploaderId ?? "anon"}:v${payload.version}`;
}
