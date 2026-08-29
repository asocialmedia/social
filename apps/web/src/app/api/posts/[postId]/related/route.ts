import { getPostDataInclude, hydrateViewCounts, prisma } from "@asm/db";
import { NextResponse } from "next/server";

import { getSessionFromApi } from "@/lib/session";

function cosineSimilarity(a: number[], b: number[]): number {
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

  // 1. Fetch origin post semantic features
  const originPost = await prisma.post.findUnique({
    select: {
      attachments: {
        select: {
          semanticTags: true,
        },
      },
      embedding: true,
      id: true,
      isGust: true,
      semanticTags: true,
    },
    where: { id: postId },
  });

  if (!originPost) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Aggregate tags from post and its attachments
  const allTags = new Set<string>([
    ...originPost.semanticTags,
    ...originPost.attachments.flatMap((a) => a.semanticTags),
  ]);
  const tagList = [...allTags];

  const take = 10;

  // 2. Fetch candidates matching semantic tags or recent relevant posts
  let candidates = await prisma.post.findMany({
    include: getPostDataInclude(userId),
    orderBy: { createdAt: "desc" },
    take: 30,
    where: {
      id: { not: postId },
      moderated: false,
      ...(tagList.length > 0
        ? {
            OR: [
              { semanticTags: { hasSome: tagList } },
              {
                attachments: {
                  some: {
                    semanticTags: { hasSome: tagList },
                  },
                },
              },
            ],
          }
        : {}),
    },
  });

  // If not enough tagged candidates, fill with recent active posts
  if (candidates.length < take) {
    const fallbackPosts = await prisma.post.findMany({
      include: getPostDataInclude(userId),
      orderBy: { createdAt: "desc" },
      take: take - candidates.length,
      where: {
        id: {
          notIn: [postId, ...candidates.map((c) => c.id)],
        },
        moderated: false,
      },
    });
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
        ...candidate.semanticTags,
        ...candidate.attachments.flatMap((a) => a.semanticTags),
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

  const topPosts = scored.slice(0, take).map((s) => s.candidate);
  const hydratedPosts = await hydrateViewCounts(topPosts);

  return NextResponse.json({
    posts: hydratedPosts,
  });
}
