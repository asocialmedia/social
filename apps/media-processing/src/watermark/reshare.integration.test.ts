import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import { closePrisma, prisma, toPrismaDateTime } from "@asm/db";

import { attributeReshare } from "./reshare";

let userIds: string[] = [];
let postIds: string[] = [];
let mediaIds: string[] = [];
let phash = "";
let expectedOriginal = "";
let expectedResharer = "";
beforeEach(async () => {
  userIds = [crypto.randomUUID(), crypto.randomUUID()];
  postIds = [crypto.randomUUID(), crypto.randomUUID()];
  mediaIds = [crypto.randomUUID(), crypto.randomUUID()];
  phash = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  for (const [index, id] of userIds.entries()) {
    const username = `reshare_${id.replaceAll("-", "").slice(0, 12)}`;
    if (index === 0) {
      expectedOriginal = username;
    } else {
      expectedResharer = username;
    }
    await prisma.orm.public.Users.create({
      displayName: "Display name with spaces",
      email: `${id}@example.invalid`,
      id,
      username,
    });
    const postId = postIds[index];
    const mediaId = mediaIds[index];
    if (!postId || !mediaId) {
      throw new Error("Missing test identity");
    }
    await prisma.orm.public.Posts.create({
      content: "Attribution fixture",
      id: postId,
      userId: id,
    });
    await prisma.orm.public.PostMedia.create({
      _type: "IMAGE",
      createdAt: toPrismaDateTime(
        new Date(Date.now() - (index === 0 ? 180 : 0) * 86_400_000)
      ),
      id: mediaId,
      key: "",
      mimeType: "image/jpeg",
      phash,
      postId,
      publishedKey: `media/${mediaId}/fixture.jpg`,
      size: 1,
      status: "READY",
      uploaderDisplayName: "Display name with spaces",
      uploaderUsername: "outdated_snapshot",
      url: "",
      userId: id,
      visibility: "PUBLIC",
    });
  }
});
afterEach(async () => {
  await prisma.orm.public.PostMedia.where((media) =>
    media.id.in(mediaIds)
  ).deleteAndCount();
  await prisma.orm.public.Posts.where((post) =>
    post.id.in(postIds)
  ).deleteAndCount();
  await prisma.orm.public.Users.where((user) =>
    user.id.in(userIds)
  ).deleteAndCount();
});
afterAll(async () => {
  await closePrisma();
});
describe("public re-upload attribution", () => {
  test("finds an older original and uses current handles rather than display names", async () => {
    const [original, reshared] = mediaIds;
    if (!original || !reshared) {
      throw new Error("Missing media fixture");
    }
    await attributeReshare(reshared, phash, userIds[1] ?? null, original);
    const row = await prisma.orm.public.PostMedia.where({
      id: reshared,
    }).first();
    expect(row?.originalProvenanceId).toBe(original);
    expect(row?.generatedAltText).toBe(
      `originally from @${expectedOriginal} reshared via @${expectedResharer}`
    );
  });
  test("private originals cannot supply a public attribution label", async () => {
    const [original, reshared] = mediaIds;
    if (!original || !reshared) {
      throw new Error("Missing media fixture");
    }
    await prisma.orm.public.PostMedia.where({ id: original }).update({
      visibility: "PRIVATE",
    });
    await attributeReshare(reshared, phash, userIds[1] ?? null, original);
    const row = await prisma.orm.public.PostMedia.where({
      id: reshared,
    }).first();
    expect(row?.originalProvenanceId).toBeNull();
    expect(row?.generatedAltText).toBeNull();
  });
});
