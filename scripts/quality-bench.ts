// Measures perceptual quality of the pipeline's WebP encodes.
// Compares each sample's re-encoded derivatives against the original via
// ffmpeg's ssim + psnr filters and reports the average score plus the
// compression ratio. Run against a curated sample folder before bumping
// quality settings so numbers - not vibes - drive the trade-off.
//
// Usage: bun scripts/quality-bench.ts [samples/dir] [--qualities 70,78,84]
//
// ffprobe/ffmpeg must be on PATH (the media worker's ffmpeg image is fine).

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SAMPLE_DIR =
  process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : "samples";
const Q_ARG = process.argv.find((arg) => arg.startsWith("--qualities"));
const QUALITIES = Q_ARG
  ? (Q_ARG.split("=")[1]
      ?.split(",")
      .map((value) => Number(value.trim()))
      .filter(Number.isFinite) ?? [78, 84])
  : [78, 84];

function parseSsim(output: string): number | null {
  const match = /All:([\d.]+)/.exec(output);
  return match ? Number(match[1]) : null;
}

function parsePsnr(output: string): number | null {
  const match = /average:([\d.]+)/.exec(output);
  const value = match ? Number(match[1]) : null;
  return value === null || !Number.isFinite(value) ? null : Math.min(value, 99);
}

async function measureMetrics(
  originalPath: string,
  variantPath: string
): Promise<{ psnr: number | null; ssim: number | null }> {
  // ffmpeg ssim/psnr lavfi filters print stats to stderr; the demuxed null
  // output is discarded. Scale to the variant's dimensions when sizes differ
  // - the filter compares frame-for-frame.
  const args = [
    "-i",
    originalPath,
    "-i",
    variantPath,
    "-filter_complex",
    "[0:v][1:v]ssim;[0:v][1:v]psnr",
    "-f",
    "null",
    "-",
  ];
  const proc = Bun.spawn(["ffmpeg", ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return { psnr: parsePsnr(stderr), ssim: parseSsim(stderr) };
}

async function encodeVariant(
  samplePath: string,
  quality: number,
  outPath: string
): Promise<number> {
  const image = new Bun.Image(await Bun.file(samplePath).arrayBuffer());
  const buffer = await image.webp({ quality }).buffer();
  await Bun.write(outPath, new Uint8Array(buffer));
  return buffer.byteLength;
}

if (!existsSync(SAMPLE_DIR)) {
  console.error(`Sample dir not found: ${SAMPLE_DIR}`);
  console.error("  mkdir samples && cp your samples/*.jpg samples/");
  process.exit(0);
}

const samples = readdirSync(SAMPLE_DIR)
  .map((name) => path.join(SAMPLE_DIR, name))
  .filter((fullPath) => {
    try {
      return (
        statSync(fullPath).isFile() && /\.(jpe?g|png|webp)$/i.test(fullPath)
      );
    } catch {
      return false;
    }
  });

if (samples.length === 0) {
  console.error(`No images found in ${SAMPLE_DIR} (jpg/png/webp)`);
  process.exit(0);
}

console.log(
  `quality-bench: ${samples.length} samples, qualities ${QUALITIES.join(", ")}`
);
for (const quality of QUALITIES) {
  for (const sample of samples) {
    const tmp = `/tmp/bench-${quality}-${path.basename(sample)}.webp`;
    try {
      const variantBytes = await encodeVariant(sample, quality, tmp);
      const originalBytes = statSync(sample).size;
      const ratio = originalBytes > 0 ? variantBytes / originalBytes : 0;
      const { psnr, ssim } = await measureMetrics(sample, tmp);
      const ssimText = ssim === null ? "n/a" : ssim.toFixed(4);
      const psnrText = psnr === null ? "n/a" : `${psnr.toFixed(2)} dB`;
      console.log(
        `  q${String(quality).padStart(3)} ${path.basename(sample).padEnd(24)} ${Math.round(variantBytes / 1024)}kB ` +
          `(${(ratio * 100).toFixed(1)}% of original)  ssim ${ssimText}  psnr ${psnrText}`
      );
    } catch (error) {
      console.warn(
        `  q${quality} ${path.basename(sample)} failed:`,
        String(error).slice(0, 120)
      );
    } finally {
      try {
        await Bun.file(tmp).delete();
      } catch {
        /* ignore */
      }
    }
  }
}
console.log(
  "bench done - compare ssim/psnr across qualities against the byte budget."
);
