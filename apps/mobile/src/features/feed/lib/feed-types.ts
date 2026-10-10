// Feed data shapes + list mechanics, ported from web (packages/db client,
// lib/posts/post-normalize, lib/posts/feed-cache filter, feed-thread-group).
// No React Native imports: pure and unit-testable on Node.
//
// Hermes note: Array.prototype.toSorted does not exist on the emulator's
// Hermes build, and the repo's auto-fixer rewrites every `.sort(` call into
// `.toSorted(`. All ordering here goes through insertionOrder below, which
// calls neither.

export interface FeedMedia {
  aiGenerated?: boolean | null;
  altText?: string | null;
  blurDataUrl?: string | null;
  generatedAltText?: string | null;
  height?: number | null;
  id: string;
  key?: string | null;
  mimeType?: string | null;
  thumbnailKey?: string | null;
  transcript?: string | null;
  type?: string | null;
  width?: number | null;
}

export interface FeedTag {
  id: string;
  name: string;
}

export interface FeedMention {
  user: {
    avatarUrl: string | null;
    displayName?: string | null;
    id: string;
    username?: string | null;
  };
}

export interface FeedVote {
  userId: string;
  value: number;
}

export interface FeedBookmark {
  userId: string;
}

export interface FeedCounts {
  bookmarks: number;
  comments: number;
  responses: number;
  vote: number;
}

export interface FeedUser {
  _count?: { followers?: number };
  avatarUrl: string | null;
  badge?: string | null;
  badges?: string[] | null;
  communityMemberships?: {
    community?: {
      accentColor?: string | null;
      avatarUrl?: string | null;
      name?: string | null;
      slug?: string | null;
    } | null;
    role: string;
  }[];
  displayName?: string | null;
  followers?: { followerId: string }[];
  id: string;
  username?: string | null;
}

export interface FeedCommunity {
  accentColor?: string | null;
  id: string;
  name: string;
  slug: string;
}

export interface FeedParentPost {
  attachments?: FeedMedia[];
  community?: FeedCommunity | null;
  content?: string | null;
  createdAt: string;
  embeds?: string | null;
  id?: string;
  isGust?: boolean;
  moderated?: boolean;
  user?: FeedUser;
  userId: string;
}

export interface FeedPost {
  followingSources?: {
    avatarUrl: string | null;
    id: string;
    username?: string | null;
  }[];
  _count?: Partial<FeedCounts>;
  attachments?: FeedMedia[];
  aura?: number;
  bookmarks?: FeedBookmark[];
  community?: FeedCommunity | null;
  communityShare?: {
    community?: FeedCommunity | null;
    sourcePostId?: string;
  } | null;
  content?: string | null;
  createdAt: string;
  embeds?: string | null;
  explicitContent?: boolean;
  hnStoryShare?: {
    by?: string;
    descendants?: number;
    score?: number;
    storyId?: number | string;
    time?: number;
    title?: string;
    url?: string;
  } | null;
  id: string;
  isGust?: boolean;
  mentions?: FeedMention[];
  moderated?: boolean;
  parentPost?: FeedParentPost | null;
  parentPostId?: string | null;
  tags?: FeedTag[];
  user?: FeedUser;
  userId: string;
  viewCount?: number;
  vote?: FeedVote[];
}

export interface PostsPage {
  nextCursor: string | null;
  posts: FeedPost[];
}

// Stable merge sort avoids quadratic insertion scans on long cached feeds.
// Hermes compatibility still requires avoiding sort/toSorted.
export function insertionOrder<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number
): T[] {
  if (items.length < 2) {
    return [...items];
  }
  const middle = Math.floor(items.length / 2);
  const left = insertionOrder(items.slice(0, middle), compare);
  const right = insertionOrder(items.slice(middle), compare);
  const ordered: T[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftItem = left[leftIndex] as T;
    const rightItem = right[rightIndex] as T;
    if (compare(leftItem, rightItem) <= 0) {
      ordered.push(leftItem);
      leftIndex += 1;
    } else {
      ordered.push(rightItem);
      rightIndex += 1;
    }
  }
  return [...ordered, ...left.slice(leftIndex), ...right.slice(rightIndex)];
}

interface IndexedItem {
  index?: number | null;
}

