// oxlint-disable-next-line typescript/triple-slash-reference -- Consumers typecheck workspace sources without including this package's ambient declarations.
/// <reference path="../sql.d.ts" />
import { and } from "@prisma/orm-postgres/orm-client";

import sessionLimitSql from "../sql/session-limit.sql" with { type: "text" };
import { toPrismaDateTime } from "./dates";
import { rawQuery } from "./messages/infrastructure/raw-sql";
import { readSqlBundle } from "./messages/infrastructure/sql-template";
import prisma from "./prisma";
import { publishSessionRevocation } from "./redis";

const {
  enforceAccountSessionLimit: { lockUser },
} = readSqlBundle(sessionLimitSql, {
  enforceAccountSessionLimit: ["lockUser"],
} as const);

export const ACCOUNT_SESSION_LIMIT = 3;

export async function enforceAccountSessionLimit(
  userId: string
): Promise<string[]> {
  const revokedIds = await prisma.transaction(async (transaction) => {
    // Serialize pruning across auth instances and concurrent sign-ins for this account.
    await rawQuery<{ id: string }>(
      lockUser,
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
