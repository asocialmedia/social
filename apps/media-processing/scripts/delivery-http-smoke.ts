// Exercises the actual Next proxy against local RustFS and Postgres. Fixtures
// are isolated from real accounts and removed after the optional browser pass.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

import { loadRootEnv } from "../src/load-env";

loadRootEnv();
if (new URL(process.env.DATABASE_URL ?? "").hostname !== "localhost") {
  throw new Error("HTTP smoke requires the local database");
}
const {
  prisma,
  closePrisma,
  closeQueueConnections,
  getPostDataQuery,
  mapPostData,
} = await import("@asm/db");
const { getS3 } = await import("../src/s3");
const { processMedia } = await import("../src/jobs/process");
const artifactDir =
  process.env.ASM_MEDIA_ARTIFACTS ?? "/tmp/asm-media-http-smoke";
await mkdir(artifactDir, { recursive: true });
const sourceDir =
  process.env.ASM_MEDIA_SOURCE_DIR ?? "/tmp/asm-media-delivery-smoke";
const userId = crypto.randomUUID();
const postId = crypto.randomUUID();
const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const origin = "http://localhost:3000";
const storageKeys = new Set<string>();
const results: Record<string, unknown> = {};
try {
  await prisma.orm.public.Users.create({
    displayName: "Media smoke fixture",
    id: userId,
    username: `smoke_${userId.replaceAll("-", "").slice(0, 16)}`,
  });
  await prisma.orm.public.Posts.create({
    content: "Local media delivery verification",
    id: postId,
    userId,
  });
  for (const [index, id] of ids.entries()) {
    const video = index === 1;
    const key = `media/${id}/original.${video ? "mp4" : "jpg"}`;
    storageKeys.add(key);
    const file = Bun.file(`${sourceDir}/source.${video ? "mp4" : "jpg"}`);
    await getS3().write(key, file);
    await prisma.orm.public.PostMedia.create({
      _type: video ? "VIDEO" : "IMAGE",
      aiGenerated: !video,
      id,
      key,
      mimeType: video ? "video/mp4" : "image/jpeg",
      ...(index < 2 ? { postId } : {}),
      publishedKey: key,
      size: file.size,
      status: "READY",
      url: "",
      userId,
    });
    if (index < 2) {
      await processMedia({ mediaId: id });
    }
    if (index === 0) {
      const post = await getPostDataQuery(prisma.orm, userId)
        .where({ id: postId })
        .first();
      assert.ok(post);
      assert.equal(
        mapPostData(post).attachments[0]?.aiGenerated,
        true,
        "AI label must survive feed serialization"
      );
    }
  }
  const imageUrl = `${origin}/api/media/${ids[0]}/v/lg-webp.webp?d=4`;
  const modern = await fetch(imageUrl, {
    headers: { Accept: "image/avif,image/webp" },
  });
  assert.equal(modern.status, 200);
  assert.equal(modern.headers.get("content-type"), "image/avif");
  assert.ok(
    modern.headers
      .get("vary")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "accept")
  );
  const modernBytes = await modern.arrayBuffer();
  const notModified = await fetch(imageUrl, {
    headers: {
      Accept: "image/avif",
      "If-None-Match": modern.headers.get("etag") ?? "",
    },
  });
  assert.equal(notModified.status, 304);
  const notModifiedBody = await notModified.arrayBuffer();
  assert.equal(notModifiedBody.byteLength, 0);
  const compatible = await fetch(imageUrl, {
    headers: { Accept: "image/webp" },
  });
  assert.equal(compatible.status, 200);
  await compatible.arrayBuffer();
  const denied = await fetch(`${origin}/api/media/${ids[2]}/v/md-webp.webp`);
  assert.ok([401, 403, 404].includes(denied.status));
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
  const videoUrl = `${origin}/api/media/${ids[1]}/v/mp4-h264.mp4?d=4`;
  const range = await fetch(videoUrl, { headers: { Range: "bytes=0-1023" } });
  assert.equal(range.status, 206);
  const rangeBody = await range.arrayBuffer();
  assert.equal(rangeBody.byteLength, 1024);
  const masterUrl = `${origin}/api/media/${ids[1]}/v/hls/master.m3u8?d=4`;
  const master = await fetch(masterUrl);
  assert.equal(master.status, 200);
  const masterText = await master.text();
  const variantName = masterText
    .split("\n")
    .find((line) => line.endsWith(".m3u8") || line.includes(".m3u8?g="));
  assert.ok(variantName);
  assert.ok(variantName.includes("?g=v4."));
  const variantUrl = new URL(variantName, masterUrl);
  const variant = await fetch(variantUrl);
  assert.equal(variant.status, 200);
  const playlist = await variant.text();
  const segment = playlist.split("\n").find((line) => line.includes(".m4s?g="));
  assert.ok(segment);
  const segmentResponse = await fetch(new URL(segment, variantUrl));
  assert.equal(segmentResponse.status, 200);
  await segmentResponse.arrayBuffer();
  results.modernMime = modern.headers.get("content-type");
  results.modernBytes = modernBytes.byteLength;
  results.compatibleMime = compatible.headers.get("content-type");
  results.notModifiedStatus = notModified.status;
  results.rangeStatus = range.status;
  results.privateDenied = denied.status;
  results.hlsGenerationPinned = true;
  const manifest = { imageUrl, masterUrl, postId, videoUrl, ...results };
  await Bun.write(
    `${artifactDir}/fixture.json`,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  if (process.env.ASM_MEDIA_BROWSER_WAIT === "1") {
    console.log("Browser fixtures ready");
    const deadline = Date.now() + 180_000;
    while (
      Date.now() < deadline &&
      !(await Bun.file(`${artifactDir}/browser-done`).exists())
    ) {
      await Bun.sleep(500);
    }
  }
  console.log(JSON.stringify(results));
} finally {
  for (const id of ids) {
    const objects = await getS3().list({
      maxKeys: 1000,
      prefix: `derived/v4/${id}/`,
    });
    for (const object of objects.contents ?? []) {
      storageKeys.add(object.key);
    }
    await prisma.orm.public.PostMedia.where({ id }).deleteAndCount();
  }
  await prisma.orm.public.Posts.where({ id: postId }).deleteAndCount();
  await prisma.orm.public.Users.where({ id: userId }).deleteAndCount();
  await Promise.allSettled([...storageKeys].map((key) => getS3().delete(key)));
  await closePrisma();
  await closeQueueConnections();
}
