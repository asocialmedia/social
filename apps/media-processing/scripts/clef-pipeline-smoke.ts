// Uses only isolated local fixtures, the real queue, and the configured Clef API.
import assert from "node:assert/strict";

import { loadRootEnv } from "../src/load-env";

loadRootEnv();
if (
  !["localhost", "127.0.0.1", "::1"].includes(
    new URL(process.env.DATABASE_URL ?? "").hostname
  )
) {
  throw new Error("Clef pipeline smoke requires a local database");
}
const {
  closePrisma,
  closeQueueConnections,
  enqueuePostAnalyze,
  prisma,
  redis,
} = await import("@asm/db");
const userId = crypto.randomUUID();
const postId = crypto.randomUUID();
try {
  await prisma.orm.public.Users.create({
    displayName: "Clef fixture",
    email: `clef-${userId}@example.invalid`,
    id: userId,
    username: `clef_${userId.replaceAll("-", "").slice(0, 16)}`,
  });
  await prisma.orm.public.Posts.create({
    content:
      "This adult pornography post depicts explicit sexual intercourse and exposed genitals.",
    id: postId,
    userId,
  });
  await enqueuePostAnalyze(postId);
  const deadline = Date.now() + 60_000;
  let passed = false;
  while (Date.now() < deadline) {
    const post = await prisma.orm.public.Posts.select(
      "explicitContent",
      "moderated",
      "semanticTags",
      "embedding"
    )
      .where({ id: postId })
      .first();
    if (post?.explicitContent) {
      assert.equal(post.moderated, false);
      assert.ok((post.embedding?.length ?? 0) > 0);
      console.log(
        JSON.stringify({
          explicit: true,
          moderated: false,
          postAnalysisQueue: "passed",
        })
      );
      passed = true;
      break;
    }
    await Bun.sleep(500);
  }
  assert.equal(passed, true, "Worker did not finish the post analysis");
} finally {
  await prisma.orm.public.Posts.where({ id: postId }).deleteAndCount();
  await prisma.orm.public.Users.where({ id: userId }).deleteAndCount();
  await redis.del(`media:clef:post:${postId}`);
  await closeQueueConnections();
  await closePrisma();
  redis.disconnect();
}
