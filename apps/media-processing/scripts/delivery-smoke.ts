// Real codec + RustFS smoke on an explicitly local database. All fixture
// rows and objects are removed, even when an assertion fails.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

import { loadRootEnv } from "../src/load-env";

loadRootEnv();
if (
  !["localhost", "127.0.0.1", "::1"].includes(
    new URL(process.env.DATABASE_URL ?? "").hostname
  )
) {
  throw new Error("Delivery smoke requires a local database");
}
const { prisma, closePrisma, closeQueueConnections } = await import("@asm/db");
const { MEDIA_PIPELINE_VERSION } = await import("@asm/media");
const { default: sharp } = await import("sharp");
const { processMedia } = await import("../src/jobs/processing/process");
const { getS3 } = await import("../src/s3");
const { runFfmpeg, probeMedia } = await import("../src/transcode/ffmpeg");
const artifactDir =
  process.env.ASM_MEDIA_ARTIFACTS ?? "/tmp/asm-media-delivery-smoke";
await mkdir(artifactDir, { recursive: true });
const fixtureIds: string[] = [];
const keys = new Set<string>();
const results: Record<string, unknown>[] = [];
try {
  const pixels = Buffer.alloc(1600 * 1000 * 3);
  for (let y = 0; y < 1000; y += 1) {
    for (let x = 0; x < 1600; x += 1) {
      const index = (y * 1600 + x) * 3;
      pixels[index] = Math.floor((x / 1600) * 255);
      pixels[index + 1] = Math.floor((y / 1000) * 255);
      pixels[index + 2] = (x * 19 + y * 23) % 256;
    }
  }
  const imagePath = `${artifactDir}/source.jpg`;
  await sharp(pixels, { raw: { channels: 3, height: 1000, width: 1600 } })
    .jpeg({ quality: 96 })
    .toFile(imagePath);
  const videoPath = `${artifactDir}/source.mp4`;
  await runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "16",
      "-c:v",
      "libx264",
      "-crf",
      "14",
      "-c:a",
      "aac",
      videoPath,
    ],
    60_000
  );
  for (const fixture of [
    { mimeType: "image/jpeg", path: imagePath, type: "IMAGE" },
    { mimeType: "video/mp4", path: videoPath, type: "VIDEO" },
  ] as const) {
    const id = crypto.randomUUID();
    fixtureIds.push(id);
    const key = `media/${id}/smoke-original`;
    keys.add(key);
    const source = Bun.file(fixture.path);
    await getS3().write(key, source);
    await prisma.orm.public.PostMedia.create({
      _type: fixture.type,
      id,
      key,
      mimeType: fixture.mimeType,
      pipelineVersion: "3",
      publishedKey: key,
      size: source.size,
      status: "READY",
      url: "",
    });
    const started = performance.now();
    await processMedia({ mediaId: id });
    const derivatives = await prisma.orm.public.PostMediaDerivatives.where({
      mediaId: id,
    }).all();
    for (const derivative of derivatives) {
      keys.add(derivative.key);
    }
    assert.ok(derivatives.length > 0);
    assert.ok(
      await getS3().file(key).exists(),
      "original must survive processing"
    );
    const row = await prisma.orm.public.PostMedia.where({ id }).first();
    assert.equal(row?.pipelineVersion, MEDIA_PIPELINE_VERSION);
    if (fixture.type === "IMAGE") {
      assert.ok(derivatives.some((entry) => entry.variant === "webp"));
      for (const entry of derivatives.filter(
        (derivative) => derivative.kind === "md"
      )) {
        const bytes = Buffer.from(await getS3().file(entry.key).arrayBuffer());
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.width, 800);
        assert.ok(
          metadata.xmp?.includes(Buffer.from(id)),
          "delivery must carry opaque media identity"
        );
        await Bun.write(`${artifactDir}/md.${entry.variant}`, bytes);
      }
    } else {
      assert.ok(
        row?.hasHls,
        "short social videos should have adaptive delivery"
      );
      assert.ok(
        derivatives.some((entry) => entry.kind === "mp4"),
        "compatible progressive fallback must exist alongside HLS"
      );
      const hls = derivatives.find((entry) => entry.kind === "hls");
      assert.ok(hls);
      const base = hls.key.slice(0, hls.key.lastIndexOf("/"));
      const playlist = await getS3().file(`${base}/360p.m3u8`).text();
      const segmentNames = [
        ...playlist.matchAll(
          /(?:URI=")?(?<file>(?:init|seg)-[A-Za-z0-9.-]+\.(?:mp4|m4s))/g
        ),
      ]
        .map((match) => match.groups?.file)
        .filter((name): name is string => Boolean(name));
      for (const name of segmentNames) {
        keys.add(`${base}/${name}`);
        assert.ok(await getS3().file(`${base}/${name}`).exists());
      }
      keys.add(`${base}/360p.m3u8`);
      const mp4 = derivatives.find((entry) => entry.kind === "mp4");
      assert.ok(mp4);
      await Bun.write(`${artifactDir}/processed.mp4`, getS3().file(mp4.key));
      const mp4Probe = await probeMedia(`${artifactDir}/processed.mp4`);
      assert.equal(mp4Probe.video?.codec, "h264");
      const av1 = derivatives.find((entry) => entry.kind === "webm");
      if (av1) {
        await Bun.write(`${artifactDir}/processed.webm`, getS3().file(av1.key));
        const modernProbe = await probeMedia(`${artifactDir}/processed.webm`);
        assert.equal(modernProbe.video?.codec, "av1");
      }
    }
    results.push({
      derivatives: derivatives.map(({ kind, variant, sizeBytes }) => ({
        kind,
        sizeBytes,
        variant,
      })),
      processingMs: Math.round(performance.now() - started),
      sourceBytes: source.size,
      type: fixture.type,
    });
  }
  await Bun.write(
    `${artifactDir}/results.json`,
    `${JSON.stringify(results, null, 2)}\n`
  );
  console.log(JSON.stringify(results));
} finally {
  for (const id of fixtureIds) {
    const derivatives = await prisma.orm.public.PostMediaDerivatives.where({
      mediaId: id,
    }).all();
    for (const derivative of derivatives) {
      keys.add(derivative.key);
    }
    await prisma.orm.public.PostMedia.where({ id }).deleteAndCount();
  }
  await Promise.allSettled([...keys].map((key) => getS3().delete(key)));
  await closePrisma();
  await closeQueueConnections();
}
