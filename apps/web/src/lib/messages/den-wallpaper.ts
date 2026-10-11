import {
  and,
  canManageDen,
  prisma,
  publishMessageEvent,
  scheduleMediaCleanup,
} from "@asm/db";

interface WallpaperPrefs {
  wallpaperKey?: string | null;
  wallpaperDim?: number | null;
  wallpaperMediaId?: string | null;
}

export function canManageDenWallpaper(
  conversation: {
    type: string;
    members: readonly {
      userId: string;
      role?: string | null;
      leftAt?: unknown;
    }[];
  },
  userId: string
) {
  return (
    conversation.type !== "DEN" ||
    conversation.members.some(
      (member) =>
        member.userId === userId &&
        !member.leftAt &&
        canManageDen(member.role ?? "")
    )
  );
}

export async function updateDenWallpaper(
  conversationId: string,
  userId: string,
  data: WallpaperPrefs
) {
  const result = await prisma.transaction(async (tx) => {
    const previous = await tx.orm.public.MessageConversations.select(
      "wallpaperMediaId"
    )
      .where({ id: conversationId })
      .first();
    // Recheck the actor's active role in the write itself, including after a
    // concurrent removal or demotion since the route's initial membership read.
    const updated = await tx.orm.public.MessageConversations.where((row) =>
      and(
        row.id.eq(conversationId),
        row._type.eq("DEN"),
        row.messageConversationMembers.some((member) =>
          and(
            member.userId.eq(userId),
            member.leftAt.isNull(),
            member.role.in(["OWNER", "ADMIN"])
          )
        )
      )
    )
      .select("wallpaperKey", "wallpaperDim", "wallpaperMediaId")
      .update(data);
    return { previous, updated };
  });
  if (!result.updated) {
    return null;
  }
  if (
    result.previous?.wallpaperMediaId &&
    result.previous.wallpaperMediaId !== result.updated.wallpaperMediaId
  ) {
    try {
      await scheduleMediaCleanup(result.previous.wallpaperMediaId);
    } catch (error) {
      console.error("Failed to schedule den wallpaper cleanup:", error);
    }
  }
  await publishMessageEvent({
    conversationId,
    kind: "conversation.appearance.changed",
    userId,
  });
  return result.updated;
}
