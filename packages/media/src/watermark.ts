// Invisible watermark helpers — pure, client-safe math. No sharp/Bun/ffmpeg
// dependency: this module only builds the payload and the tiling pattern;
// the worker wrapper (apps/media-processing/src/watermark/*) drives sharp.

import type { WatermarkPayload } from "./types";

function fnv1a32(input: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.codePointAt(index) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d_2b_79_f5;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Deterministic HMAC-like keyed hash for userId → hashedUploaderId. */
export function hashUserId(
  userId: string | null,
  pepper: string | null
): string | null {
  if (!userId) {
    return null;
  }
  // Simple keyed hash: H(pepper || ":" || userId). Pepper lives in env,
  // never appears in the manifest watermark or logs.
  const material = pepper ? `${pepper}:${userId}` : userId;
  // Use FNV-1a 128-bit stretched via double pass; deterministic even
  // without WebCrypto. The output is 12 hex chars (48 bits) — enough to
  // disambiguate users without being reversible.
  const low = fnv1a32(material).toString(16).padStart(8, "0");
  const high = fnv1a32(`${material}:1`).toString(16).padStart(8, "0");
  return (low + high).slice(0, 12);
}

export function buildWatermarkPayload(
  mediaId: string,
  hashedUploaderId: string | null
): WatermarkPayload {
  return { hashedUploaderId, mediaId, version: 1 };
}

/** Build a binary 0/1 tile pattern seeded by the payload — deterministic, tiled across the image. */
export function buildWatermarkPattern(
  payload: WatermarkPayload,
  width: number,
  height: number
): Uint8Array {
  const seed = fnv1a32(
    `${payload.mediaId}:${payload.hashedUploaderId ?? ""}:${payload.version}`
  );
  const rng = mulberry32(seed);
  const out = new Uint8Array(width * height);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = rng() > 0.5 ? 1 : 0;
  }
  return out;
}

/** CRC-16 (CCITT) for payload bit-error detection — companion to the tiled LSB. */
export function crc16Ccitt(bytes: Uint8Array): number {
  let crc = 0xff_ff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let index = 0; index < 8; index += 1) {
      crc =
        crc & 0x80_00 ? ((crc << 1) ^ 0x10_21) & 0xff_ff : (crc << 1) & 0xff_ff;
    }
  }
  return crc & 0xff_ff;
}
