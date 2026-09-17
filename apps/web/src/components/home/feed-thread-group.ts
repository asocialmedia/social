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

  // Track the original feed position (priority/recency) of each post
  const postIndex = new Map<string, number>();
  for (let i = 0; i < posts.length; i += 1) {
    const post = posts[i];
    if (post && !postIndex.has(post.id)) {
      postIndex.set(post.id, i);
    }
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

  // Compute the minimum feed index (freshest activity / highest recency)
  // in the subtree rooted at each post. When a parent has multiple children,
  // this ensures it follows the branch that caused the thread to bump.
  const visiting = new Set<string>();
  const subtreeMinIndex = new Map<string, number>();
  const getSubtreeMinIndex = (postId: string): number => {
    const cached = subtreeMinIndex.get(postId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(postId)) {
      return postIndex.get(postId) ?? Infinity;
    }
    visiting.add(postId);
    let min = postIndex.get(postId) ?? Infinity;
    const children = childrenOf.get(postId);
    if (children) {
      for (const child of children) {
        const childMin = getSubtreeMinIndex(child.id);
        if (childMin < min) {
          min = childMin;
        }
      }
    }
    visiting.delete(postId);
    subtreeMinIndex.set(postId, min);
    return min;
  };

  // Sort siblings so the branch with the freshest activity (lowest feed index)
  // is traversed first when building chains.
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => {
      const rankA = getSubtreeMinIndex(a.id);
      const rankB = getSubtreeMinIndex(b.id);
      if (rankA !== rankB) {
        return rankA - rankB;
      }
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

  // 3. Twitter-style thread bumping: order groups by the earliest feed index
  // (most recent activity) of any post in that group. The posts inside each
  // group remain chronological [Parent, Child, Grandchild] top-to-bottom.
  groups.sort((a, b) => {
    const minA = Math.min(
      ...a.posts.map((p) => postIndex.get(p.id) ?? Infinity)
    );
    const minB = Math.min(
      ...b.posts.map((p) => postIndex.get(p.id) ?? Infinity)
    );
    return minA - minB;
  });

  return groups;
}
