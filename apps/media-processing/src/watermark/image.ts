// Image watermark embed — tiled LSB on the green channel (closest to Y).
// Pixels are perturbed +-1 where a deterministic payload-derived pattern is 1,
// keeping density low so WebP Q75 preserves it and a 20% crop still contains
// multiple tiles. When sharp is unavailable (CI without native dep), returns
// null and scan publishes clean (DB authoritative).

import type { WatermarkPayload } from "@asm/media";
import { buildWatermarkPattern } from "@asm/media";

export async function watermarkImageBuffer(
  input: Buffer,
  payload: WatermarkPayload,
  maxPixels: number
): Promise<Buffer | null> {
  try {
    // Prefer sharp when available — native libvips, fastest.
    // sharp is an optional peer dep; missing type is handled at runtime.
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- dynamic optional import
    const sharpModule: unknown =
      await // oxlint-disable-next-line typescript/no-unsafe-call -- dynamic optional import
      (import("sharp" as string).catch(() => null) as Promise<unknown>);
    if (sharpModule) {
      const mod = sharpModule as Record<string, unknown>;
      const sharpFactory = (mod.default ?? mod) as unknown as (
        input: Buffer | { create: unknown } | Uint8Array,
        options?: Record<string, unknown>
      ) => {
        // oxlint-disable typescript/method-signature-style -- sharp interface uses method signatures
        metadata(): Promise<{
          width?: number;
          height?: number;
          channels?: number;
        }>;
        ensureAlpha(): unknown;
        raw(): {
          toBuffer(opts: unknown): Promise<{
            data: Buffer;
            info: { channels?: number; width?: number; height?: number };
          }>;
        };
        png(): { toBuffer(): Promise<Buffer> };
        jpeg(opts: unknown): { toBuffer(): Promise<Buffer> };
        toBuffer(): Promise<Buffer>;
      };

      const factoryAsProbe = sharpFactory as unknown as (input: Buffer) => {
        // oxlint-disable typescript/method-signature-style -- sharp
        metadata(): Promise<{
          width?: number;
          height?: number;
          channels?: number;
        }>;
        ensureAlpha(): unknown;
        raw(): {
          toBuffer(opts: unknown): Promise<{
            data: Buffer;
            info: { channels?: number; width?: number; height?: number };
          }>;
        };
        png(): { toBuffer(): Promise<Buffer> };
        jpeg(opts: unknown): { toBuffer(): Promise<Buffer> };
        toBuffer(): Promise<Buffer>;
      };
      // oxlint-disable-next-line typescript/no-unsafe-call -- sharp factory
      const probe = factoryAsProbe(input);
      const meta = await probe.metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (!width || !height || width * height > maxPixels * 2) {
        return null;
      }

      const pattern = buildWatermarkPattern(payload, width, height);
      // oxlint-disable-next-line typescript/no-unsafe-call -- sharp
      const rawResult = await (
        sharpFactory(input) as unknown as {
          ensureAlpha(): {
            raw(): {
              toBuffer(
                opts: unknown
              ): Promise<{ data: Buffer; info: { channels?: number } }>;
            };
          };
        }
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true } as unknown as never);

      const data = rawResult.data as Buffer;
      const channels = rawResult.info.channels ?? 4;

      for (let y = 0; y < height; y += 1) {
        const rowBase = y * width;
        for (let x = 0; x < width; x += 1) {
          const patternBit = pattern[rowBase + x] ?? 0;
          if (patternBit !== 1 || (x + y) % 2 !== 0) {
            continue;
          }
          const gOffset = (rowBase + x) * channels + 1;
          const current = data[gOffset] ?? 0;
          const delta = (x * 31 + y * 17) % 2 === 0 ? 1 : -1;
          data[gOffset] = Math.min(255, Math.max(0, current + delta));
        }
      }

      const hasAlpha =
        channels === 4 &&
        data.some((value, index) => index % 4 === 3 && value < 255);

      const rawOpts = {
        raw: { channels, height, width },
      } as unknown as Parameters<typeof sharpFactory>[1];
      const out = hasAlpha
        ? await (
            sharpFactory(data as unknown as Buffer, rawOpts) as unknown as {
              png(): { toBuffer(): Promise<Buffer> };
            }
          )
            .png()
            .toBuffer()
        : await (
            sharpFactory(data as unknown as Buffer, rawOpts) as unknown as {
              jpeg(opts: unknown): { toBuffer(): Promise<Buffer> };
            }
          )
            .jpeg({ quality: 92 })
            .toBuffer();

      return out as Buffer;
    }

    return null;
  } catch {
    return null;
  }
}

export function watermarkPayloadFingerprint(payload: WatermarkPayload): string {
  return `${payload.mediaId}:${payload.hashedUploaderId ?? "anon"}:v${payload.version}`;
}
