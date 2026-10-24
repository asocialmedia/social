import {
  getUserDataQuery,
  mapUserData,
  networkSql,
  prisma,
  rawQuery,
  fromPrismaDateTime,
} from "@asm/db";
import {
  matchesAvoidedTopic,
  networkInterestScore,
  networkInterestTerms,
  scopedNetworkPreferences,
} from "@asm/protocols/discovery";

import type { NetworkFeedContext } from "@/lib/recommendations/network-context";

export async function networkSuggestedUsers(
  userId: string,
  limit: number,
  context: NetworkFeedContext
) {
  const terms = networkInterestTerms(
    context.selected.interests,
    context.topicScope
  );
  const result = await rawQuery<{ id: string; matches: number }>(
    networkSql.creators,
    [terms, context.preferences.showExplicitContent, userId],
    { id: "pg/text@1", matches: "pg/float8@1" }
  );
  if (!result.rows.length) {
    return [];
  }
  const ids = result.rows.map((row) => row.id);
  const people = await getUserDataQuery(prisma.orm, userId)
    .where((person) => person.id.in(ids))
    .include("posts", (posts) =>
      posts
        .where((post) => post.communityId.isNull())
        .orderBy((post) => post.createdAt.desc())
        .limit(20)
        .select(
          "content",
          "semanticTags",
          "moderated",
          "explicitContent",
          "createdAt",
          "aura"
        )
    )
    .all();
  const preferences = scopedNetworkPreferences(
    context.preferences,
    context.topicScope
  );
  const scored = people.flatMap((person) => {
    const relevant = person.posts.filter(
      (post) =>
        !post.moderated &&
        (preferences.showExplicitContent || !post.explicitContent) &&
        !matchesAvoidedTopic(
          post.content,
          post.semanticTags ?? [],
          preferences.avoidedTopics
        ) &&
        networkInterestScore(
          post.content,
          post.semanticTags ?? [],
          context.selected.interests,
          context.topicScope
        ) > 0
    );
    if (!relevant.length) {
      return [];
    }
    // Name only the interests this author's posts actually match. Joining every
    // declared interest described a single-subject author as writing about all
    // of them, which is a false statement shown to the reader.
    const matchedInterests = context.selected.interests.filter((interest) =>
      relevant.some(
        (post) =>
          networkInterestScore(
            post.content,
            post.semanticTags ?? [],
            [interest],
            context.topicScope
          ) > 0
      )
    );
    let evidence = 0;
    for (const post of relevant) {
      const ageDays = Math.max(
        0,
        (Date.now() - fromPrismaDateTime(post.createdAt).getTime()) / 86_400_000
      );
      evidence +=
        (1 + Math.min(2, Math.log1p(Math.max(0, post.aura)) / 5)) /
        (1 + ageDays / 30);
    }
    const quality = person.aura < 0 ? 0.4 : 1;
    const { posts: _posts, ...data } = person;
    return [
      {
        ...mapUserData(data),
        _reasons: [
          `Posts about ${(matchedInterests.length
            ? matchedInterests
            : context.selected.interests
          ).join(", ")}`,
        ],
        _score: evidence * quality,
      },
    ];
  });
  scored.sort((a, b) => b._score - a._score || a.id.localeCompare(b.id));
  const users = scored.slice(0, Math.min(12, limit));
  return users;
}
