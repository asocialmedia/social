import type { PostData } from "@asm/db";

export interface ResponseNode {
  children: ResponseNode[];
  depth: number;
  response: PostData;
}

// Nesting deeper than this renders flat (no further indentation) so deep
// threads never push content into a thin sliver on mobile. Mirrors the eddies
// renderer.
export const MAX_RESPONSE_DEPTH = 6;

// Builds a thread from a flat list of response posts linked by parentPostId.
// Direct responses (parent is the anchor post, not in the set) are the roots
// and sort newest-first, matching the responses API pagination; replies within
// a branch sort oldest-first so the conversation reads top to bottom.
export function buildResponseTree(responses: PostData[]): ResponseNode[] {
  const byId = new Map<string, PostData>();
  for (const response of responses) {
    byId.set(response.id, response);
  }

  const childrenOf = new Map<string, PostData[]>();
  const roots: PostData[] = [];

  for (const response of responses) {
    if (response.parentPostId && byId.has(response.parentPostId)) {
      const siblings = childrenOf.get(response.parentPostId) ?? [];
      siblings.push(response);
      childrenOf.set(response.parentPostId, siblings);
    } else {
      roots.push(response);
    }
  }

  roots.sort((a, b) => {
    const byTime = b.createdAt.getTime() - a.createdAt.getTime();
    return byTime === 0 ? b.id.localeCompare(a.id) : byTime;
  });

  const build = (response: PostData, depth: number): ResponseNode => {
    const rawChildren = childrenOf.get(response.id) ?? [];
    rawChildren.sort((a, b) => {
      const byTime = a.createdAt.getTime() - b.createdAt.getTime();
      return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
    });

    return {
      children: rawChildren.map((child) => build(child, depth + 1)),
      depth,
      response,
    };
  };

  return roots.map((root) => build(root, 0));
}

// Finds a response anywhere in the tree by id. Used by a response permalink to
// render only that response's subtree from the thread it was fetched within.
export function findResponseNode(
  tree: ResponseNode[],
  id: string
): ResponseNode | null {
  for (const node of tree) {
    if (node.response.id === id) {
      return node;
    }
    const found = findResponseNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

// Folds the realtime/optimistic live store over the server-fetched pages,
// mirroring mergeCommentsWithLive. Server wins for a response that also exists
// in the live store.
export function mergeResponsesWithLive(
  serverResponses: PostData[],
  live: Map<string, PostData>
): PostData[] {
  const byId = new Map<string, PostData>();
  for (const response of serverResponses) {
    byId.set(response.id, response);
  }
  for (const response of live.values()) {
    if (!byId.has(response.id)) {
      byId.set(response.id, response);
    }
  }
  return [...byId.values()];
}
