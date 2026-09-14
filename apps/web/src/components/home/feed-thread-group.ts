import type { PostData } from "@asm/db";

export interface FeedThreadGroup {
  id: string;
  posts: PostData[];
}

// Groups feed posts into connected conversation threads (Twitter-style).
// If posts in the feed are connected via parentPostId, they are assembled
// into a single chronological chain [Parent, Child, Grandchild] instead of
// appearing as duplicate, disjoint 2-node cards.
export function groupPostsIntoThreads(posts: PostData[]): FeedThreadGroup[] {
  if (posts.length === 0) {
    return [];
  }

  const postsById = new Map<string, PostData>();
  for (const post of posts) {
    postsById.set(post.id, post);
  }

  // Map each parent post ID to its children present in this feed slice
  const childrenOf = new Map<string, PostData[]>();
  for (const post of posts) {
    if (post.parentPostId && postsById.has(post.parentPostId)) {
      const siblings = childrenOf.get(post.parentPostId) ?? [];
      siblings.push(post);
      childrenOf.set(post.parentPostId, siblings);
    }
  }

  // Sort siblings by createdAt ascending so threads read top-to-bottom
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => {
      const byTime =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
    });
  }

  const visited = new Set<string>();
  const groups: FeedThreadGroup[] = [];

  // Helper to walk a linear thread chain from a head post
  const buildChain = (start: PostData): PostData[] => {
    const chain: PostData[] = [];
    let current: PostData | undefined = start;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      chain.push(current);

      const children = childrenOf.get(current.id);
      current =
        children && children.length > 0
          ? children.find((child) => !visited.has(child.id))
          : undefined;
    }

    return chain;
  };

  // 1. First pass: find thread heads (posts whose parent is NOT present in this feed)
  // Preserve the relative feed order of heads
  for (const post of posts) {
    if (visited.has(post.id)) {
      continue;
    }

    const hasParentInFeed = Boolean(
      post.parentPostId && postsById.has(post.parentPostId)
    );

    if (!hasParentInFeed) {
      const chain = buildChain(post);
      if (chain.length > 0) {
        groups.push({
          id: chain[0].id,
          posts: chain,
        });
      }
    }
  }

  // 2. Second pass: any remaining unvisited posts (e.g. branch siblings)
  for (const post of posts) {
    if (visited.has(post.id)) {
      continue;
    }

    const chain = buildChain(post);
    if (chain.length > 0) {
      groups.push({
        id: chain[0].id,
        posts: chain,
      });
    }
  }

  return groups;
}
