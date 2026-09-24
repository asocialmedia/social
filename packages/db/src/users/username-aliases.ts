import { and } from "@prisma/orm-postgres/orm-client";

import prisma, { toPrismaDateTime } from "../prisma";

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

function exactInsensitivePattern(value: string): string {
  return value.replaceAll(/[\\%_]/g, "\\$&");
}

export async function resolveUsername(
  username: string,
  now = new Date()
): Promise<ResolvedUsername | null> {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    return null;
  }

  const currentUser = await prisma.orm.public.Users.select("id", "username")
    .where((user) =>
      user.username.ilike(exactInsensitivePattern(normalizedUsername))
    )
    .first();
  if (currentUser) {
    return { ...currentUser, isAlias: false };
  }

  const alias = await prisma.orm.public.UsernameAliases.include(
    "user",
    (user) => user.select("id", "username")
  )
    .where((candidate) =>
      and(
        candidate.expiresAt.gt(toPrismaDateTime(now)),
        candidate.username.ilike(exactInsensitivePattern(normalizedUsername))
      )
    )
    .first();
  if (!alias?.user) {
    return null;
  }
  return { ...alias.user, isAlias: true };
}
