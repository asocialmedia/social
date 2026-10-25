import { afterAll, expect, test } from "bun:test";

import { prisma } from "@asm/db";

import { findStickerLibraryEntry } from "./sticker-library";

const userId = `sticker-membership-${crypto.randomUUID()}`;
const mediaIds: string[] = [];
afterAll(async () => {
  for (const id of mediaIds) {
    // oxlint-disable-next-line no-await-in-loop -- Delete each fixture before its owning user.
    await prisma.orm.public.PostMedia.where({ id }).delete();
  }
  await prisma.orm.public.Users.where({ id: userId }).delete();
});

test("matches canonical and saved copies by origin, scopes to owner, and reflects removal", async () => {
  await prisma.orm.public.Users.create({
    displayName: "Sticker membership test",
    email: `${userId}@example.test`,
    id: userId,
    username: userId,
  });
  const original = crypto.randomUUID();
  const copy = crypto.randomUUID();
  for (const id of [original, copy]) {
    // oxlint-disable-next-line no-await-in-loop -- Fixtures exercise both origin and copied media.
    await prisma.orm.public.PostMedia.create({
      _type: "IMAGE",
      id,
      key: `fixture/${id}`,
      mimeType: "image/webp",
      originalName: "sticker.webp",
      size: 1000,
      status: "READY",
      stickerSource: true,
      techMetadata: id === copy ? { stickerOriginMediaId: original } : {},
      url: "",
      userId,
      visibility: "PRIVATE",
    });
    mediaIds.push(id);
  }
  const saved = await prisma.orm.public.UserStickers.create({
    animated: false,
    byteSize: 1000,
    favorite: true,
    mediaId: original,
    name: "Original",
    userId,
  });
  const delivery = {
    id: crypto.randomUUID(),
    techMetadata: { stickerOriginMediaId: original },
  };
  expect(await findStickerLibraryEntry(userId, delivery)).toEqual({
    favorite: true,
    id: saved.id,
  });
  expect(await findStickerLibraryEntry("another-viewer", delivery)).toBeNull();
  await prisma.orm.public.UserStickers.where({ id: saved.id }).delete();
  expect(await findStickerLibraryEntry(userId, delivery)).toBeNull();
  const copied = await prisma.orm.public.UserStickers.create({
    animated: false,
    byteSize: 1000,
    favorite: false,
    mediaId: copy,
    name: "Saved copy",
    userId,
  });
  expect(await findStickerLibraryEntry(userId, delivery)).toEqual({
    favorite: false,
    id: copied.id,
  });
  await prisma.orm.public.UserStickers.where({ id: copied.id }).update({
    favorite: true,
  });
  expect(await findStickerLibraryEntry(userId, delivery)).toEqual({
    favorite: true,
    id: copied.id,
  });
});
