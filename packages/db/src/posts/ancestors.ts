import { and } from "@prisma/orm-postgres/orm-client";

import { getPostDataQuery, mapPostData } from "../client";
import type { PostData } from "../client";
import { communityVisibilityWhere } from "../communities/visibility";
import prisma from "../prisma";
import { hydrateViewCounts } from "../redis";

const MAX_ANCESTOR_DEPTH = 20;

export interface AncestorStore {
  findAncestorIds: (initialParentId: string) => Promise<string[]>;
  findParentId: (postId: string) => Promise<string | null>;
  findPosts: (ids: string[], loggedInUserId: string) => Promise<PostData[]>;
}

async function collectAncestorIds(
  initialParentId: string,
  store: AncestorStore
): Promise<string[]> {
  const ancestorIds: string[] = [];
  const visited = new Set<string>();

  async function visit(currentId: string | null): Promise<void> {
    if (
      !currentId ||
      ancestorIds.length >= MAX_ANCESTOR_DEPTH ||
      visited.has(currentId)
    ) {
      return;
    }
    visited.add(currentId);
    ancestorIds.push(currentId);
    await visit(await store.findParentId(currentId));
  }

  await visit(initialParentId);
  return ancestorIds.toReversed();
}

export async function getPostAncestorsWithStore(
  initialParentId: string,
  loggedInUserId: string,
  store: AncestorStore
): Promise<PostData[]> {
  if (!initialParentId) {
    return [];
  }

  try {
    const ids = await store.findAncestorIds(initialParentId);
    if (ids.length === 0) {
      return [];
    }
    const posts = await store.findPosts(ids, loggedInUserId);
    const postMap = new Map(posts.map((post) => [post.id, post]));
    const ordered = ids
      .map((id) => postMap.get(id))
      .filter((post): post is PostData => Boolean(post));
    return hydrateViewCounts(ordered);
  } catch (error) {
    console.warn("Failed to fetch ancestors, retrying sequentially:", error);
    const ancestorIds = await collectAncestorIds(initialParentId, store);
    if (ancestorIds.length === 0) {
      return [];
    }
    const posts = await store.findPosts(ancestorIds, loggedInUserId);
    const postMap = new Map(posts.map((post) => [post.id, post]));
    const ordered = ancestorIds
      .toReversed()
      .map((id) => postMap.get(id))
      .filter((post): post is PostData => Boolean(post));
    return hydrateViewCounts(ordered);
  }
}

function createAncestorStore(): AncestorStore {
  const store: AncestorStore = {
    findAncestorIds(initialParentId) {
      return collectAncestorIds(initialParentId, store);
    },
    async findParentId(postId) {
      const ancestor = await prisma.orm.public.Posts.select("parentPostId")
        .where({ id: postId })
        .first();
      return ancestor?.parentPostId ?? null;
    },
    async findPosts(ids, loggedInUserId) {
      const records = await getPostDataQuery(prisma.orm, loggedInUserId)
        .where((post) =>
          and(post.id.in(ids), communityVisibilityWhere(loggedInUserId)(post))
        )
        .all();
      return records.map(mapPostData);
    },
  };
  return store;
}

export function getPostAncestors(
  initialParentId: string,
  loggedInUserId: string
): Promise<PostData[]> {
  return getPostAncestorsWithStore(
    initialParentId,
    loggedInUserId,
    createAncestorStore()
  );
}
