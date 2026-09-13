import prisma from "../prisma";

export const USERNAME_ALIAS_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const USERNAME_CHANGE_LIMIT = 5;
export const USERNAME_CHANGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface ResolvedUsername {
  id: string;
  isAlias: boolean;
  username: string;
}

export function getUsernameAliasExpiry(now = new Date()): Date {
  return new Date(now.getTime() + USERNAME_ALIAS_RETENTION_MS);
}

export function getUsernameChangeWindowStart(now = new Date()): Date {
  return new Date(now.getTime() - USERNAME_CHANGE_WINDOW_MS);
}

// Returns the active owner of a handle. Current handles always win, which is
// important immediately after an expired alias is claimed by a new account.
export async function resolveUsername(
  username: string,
  now = new Date()
): Promise<ResolvedUsername | null> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    return null;
  }

  const currentUser = await prisma.user.findFirst({
    select: { id: true, username: true },
    where: { username: { equals: normalizedUsername, mode: "insensitive" } },
  });
  if (currentUser) {
    return { ...currentUser, isAlias: false };
  }

  const alias = await prisma.usernameAlias.findFirst({
    select: { user: { select: { id: true, username: true } } },
    where: {
      expiresAt: { gt: now },
      username: { equals: normalizedUsername, mode: "insensitive" },
    },
  });
  if (!alias) {
    return null;
  }
  return { ...alias.user, isAlias: true };
}
