import { and } from "@prisma/orm-postgres/orm-client";

import { toPrismaDateTime } from "./dates";
import { rawQuery } from "./messages/infrastructure/raw-sql";
import prisma from "./prisma";
import { publishSessionRevocation } from "./redis";

export const ACCOUNT_SESSION_LIMIT = 4;

export async function enforceAccountSessionLimit(
  userId: string
): Promise<string[]> {
  const revokedIds = await prisma.transaction(async (transaction) => {
    // Serialize pruning across auth instances and concurrent sign-ins for this account.
    await rawQuery<{ id: string }>(
      'SELECT "id" FROM "users" WHERE "id" = $1 FOR UPDATE',
      [userId],
      { id: "pg/text@1" },
      transaction
    );
    const sessions = await transaction.orm.public.Sessions.select("id")
      .where((session) =>
        and(
          session.userId.eq(userId),
          session.expiresAt.gt(toPrismaDateTime(new Date()))
        )
      )
      .orderBy([
        (session) => session.createdAt.desc(),
        (session) => session.id.desc(),
      ])
      .all();
    const ids = sessions
      .slice(ACCOUNT_SESSION_LIMIT)
      .map((session) => session.id);
    if (ids.length > 0) {
      await transaction.orm.public.Sessions.where((session) =>
        and(session.userId.eq(userId), session.id.in(ids))
      ).deleteAndCount();
    }
    return ids;
  });
  await Promise.all(
    revokedIds.map((revokedSessionId) =>
      publishSessionRevocation(userId, { revokedSessionId })
    )
  );
  return revokedIds;
}
