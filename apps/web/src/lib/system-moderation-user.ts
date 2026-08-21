import { prisma, SYSTEM_MODERATION_USER_ID } from "@asm/db";

// System moderation account. Notifications about moderated or explicit-flagged
// posts are issued by this neutral platform persona ("Zeph") instead of the
// acting moderator, so an admin/author's real name and avatar are never
// exposed to the person being moderated. The account is hidden from profile
// and discovery surfaces (see SYSTEM_MODERATION_USER_ID exclusions).
const MODERATION_SYSTEM_USER = {
  avatarUrl: "/avatars/avatar-placeholder.png",
  displayName: "Zeph",
  email: "zeph@asocialmedia.cc",
  id: SYSTEM_MODERATION_USER_ID,
  username: "zeph",
} as const;

let cachedUserId: string | null = null;

// Idempotent: upserts by the fixed id so repeated calls never duplicate the
// account. The username stays unique, so the display name carries the persona.
export async function getModerationSystemUserId(): Promise<string> {
  if (cachedUserId) {
    return cachedUserId;
  }

  const user = await prisma.user.upsert({
    create: {
      ...MODERATION_SYSTEM_USER,
      emailVerified: false,
      role: "user",
    },
    update: {
      avatarUrl: MODERATION_SYSTEM_USER.avatarUrl,
      displayName: MODERATION_SYSTEM_USER.displayName,
    },
    where: { id: MODERATION_SYSTEM_USER.id },
  });

  cachedUserId = user.id;
  return user.id;
}
