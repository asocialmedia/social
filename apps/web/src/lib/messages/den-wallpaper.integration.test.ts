import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { and, prisma, toPrismaDateTime } from "@asm/db";

import { resolveDenWallpaperConversationId } from "@/lib/media/message-media-access";

import { updateDenWallpaper } from "./den-wallpaper";
import { getConversationForUser } from "./server";

// Explicit opt-in: creates isolated fixtures and removes only those fixtures.
test.skipIf(process.env.RUN_DEN_WALLPAPER_INTEGRATION !== "1")(
  "den backgrounds share across members, enforce roles, and leave DM preferences personal",
  async () => {
    const suffix = randomUUID();
    const owner = `owner-${suffix}`;
    const elder = `elder-${suffix}`;
    const member = `member-${suffix}`;
    const newcomer = `newcomer-${suffix}`;
    const ids = [owner, elder, member, newcomer];
    const denId = `den-${suffix}`;
    const dmId = `dm-${suffix}`;
    const mediaId = `media-${suffix}`;
    try {
      await prisma.orm.public.Users.createAll(
        ids.map((id) => ({
          displayName: id,
          email: `${id}@test.local`,
          id,
          username: id,
        }))
      );
      await prisma.orm.public.MessageConversations.create({
        _type: "DEN",
        id: denId,
        name: "Wallpaper integration",
        ownerId: owner,
      });
      await prisma.orm.public.MessageConversations.create({
        _type: "DM",
        id: dmId,
      });
      await prisma.orm.public.MessageConversationMembers.createAll([
        { conversationId: denId, role: "OWNER", userId: owner },
        { conversationId: denId, role: "ADMIN", userId: elder },
        { conversationId: denId, role: "MEMBER", userId: member },
        { conversationId: dmId, userId: owner, wallpaperKey: "personal-dm" },
      ]);
      await prisma.orm.public.PostMedia.create({
        id: mediaId,
        mimeType: "image/png",
        status: "READY",
        url: "https://example.test/wallpaper.png",
        userId: owner,
      });
      expect(
        await updateDenWallpaper(denId, member, { wallpaperKey: "forbidden" })
      ).toBeNull();
      expect(
        await updateDenWallpaper(denId, owner, {
          wallpaperKey: null,
          wallpaperMediaId: mediaId,
        })
      ).toMatchObject({ wallpaperMediaId: mediaId });
      expect(
        await updateDenWallpaper(denId, elder, { wallpaperDim: 45 })
      ).toMatchObject({ wallpaperDim: 45, wallpaperMediaId: mediaId });
      await prisma.orm.public.MessageConversationMembers.create({
        conversationId: denId,
        userId: newcomer,
      });
      await Promise.all(
        ids.map(async (userId) => {
          expect(await getConversationForUser(denId, userId)).toMatchObject({
            wallpaperDim: 45,
            wallpaperMediaId: mediaId,
          });
          expect(await resolveDenWallpaperConversationId(mediaId, userId)).toBe(
            denId
          );
        })
      );
      expect(
        await resolveDenWallpaperConversationId(mediaId, "outsider")
      ).toBeNull();
      await prisma.orm.public.MessageConversationMembers.where((row) =>
        and(row.conversationId.eq(denId), row.userId.eq(elder))
      ).update({ leftAt: toPrismaDateTime(new Date()) });
      expect(
        await updateDenWallpaper(denId, elder, { wallpaperDim: 90 })
      ).toBeNull();
      expect(
        await resolveDenWallpaperConversationId(mediaId, elder)
      ).toBeNull();
      expect(
        await updateDenWallpaper(dmId, owner, { wallpaperKey: "shared-dm" })
      ).toBeNull();
      expect(
        await prisma.orm.public.MessageConversationMembers.select(
          "wallpaperKey"
        )
          .where({ conversationId: dmId, userId: owner })
          .first()
      ).toMatchObject({ wallpaperKey: "personal-dm" });
    } finally {
      await prisma.orm.public.MessageConversations.where((row) =>
        row.id.in([denId, dmId])
      ).delete();
      await prisma.orm.public.PostMedia.where({ id: mediaId }).delete();
      await prisma.orm.public.Users.where((row) => row.id.in(ids)).delete();
    }
  }
);
