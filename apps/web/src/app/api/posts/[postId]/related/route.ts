import {
  and,
  getPostDataQuery,
  hydrateViewCounts,
  mapPostData,
  prisma,
} from "@asm/db";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/auth/session";

// Exported for test parity: related-ranking.test.ts asserts against this
// exact scorer so the ranking contract cannot silently drift from the math
// the route actually runs.
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let nA = 0;
  let nB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const vA = a[i] ?? 0;
    const vB = b[i] ?? 0;
    dot += vA * vB;
    nA += vA * vA;
    nB += vB * vB;
  }
  if (nA === 0 || nB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ postId: string }> }
): Promise<Response> {
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const { postId } = await context.params;
  if (!postId) {
    return NextResponse.json({ error: "Post ID is required" }, { status: 400 });
  }

  // 1. Fetch origin post semantic features. Moderated origin posts follow
  // the not-found path: their content is hidden everywhere else, so ranking
  // recommendations against them would leak semantic features.
  const originPost = await prisma.orm.public.Posts.select(
    "embedding",
    "id",
    "isGust",
    "semanticTags"
  )
    .include("postMedias", (media) => media.select("semanticTags"))
    .where((post) => and(post.id.eq(postId), post.moderated.eq(false)))
    .first();

  if (!originPost) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Aggregate tags from post and its attachments
  const allTags = new Set<string>([
    ...(originPost.semanticTags ?? []),
    ...originPost.postMedias.flatMap((a) => a.semanticTags ?? []),
  ]);
  const tagList = [...allTags];

  const take = 10;

  // 2. Fetch candidates matching semantic tags or recent relevant posts
  let candidates = await prisma.orm.public.Posts.select(
    "embedding",
    "id",
    "semanticTags"
  )
    .include("postMedias", (media) => media.select("semanticTags"))
    .where((post) =>
      and(
        post.id.neq(postId),
        post.moderated.eq(false),
        post.rootPostId.isNull()
      )
    )
    .orderBy((post) => post.createdAt.desc())
    .limit(30)
    .all();
  if (tagList.length > 0) {
    candidates = candidates.filter((candidate) => {
      const candidateTags = new Set([
        ...(candidate.semanticTags ?? []),
        ...candidate.postMedias.flatMap((media) => media.semanticTags ?? []),
      ]);
      return tagList.some((tag) => candidateTags.has(tag));
    });
  }

  // If not enough tagged candidates, fill with recent active posts
  if (candidates.length < take) {
    const fallbackPosts = await prisma.orm.public.Posts.select(
      "embedding",
      "id",
      "semanticTags"
    )
      .include("postMedias", (media) => media.select("semanticTags"))
      .where((post) =>
        and(
          post.id.notIn([postId, ...candidates.map((c) => c.id)]),
          post.moderated.eq(false),
          post.rootPostId.isNull()
        )
      )
      .orderBy((post) => post.createdAt.desc())
      .limit(take - candidates.length)
      .all();
    candidates = [...candidates, ...fallbackPosts];
  }

  // 3. Score candidates by embedding cosine similarity + tag overlap
  const originEmbedding = Array.isArray(originPost.embedding)
    ? (originPost.embedding as number[])
    : null;

  const scored = candidates.map((candidate) => {
    let score = 0;

    // Embedding similarity
    if (
      originEmbedding &&
      originEmbedding.length > 0 &&
      Array.isArray(candidate.embedding) &&
      (candidate.embedding as number[]).length > 0
    ) {
      const sim = cosineSimilarity(
        originEmbedding,
        candidate.embedding as number[]
      );
      score += sim * 5;
    }

    // Tag overlap bonus
    if (tagList.length > 0) {
      const candidateTags = new Set([
        ...(candidate.semanticTags ?? []),
        ...candidate.postMedias.flatMap((media) => media.semanticTags ?? []),
      ]);
      let overlapCount = 0;
      for (const t of tagList) {
        if (candidateTags.has(t)) {
          overlapCount += 1;
        }
      }
      score += overlapCount * 2;
    }

    return { candidate, score };
  });

  // Sort descending by relevance score
  scored.sort((a, b) => b.score - a.score);

  const rankedIds = scored.slice(0, take).map((entry) => entry.candidate.id);
  const rankedRows = await getPostDataQuery(prisma.orm, userId)
    .where((post) => post.id.in(rankedIds))
    .all();
  const rankedById = new Map(
    rankedRows.map((row) => [row.id, mapPostData(row)])
  );
  const topPosts = rankedIds
    .map((id) => rankedById.get(id))
    .filter((post) => post !== undefined);
  const hydratedPosts = await hydrateViewCounts(topPosts);

  return NextResponse.json({
    posts: hydratedPosts,
  });
}
