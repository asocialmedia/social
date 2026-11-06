import { readSqlBundle as readExtractedSqlBundle } from "@asm/db/sql-template";

// oxlint-disable-next-line typescript/triple-slash-reference -- Workspace consumers also need the SQL text module declaration.
/// <reference path="../../sql.d.ts" />
import extractedSqlSource from "../../sql/communities/chat-inbox-lifecycle.sql" with { type: "text" };
import { rawQuery } from "../messages/infrastructure/raw-sql";
import { getJoinedCommunities } from "./service";

const { extracted: extractedSql } = readExtractedSqlBundle(extractedSqlSource, {
  extracted: ["statement1"],
} as const);

// One aggregate read for the viewer, independent of community population.
// No room contents, private-thread metadata, or recipient rosters leave this query.
export async function getCommunityChatInbox(userId: string) {
  if (!userId) {
    return [];
  }
  const [communities, activity] = await Promise.all([
    getJoinedCommunities(userId),
    rawQuery<{ communityId: string; hasUnread: boolean }>(
      extractedSql.statement1,
      [userId],
      { communityId: "pg/text@1", hasUnread: "pg/bool@1" }
    ),
  ]);
  const unreadByCommunity = new Map(
    activity.rows.map((row) => [row.communityId, row.hasUnread])
  );
  return communities.flatMap((community) =>
    unreadByCommunity.has(community.id)
      ? [{ community, hasUnread: unreadByCommunity.get(community.id) ?? false }]
      : []
  );
}