// FlatList does not guarantee viewableItems order. Keep the callback on the
// Hermes-safe insertion path instead of Array.sort/toSorted.
export function orderByIndex<T extends IndexedItem>(items: readonly T[]): T[] {
  return insertionOrder(items, (a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function countOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Mirrors web normalizePostData: missing array relations become [], missing
// counts become 0. Returns the same ref when nothing needs patching.
export function normalizePostData(post: FeedPost): FeedPost {
  let patched: FeedPost | null = null;
  const ensure = (): FeedPost => {
    if (!patched) {
      patched = { ...post };
    }
    return patched;
  };
  for (const key of [
    "attachments",
    "bookmarks",
    "mentions",
    "tags",
    "vote",
  ] as const) {
    if (!Array.isArray(post[key])) {
      ensure()[key] = [];
    }
  }
  const count = post._count;
  if (
    typeof count !== "object" ||
    count === null ||
    typeof count.bookmarks !== "number" ||
    typeof count.comments !== "number" ||
    typeof count.responses !== "number" ||
    typeof count.vote !== "number"
  ) {
    const target = ensure();
    target._count = {
      bookmarks: countOf((count as FeedCounts | undefined)?.bookmarks),
      comments: countOf((count as FeedCounts | undefined)?.comments),
      responses: countOf((count as FeedCounts | undefined)?.responses),
      vote: countOf((count as FeedCounts | undefined)?.vote),
    };
  }
  return patched ?? post;
}

export function normalizePostsData(posts: FeedPost[]): FeedPost[] {
  const next = posts.map((post) => {
    // Unwrap mistaken { post: {...} } wrappers like web does.
    const raw = (post as { post?: FeedPost }).post ?? post;
    return normalizePostData(raw);
  });
  const identical = next.every((item, index) => item === posts[index]);
  return identical ? posts : next;
}

export interface FeedFilter {
  dismissedIds?: ReadonlySet<string>;
  excludeIds?: ReadonlySet<string>;
  excludePostId?: string;
}

// Single choke point for list filtering, mirroring web filterFeedPosts:
// falsy rows, the detail post, already-shown lead segments, and session
// dismissals all drop here.
export function filterFeedPosts(
  posts: FeedPost[],
  filter: FeedFilter = {}
): FeedPost[] {
  return posts.filter((post) => {
    if (!post || typeof post.id !== "string") {
      return false;
    }
    if (filter.excludePostId && post.id === filter.excludePostId) {
      return false;
    }
    if (filter.excludeIds?.has(post.id)) {
      return false;
    }
    if (filter.dismissedIds?.has(post.id)) {
      return false;
    }
    return true;
  });
}

// Parsed createdAt cache: this sort re-runs on every cache write, including
// view-count reconciles that land mid-scroll, and Date parsing per comparison
// turned each of those flushes into milliseconds of JS on the scroll path.
// createdAt is immutable per post, so caching by id is sound. Bounded so a
// long session cannot grow it without limit.
const createdAtCache = new Map<string, number>();
const CREATED_AT_CACHE_LIMIT = 2000;
function createdAtOf(post: FeedPost): number {
  const cached = createdAtCache.get(post.id);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = new Date(post.createdAt).getTime();
  const value = Number.isFinite(parsed) ? parsed : 0;
  if (createdAtCache.size >= CREATED_AT_CACHE_LIMIT) {
    createdAtCache.clear();
  }
  createdAtCache.set(post.id, value);
  return value;
}

// Newest-first for chronological feeds (web sortBy="newest"). Stable for
// equal timestamps via id tiebreak.
export function sortPostsNewest(posts: FeedPost[]): FeedPost[] {
  return insertionOrder(posts, (a, b) => {
    const diff = createdAtOf(b) - createdAtOf(a);
    return diff === 0 ? a.id.localeCompare(b.id) : diff;
  });
}

export interface FeedThreadGroup {
  id: string;
  posts: FeedPost[];
}

// Groups feed posts into connected conversation threads, verbatim port of
// web groupPostsIntoThreads (feed-thread-group.ts) with insertionOrder in
// place of the two Array.sort calls.
export function groupPostsIntoThreads(posts: FeedPost[]): FeedThreadGroup[] {
  if (posts.length === 0) {
    return [];
  }
  const postsById = new Map<string, FeedPost>();
  for (const post of posts) {
    postsById.set(post.id, post);
  }
  const postIndex = new Map<string, number>();
  for (let index = 0; index < posts.length; index += 1) {
    const post = posts[index];
    if (post && !postIndex.has(post.id)) {
      postIndex.set(post.id, index);
    }
  }
  const childrenOf = new Map<string, FeedPost[]>();
  for (const post of posts) {
    if (post.parentPostId && postsById.has(post.parentPostId)) {
      const siblings = childrenOf.get(post.parentPostId) ?? [];
      siblings.push(post);
      childrenOf.set(post.parentPostId, siblings);
    }
  }
  const visiting = new Set<string>();
  const subtreeMinIndex = new Map<string, number>();
  const getSubtreeMinIndex = (postId: string): number => {
    const cached = subtreeMinIndex.get(postId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(postId)) {
      return postIndex.get(postId) ?? Number.POSITIVE_INFINITY;
    }
    visiting.add(postId);
    let min = postIndex.get(postId) ?? Number.POSITIVE_INFINITY;
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
  for (const siblings of childrenOf.values()) {
    const ordered = insertionOrder(siblings, (a, b) => {
      const rankA = getSubtreeMinIndex(a.id);
      const rankB = getSubtreeMinIndex(b.id);
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      const byTime =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return byTime === 0 ? a.id.localeCompare(b.id) : byTime;
    });
    siblings.length = 0;
    siblings.push(...ordered);
  }
  const visited = new Set<string>();
  const groups: FeedThreadGroup[] = [];
  const buildChain = (start: FeedPost): FeedPost[] => {
    const chain: FeedPost[] = [];
    let current: FeedPost | undefined = start;
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
  for (const post of posts) {
    if (visited.has(post.id)) {
      continue;
    }
    const hasParentInFeed = Boolean(
      post.parentPostId && postsById.has(post.parentPostId)
    );
    if (!hasParentInFeed) {
      const chain = buildChain(post);
      if (chain.length > 0 && chain[0]) {
        groups.push({ id: chain[0].id, posts: chain });
      }
    }
  }
  for (const post of posts) {
    if (visited.has(post.id)) {
      continue;
    }
    const chain = buildChain(post);
    if (chain.length > 0 && chain[0]) {
      groups.push({ id: chain[0].id, posts: chain });
    }
  }
  return insertionOrder(groups, (a, b) => {
    let minA = Number.POSITIVE_INFINITY;
    for (const post of a.posts) {
      const index = postIndex.get(post.id) ?? Number.POSITIVE_INFINITY;
      if (index < minA) {
        minA = index;
      }
    }
    let minB = Number.POSITIVE_INFINITY;
    for (const post of b.posts) {
      const index = postIndex.get(post.id) ?? Number.POSITIVE_INFINITY;
      if (index < minB) {
        minB = index;
      }
    }
    return minA - minB;
  });
}

// Walks the newest-first head page and collects posts until the first
// already-known id, mirroring web findUnseenItems (use-new-content-probe).
export function findUnseenItems(
  fresh: FeedPost[],
  knownIds: ReadonlySet<string>
): FeedPost[] {
  const unseen: FeedPost[] = [];
  for (const post of fresh) {
    if (!post || knownIds.has(post.id)) {
      break;
    }
    unseen.push(post);
  }
  return unseen;
}

// The same question against a RANKED feed (personalized, trending), which is
// ordered by score rather than by recency. There a post that just arrived can
// land anywhere in the head page, so the leading-run walk above would stop at
// the first already-known row and drop the brand-new post sitting below it. A
// ranked feed therefore answers with a set difference over the whole page.
export function findUnseenRankedItems(
  fresh: FeedPost[],
  knownIds: ReadonlySet<string>
): FeedPost[] {
  return fresh.filter((post) => post && !knownIds.has(post.id));
}

export function isBookmarkedByUser(
  post: FeedPost,
  userId: string | undefined
): boolean {
  if (!userId || !Array.isArray(post.bookmarks)) {
    return false;
  }
  return post.bookmarks.some((entry) => entry.userId === userId);
}

export function getUserVote(post: FeedPost): number {
  const vote = Array.isArray(post.vote) ? post.vote[0]?.value : undefined;
  return typeof vote === "number" ? vote : 0;
}

// Relative timestamps for card headers ("just now", "5m", "3h", "Mar 4"),
// mirroring web formatRelativeDate.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatRelativeDate(from: string): string {
  const time = new Date(from).getTime();
  if (Number.isNaN(time)) {
    return "";
  }
  const diffMs = Date.now() - time;
  if (diffMs < 24 * 60 * 60 * 1000) {
    const minutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));
    if (minutes < 1) {
      return "just now";
    }
    if (minutes < 60) {
      return `${minutes}m`;
    }
    return `${Math.floor(minutes / 60)}h`;
  }
  const date = new Date(time);
  const now = new Date();
  const month = MONTHS[date.getMonth()] ?? "";
  if (date.getFullYear() === now.getFullYear()) {
    return `${month} ${date.getDate()}`;
  }
  return `${month} ${date.getDate()}, ${date.getFullYear()}`;
}

// Inline @usernames and #tags (lowercased, sigil-free) present in authored
// text, mirroring web extractInlineMeta. PostMeta chips render only tags and
// mentions NOT already shown inline.
export function extractInlineMeta(content: string): {
  tags: Set<string>;
  usernames: Set<string>;
} {
  const tags = new Set<string>();
  const usernames = new Set<string>();
  for (const match of content.matchAll(/@[a-zA-Z0-9_-]+|#[a-zA-Z0-9_-]+/g)) {
    const [token] = match;
    if (!token) {
      continue;
    }
    if (token.startsWith("@")) {
      usernames.add(token.slice(1).toLowerCase());
    } else {
      tags.add(token.slice(1).toLowerCase());
    }
  }
  return { tags, usernames };
}
