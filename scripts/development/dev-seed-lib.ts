// Builds a complete, self-consistent dev content graph: users, communities,
// posts and responses, comments (eddies) and their replies, votes, bookmarks,
// follows, mentions, tags, visits, and the aura ledger those interactions
// imply. Pure - it touches no database, reads no clock and owns no randomness
// beyond the seeded Rng it is handed, so the same config always produces an
// identical plan and the whole thing is unit testable.
//
// Two rules shape everything here:
//
//  1. Aura is derived, never invented. Posts, comments and users do not get
//     hand-written aura totals; the interactions generate AuraLogs and the
//     aggregates are reduced from those logs, so a profile's aura always
//     equals the history shown next to it.
//  2. Every foreign key is satisfied by construction and every unique
//     constraint the schema declares is respected - unique usernames and
//     slugs, one row per (user, post) vote, no self follows, no duplicate
//     mentions. A seeder that trips a unique index halfway through leaves the
//     database in a worse state than an empty one.
//
// Ids are all prefixed `seed-`, which is what lets `--fresh` delete exactly
// this corpus and nothing else. The column is text, not uuid, so the prefix
// survives as a readable marker the cleanup can filter on.

import {
  generateBio,
  generateCommunityDescription,
  generateCommunityName,
  generateCommentText,
  generateDisplayName,
  generateFleetContent,
  generateGustCaption,
  generateHandleBase,
  generateTagName,
} from "./dev-seed-text";
import type { Rng } from "./dev-seed-text";

export type { Rng };

export const SEED_ID_PREFIX = "seed";

export function isSeedId(id: string): boolean {
  return id.startsWith(`${SEED_ID_PREFIX}-`);
}

// mulberry32: small, fast, and identical across runs, which is the only
// property that matters for a reproducible seeder.
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    chance: (probability) => next() < probability,
    int: (minInclusive, maxExclusive) =>
      minInclusive + Math.floor(next() * (maxExclusive - minInclusive)),
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) {
        throw new Error("pick() called with an empty list");
      }
      return item;
    },
  };
}

// Stable, readable, and unique within the plan because the index is part of
// the id: seed-user-0, seed-user-1, ...
function seedId(kind: string, index: number): string {
  return `${SEED_ID_PREFIX}-${kind}-${index}`;
}

export interface SeedConfig {
  bookmarks: number;
  commentReplies: number;
  commentVotes: number;
  comments: number;
  communities: number;
  communityMembers: number;
  communityPostShares: number;
  communitySubscriptions: number;
  follows: number;
  gusts: number;
  mentions: number;
  postTags: number;
  postVisits: number;
  posts: number;
  responses: number;
  seed: number;
  tags: number;
  users: number;
  votes: number;
  // How far back the newest content reaches. Everything is spread across this
  // window with a bias toward recent, so Latest looks alive and Trending has a
  // recency curve to divide by.
  windowDays: number;
}

// A working dev corpus: enough rows that every feed tab, community page and
// profile has something in it without the seeder taking minutes. Every count is
// a CLI flag, and the aura ledger derived from these interactions lands on top
// (roughly another nine thousand rows), so the real total is well north of ten
// thousand.
export const DEFAULT_SEED_CONFIG: SeedConfig = {
  bookmarks: 350,
  commentReplies: 400,
  commentVotes: 200,
  comments: 1200,
  communities: 24,
  communityMembers: 400,
  communityPostShares: 80,
  communitySubscriptions: 200,
  follows: 700,
  // Off by default: a gust without a real uploaded video renders as an empty
  // tile, which looks worse than having no gusts at all. Pass --gusts=N once
  // there is media to attach.
  gusts: 0,
  mentions: 300,
  postTags: 600,
  postVisits: 250,
  posts: 1800,
  responses: 700,
  seed: 20_260_926,
  tags: 60,
  users: 250,
  votes: 900,
  windowDays: 45,
};

export function resolveSeedConfig(
  overrides: Partial<SeedConfig> = {}
): SeedConfig {
  const resolved = { ...DEFAULT_SEED_CONFIG, ...overrides };
  // A negative count would silently become "insert nothing" and a fractional
  // one would truncate at the worst possible moment, so both are floored once
  // here instead of being defended against at every use site.
  const floored: SeedConfig = {
    ...resolved,
    windowDays: Math.max(1, Math.floor(resolved.windowDays)),
  };
  for (const key of Object.keys(resolved) as (keyof SeedConfig)[]) {
    if (key === "seed" || key === "windowDays") {
      continue;
    }
    floored[key] = Math.max(0, Math.floor(resolved[key]));
  }
  return floored;
}

// Community topic keys, mirroring COMMUNITY_TOPICS in @asm/db. Duplicated
// rather than imported so this module stays dependency free and unit testable
// without booting a database client; they only ever feed dev data.
const COMMUNITY_TOPIC_KEYS = [
  "anime",
  "art",
  "business",
  "education",
  "food",
  "games",
  "health",
  "home",
  "internet",
  "music",
  "nature",
  "news",
  "places",
  "reading",
  "sciences",
  "sports",
  "technology",
  "wellness",
] as const;

const COMMUNITY_ACCENTS = [
  "clay",
  "denim",
  "ember",
  "iris",
  "moss",
  "ocean",
  "pine",
  "plum",
  "rose",
  "sand",
  "slate",
  "stone",
] as const;

// Community nameMax / slugMax from COMMUNITY_LIMITS.
const COMMUNITY_NAME_MAX = 21;
const COMMUNITY_DESCRIPTION_MAX = 500;
const SLUG_MAX = 21;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Aura amounts per interaction, roughly in line with what the real ledger pays
// out so the numbers a seeded profile shows are plausible.
const AURA = {
  bookmarkReceived: 2,
  commentCreated: 3,
  commentReceived: 4,
  commentVote: 2,
  communityCreated: 50,
  communityJoin: 5,
  communityJoinOwner: 10,
  followGained: 1,
  followGiven: 1,
  mentionReceived: 3,
  postCreated: 5,
  postVote: 1,
} as const;

export type AuraType =
  | "COMMENT_CREATION"
  | "COMMENT_RECEIVED"
  | "COMMENT_VOTE"
  | "COMMUNITY_CREATED"
  | "COMMUNITY_JOIN"
  | "COMMUNITY_JOIN_OWNER"
  | "FOLLOW_GAINED"
  | "FOLLOW_GIVEN"
  | "MENTION_RECEIVED"
  | "POST_BOOKMARK_RECEIVED"
  | "POST_CREATION"
  | "POST_VOTE";

export interface SeedUser {
  aura: number;
  bio: string;
  createdAt: Date;
  displayName: string;
  id: string;
  username: string;
}

export interface SeedTag {
  createdAt: Date;
  id: string;
  name: string;
}

export interface SeedCommunity {
  accentColor: string;
  createdAt: Date;
  description: string;
  id: string;
  mature: boolean;
  name: string;
  ownerId: string;
  slug: string;
  topics: string[];
  type: string;
}

export interface SeedPost {
  aura: number;
  communityId: string | null;
  content: string;
  createdAt: Date;
  id: string;
  isGust: boolean;
  parentPostId: string | null;
  rootPostId: string | null;
  threadTopId: string | null;
  userId: string;
  viewCount: number;
}

export interface SeedComment {
  aura: number;
  content: string;
  createdAt: Date;
  creationAura: number;
  id: string;
  parentId: string | null;
  postId: string;
  postReceivedAura: number;
  receivedAura: number;
  rootId: string | null;
  userId: string;
}

export interface SeedAuraLog {
  amount: number;
  commentId: string | null;
  createdAt: Date;
  id: string;
  issuerId: string;
  postId: string | null;
  type: AuraType;
  userId: string;
}

export interface SeedVote {
  createdAt: Date;
  postId: string;
  userId: string;
  value: number;
}

export interface SeedCommentVote {
  commentId: string;
  createdAt: Date;
  userId: string;
  value: number;
}

export interface SeedBookmark {
  createdAt: Date;
  id: string;
  postId: string;
  userId: string;
}

export interface SeedFollow {
  followerId: string;
  followingId: string;
}

export interface SeedMention {
  createdAt: Date;
  id: string;
  postId: string;
  userId: string;
}

export interface SeedPostTag {
  postId: string;
  tagId: string;
}

export interface SeedPostVisit {
  createdAt: Date;
  id: string;
  postId: string;
  userId: string;
}

export interface SeedCommunityMember {
  communityId: string;
  createdAt: Date;
  id: string;
  role: string;
  status: string;
  userId: string;
}

export interface SeedCommunitySubscription {
  communityId: string;
  createdAt: Date;
  id: string;
  userId: string;
}

export interface SeedCommunityPostShare {
  communityId: string;
  createdAt: Date;
  id: string;
  postId: string;
  sourcePostId: string;
}

export interface SeedPlan {
  auraLogs: SeedAuraLog[];
  bookmarks: SeedBookmark[];
  commentReplies: SeedComment[];
  commentVotes: SeedCommentVote[];
  comments: SeedComment[];
  communities: SeedCommunity[];
  communityMembers: SeedCommunityMember[];
  communityPostShares: SeedCommunityPostShare[];
  communitySubscriptions: SeedCommunitySubscription[];
  config: SeedConfig;
  follows: SeedFollow[];
  gusts: SeedPost[];
  mentions: SeedMention[];
  postTags: SeedPostTag[];
  postVisits: SeedPostVisit[];
  posts: SeedPost[];
  responses: SeedPost[];
  tags: SeedTag[];
  users: SeedUser[];
  votes: SeedVote[];
}

// Every row in the plan, for the summary line and the tests.
export function countPlanRows(plan: SeedPlan): number {
  return (
    plan.users.length +
    plan.tags.length +
    plan.communities.length +
    plan.communityMembers.length +
    plan.communitySubscriptions.length +
    plan.posts.length +
    plan.responses.length +
    plan.gusts.length +
    plan.comments.length +
    plan.commentReplies.length +
    plan.votes.length +
    plan.commentVotes.length +
    plan.bookmarks.length +
    plan.follows.length +
    plan.mentions.length +
    plan.postTags.length +
    plan.postVisits.length +
    plan.communityPostShares.length +
    plan.auraLogs.length
  );
}

// Skews toward low indices, which is how a few accounts end up looking
// genuinely popular: the same curve picks followers, follow targets and post
// authors, so the people everyone follows are also the people who post most.
function skewedIndex(rng: Rng, count: number): number {
  if (count <= 0) {
    return 0;
  }
  const unit = rng.int(0, 10_000) / 10_000;
  return Math.min(count - 1, Math.floor(unit * unit * count));
}

// How sharply the corpus thins out with age. Above 1 the newest rows crowd
// together and the tail stretches out; 1 would be a perfectly even posting
// rate. 1.35 puts roughly the last two hours of activity on the first page
// while still reaching back the full window.
const RECENCY_EXPONENT = 1.35;

// How far behind the clock the newest row is placed, so replies and eddies have
// somewhere to go. Twenty minutes is short enough that the feed still looks
// live and long enough for a comment to fit after the newest fleet.
const SETTLE_MS = 20 * 60_000;

// A strictly decreasing run of timestamps ending at `now`, newest first, with a
// guaranteed minimum gap between neighbours.
//
// Independent random draws are not good enough here. A recency-skewed draw
// packs the newest few dozen posts into the same handful of seconds, which
// looks nothing like a real feed and - worse - hands the paginator a page of
// rows that share a createdAt, so a cursor on that value can skip or repeat
// them. Placing row i at `window * (i / n) ^ RECENCY_EXPONENT` instead gives a
// dense head and a thin tail by construction, and the floor plus the clamp
// guarantee a strictly ordered, never bunched sequence.
function buildTimeline(
  rng: Rng,
  count: number,
  now: Date,
  windowMs: number,
  minGapMs: number
): Date[] {
  if (count <= 0) {
    return [];
  }
  const floor = Math.max(1, minGapMs);
  // The newest row stops a little short of now. Everything derived from a post
  // - a response, an eddie - has to be published *after* it, so a timeline
  // whose head is the present instant leaves the very first page with nothing
  // to attach anything to.
  const anchor = now.getTime() - SETTLE_MS;
  const stamps: Date[] = [];
  let previous = anchor;
  for (let index = 0; index < count; index++) {
    const age = windowMs * (index / count) ** RECENCY_EXPONENT;
    // A little jitter so the cadence is not metronomic, kept under half the
    // floor so it can never reorder the run.
    const jitter = rng.int(0, Math.max(1, Math.floor(floor / 2)));
    let stamp = anchor - age + jitter;
    if (stamp >= previous) {
      stamp = previous - floor;
    }
    stamps.push(new Date(stamp));
    previous = stamp;
  }
  return stamps;
}

// Draws `limit` unique (a, b) index pairs. Each side is drawn independently
// from its own population - one is usually the user list and the other a
// target list of a different length (posts, comments, communities), so a
// single shared size would either run off the end of the shorter list or
// silently restrict the longer one to its first few entries.
//
// `isValid` rejects pairs the schema would refuse (a self follow, a member who
// is already the owner) and `keyOf` is the uniqueness key. Attempts are
// bounded, because a tiny population - two users, no valid pair left - would
// otherwise spin forever.
function distinctPairs(
  rng: Rng,
  countA: number,
  countB: number,
  isValid: (a: number, b: number) => boolean,
  limit: number,
  keyOf: (a: number, b: number) => string
): [number, number][] {
  const pairs: [number, number][] = [];
  const seen = new Set<string>();
  const attempts = Math.max(limit * 12, 32);
  for (let attempt = 0; attempt < attempts && pairs.length < limit; attempt++) {
    const a = skewedIndex(rng, countA);
    const b = skewedIndex(rng, countB);
    if (!isValid(a, b)) {
      continue;
    }
    const key = keyOf(a, b);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    pairs.push([a, b]);
  }
  return pairs;
}

export interface BuildSeedOptions {
  // Handles already taken in the target database, so a seeded username can
  // never collide with a real account and abort the run on a unique index.
  reservedUsernames?: ReadonlySet<string>;
  now?: Date;
}

export function buildSeedPlan(
  overrides: Partial<SeedConfig> = {},
  options: BuildSeedOptions = {}
): SeedPlan {
  const config = resolveSeedConfig(overrides);
  const rng = createRng(config.seed);
  const now = options.now ?? new Date();
  const windowMs = config.windowDays * DAY_MS;
  const reserved = new Set(
    [...(options.reservedUsernames ?? [])].map((name) => name.toLowerCase())
  );

  // A moment in the past, cubed toward the present so the top of Latest is
  // dense and the tail thins out the way a real feed does.
  const pastTime = (): Date => {
    const unit = rng.int(0, 10_000) / 10_000;
    return new Date(now.getTime() - Math.floor(unit * unit * unit * windowMs));
  };

  const users: SeedUser[] = [];
  const usedHandles = new Set(reserved);
  for (let index = 0; index < config.users; index++) {
    const base = generateHandleBase(rng);
    // The numeric suffix makes the handle unique by construction; the loop
    // only has to dodge handles that already exist in the real database.
    let username = `${base}${index}`;
    let bump = 0;
    while (usedHandles.has(username.toLowerCase())) {
      bump += 1;
      username = `${base}${index}v${bump}`;
    }
    usedHandles.add(username.toLowerCase());
    users.push({
      aura: 0,
      bio: generateBio(rng),
      createdAt: pastTime(),
      displayName: generateDisplayName(rng, base),
      id: seedId("user", index),
      username,
    });
  }
  const userCount = users.length;

  const tags: SeedTag[] = [];
  const usedTagNames = new Set<string>();
  for (let index = 0; index < config.tags; index++) {
    const base = generateTagName(rng);
    // Tag names come from a fixed vocabulary, so the index only has to appear
    // once the pool starts repeating.
    const name = usedTagNames.has(base) ? `${base}${index}` : base;
    usedTagNames.add(name);
    tags.push({ createdAt: pastTime(), id: seedId("tag", index), name });
  }

  const followPairs = distinctPairs(
    rng,
    userCount,
    userCount,
    (a, b) => a !== b,
    config.follows,
    (a, b) => `${a}:${b}`
  );
  const follows: SeedFollow[] = followPairs.map(([a, b]) => ({
    followerId: users[a]?.id ?? "",
    followingId: users[b]?.id ?? "",
  }));

  // Communities need a unique name and a unique slug, and the slug pattern is
  // /^[a-z0-9_]+$/ - no hyphens - so the space is dropped rather than
  // replaced. Name and slug limits come from COMMUNITY_LIMITS.
  const communities: SeedCommunity[] = [];
  const usedCommunityNames = new Set<string>();
  for (let index = 0; index < config.communities && userCount > 0; index++) {
    const base = generateCommunityName(rng);
    const name = usedCommunityNames.has(base)
      ? `${base} ${index + 1}`.slice(0, COMMUNITY_NAME_MAX)
      : base;
    usedCommunityNames.add(name);
    const topics: string[] = [];
    for (let t = 0; t < rng.int(1, 4); t++) {
      const topic = rng.pick(COMMUNITY_TOPIC_KEYS);
      if (!topics.includes(topic)) {
        topics.push(topic);
      }
    }
    communities.push({
      accentColor: rng.pick(COMMUNITY_ACCENTS),
      createdAt: pastTime(),
      description: generateCommunityDescription(rng, name).slice(
        0,
        COMMUNITY_DESCRIPTION_MAX
      ),
      id: seedId("community", index),
      // A mature flag on a public community is the one moderation-adjacent bit
      // of state worth having in dev data, so a couple carry it.
      mature: rng.chance(0.2),
      name,
      ownerId: users[skewedIndex(rng, userCount)]?.id ?? "",
      slug: name.toLowerCase().replaceAll(" ", "").slice(0, SLUG_MAX),
      topics,
      type: rng.chance(0.75) ? "PUBLIC" : rng.pick(["RESTRICTED", "PRIVATE"]),
    });
  }

  // Mentions and tags are capped by config, and the cap is enforced by
  // withholding the pool from the text generator rather than by dropping rows
  // afterwards: a body that says "@someone" must always have the Mentions row
  // behind it, or the renderer links to nobody.
  const mentions: SeedMention[] = [];
  const postTags: SeedPostTag[] = [];
  const tagNames = tags.map((tag) => tag.name);
  const allUsernames = users.map((user) => user.username);
  const userByUsername = new Map(
    users.map((user) => [user.username, user] as const)
  );
  const tagByName = new Map(tags.map((tag) => [tag.name, tag] as const));

  const composePost = (
    postIndex: number,
    authorId: string,
    createdAt: Date,
    overrides: Partial<SeedPost> = {}
  ): SeedPost => {
    // Never let a post mention its own author: that Mentions row would be a
    // self-mention, which the app treats as a real notification.
    const mentionable = allUsernames.filter(
      (username) => userByUsername.get(username)?.id !== authorId
    );
    const generated = generateFleetContent(rng, {
      handles: mentions.length < config.mentions ? mentionable : [],
      tags: postTags.length < config.postTags ? tagNames : [],
    });
    const post: SeedPost = {
      aura: 0,
      communityId: null,
      content: generated.content,
      createdAt,
      id: seedId("post", postIndex),
      isGust: false,
      parentPostId: null,
      rootPostId: null,
      threadTopId: null,
      userId: authorId,
      viewCount: rng.int(0, 4_000),
      ...overrides,
    };
    for (const handle of generated.mentionHandles) {
      const mentioned = userByUsername.get(handle);
      if (mentioned && mentioned.id !== authorId) {
        mentions.push({
          createdAt,
          id: seedId("mention", mentions.length),
          postId: post.id,
          userId: mentioned.id,
        });
      }
    }
    for (const name of generated.tagNames) {
      const tag = tagByName.get(name);
      if (tag && postTags.length < config.postTags) {
        postTags.push({ postId: post.id, tagId: tag.id });
      }
    }
    return post;
  };

  // Fleets. The feed only ever returns rows with rootPostId null, so responses
  // hang off these rather than surfacing on their own.
  //
  // Every fleet-shaped row - a plain fleet or a community share - is laid on
  // one shared timeline, because the feed paginates on createdAt: the sequence
  // has to be strictly ordered and free of ties, and deriving a share's time
  // from the post it was shared from cannot promise either. Community shares
  // take a spread of the newer slots so a community page is not all reshares
  // from one afternoon, and always share something older than themselves.
  const rootPosts: SeedPost[] = [];
  const communityPosts: SeedPost[] = [];
  const communityPostShares: SeedCommunityPostShare[] = [];
  const shareCount =
    communities.length > 0 && userCount > 0 ? config.communityPostShares : 0;
  const feedTimes = buildTimeline(
    rng,
    config.posts + shareCount,
    now,
    windowMs,
    // A floor of four minutes between rows: dense enough that the first page is
    // full, sparse enough that no two land on the same second.
    4 * 60_000
  );
  const shareSlots = new Set<number>();
  for (let k = 0; k < shareCount; k++) {
    shareSlots.add(
      Math.floor((k * feedTimes.length * 0.6) / Math.max(1, shareCount))
    );
  }
  for (let slot = 0; slot < feedTimes.length && userCount > 0; slot++) {
    const author = users[skewedIndex(rng, userCount)];
    const createdAt = feedTimes[slot];
    if (!author || !createdAt) {
      continue;
    }
    if (!shareSlots.has(slot)) {
      rootPosts.push(composePost(rootPosts.length, author.id, createdAt));
      continue;
    }
    // Slot 0 is the newest, so a higher index is an older fleet to share from.
    const sourceIndex = rng.int(
      Math.min(slot + 1, feedTimes.length - 1),
      feedTimes.length
    );
    const community = communities[rng.int(0, communities.length)];
    if (!community) {
      rootPosts.push(composePost(rootPosts.length, author.id, createdAt));
      continue;
    }
    const shared = composePost(
      config.posts + communityPostShares.length,
      author.id,
      createdAt,
      { communityId: community.id }
    );
    communityPosts.push(shared);
    communityPostShares.push({
      communityId: community.id,
      createdAt,
      id: seedId("share", communityPostShares.length),
      postId: shared.id,
      // A share always points back at a fleet that already exists, which is
      // always an earlier (older) slot.
      sourcePostId: seedId("post", sourceIndex),
    });
  }

  const gusts: SeedPost[] = [];
  const gustTimes = buildTimeline(rng, config.gusts, now, windowMs, 6 * 60_000);
  for (let index = 0; index < config.gusts && userCount > 0; index++) {
    const author = users[skewedIndex(rng, userCount)];
    const createdAt = gustTimes[index];
    if (!author || !createdAt) {
      continue;
    }
    gusts.push({
      aura: 0,
      communityId: null,
      content: generateGustCaption(rng),
      createdAt,
      id: seedId("gust", index),
      isGust: true,
      parentPostId: null,
      rootPostId: null,
      threadTopId: null,
      userId: author.id,
      viewCount: rng.int(500, 20_000),
    });
  }

  // A response is a post with parentPostId *and* rootPostId set, which is what
  // the feed's thread grouping keys on and what keeps the reply out of the
  // top-level results. threadTopId mirrors the root so a thread view can find
  // its top without walking.
  const responses: SeedPost[] = [];
  const allHosts = rootPosts.length > 0 ? rootPosts : gusts;
  // Responses are aimed at the recent half of the feed and land minutes to a
  // few hours behind their host. The feed pages by createdAt, so a reply hours
  // later would sit on the *next* page, where the client - which only groups a
  // child with a parent that arrived in the same page - would drop it and the
  // thread would render as a lone post.
  const responseHosts = allHosts
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, Math.max(1, Math.ceil(allHosts.length / 2)));
  for (
    let index = 0;
    index < config.responses && responseHosts.length > 0;
    index++
  ) {
    const host = responseHosts[rng.int(0, responseHosts.length)];
    if (!host) {
      continue;
    }
    // The gap has to stay inside the feed's local spacing. Roots near the head
    // sit a few minutes apart, so a reply an hour later is hundreds of
    // positions down the feed - far from the parent the client needs it
    // alongside - and it surfaces as a row whose parent is not on the page.
    // The minute offset is derived from the loop index, and the seconds are
    // drawn, so no two responses can share a createdAt: two hosts a few
    // minutes apart would otherwise produce replies on the same minute, and a
    // tie in the feed is a row a createdAt cursor can skip.
    const createdAt = new Date(
      host.createdAt.getTime() +
        60_000 * (2 + (index % 74)) +
        rng.int(0, 60_000)
    );
    // A response can never predate what it answers, and one due after the seed
    // run is not written at all: clamping it to the same cutoff second would
    // collapse many responses onto one timestamp and break cursor paging.
    if (
      createdAt.getTime() <= host.createdAt.getTime() ||
      createdAt.getTime() >= now.getTime() - 60_000
    ) {
      continue;
    }
    responses.push({
      aura: 0,
      communityId: null,
      content: generateCommentText(rng, false),
      createdAt,
      id: seedId("response", index),
      isGust: false,
      parentPostId: host.id,
      rootPostId: host.isGust ? null : host.id,
      threadTopId: host.isGust ? null : host.id,
      userId: users[skewedIndex(rng, userCount)]?.id ?? host.userId,
      viewCount: rng.int(0, 400),
    });
  }

  const allPosts = [...rootPosts, ...communityPosts, ...gusts];
  // Responses are posts too: they earn creation aura, and a comment on one
  // still has to find its author, so the ledger works over every post row.
  const auraPosts = [...allPosts, ...responses];

  // Eddies. A top level comment is a row with parentId and rootId null; a
  // reply carries both, with rootId pointing at the top of the thread rather
  // than at its own parent. They land on the same recent half of the feed the
  // responses do, so the first page a signed-in user opens already has
  // discussion on it instead of a wall of silent posts.
  const commentTargets = responseHosts;
  const comments: SeedComment[] = [];
  for (
    let index = 0;
    index < config.comments && commentTargets.length > 0;
    index++
  ) {
    const post = commentTargets[rng.int(0, commentTargets.length)];
    const author = users[skewedIndex(rng, userCount)];
    if (!post || !author) {
      continue;
    }
    // Same rule as responses: a comment due after the run is skipped rather
    // than clamped, so a burst of them cannot land on one shared timestamp.
    // Minutes, not hours: a comment on one of the newest fleets has to land
    // inside the seed run's own window, and a fleet posted an hour ago cannot
    // host a comment six hours from now. People also do tend to reply straight
    // away, so the short gap is also the realistic one.
    const createdAt = new Date(
      post.createdAt.getTime() + 60_000 * rng.int(2, 200)
    );
    if (createdAt.getTime() >= now.getTime() - 30_000) {
      continue;
    }
    comments.push({
      aura: 0,
      content: generateCommentText(rng, false),
      createdAt,
      creationAura: 0,
      id: seedId("comment", index),
      parentId: null,
      postId: post.id,
      postReceivedAura: 0,
      receivedAura: 0,
      rootId: null,
      userId: author.id,
    });
  }

  const commentReplies: SeedComment[] = [];
  for (
    let index = 0;
    index < config.commentReplies && comments.length > 0;
    index++
  ) {
    const parent = comments[rng.int(0, comments.length)];
    const author = users[skewedIndex(rng, userCount)];
    if (!parent || !author) {
      continue;
    }
    const createdAt = new Date(
      parent.createdAt.getTime() + 60_000 * rng.int(2, 200)
    );
    if (createdAt.getTime() >= now.getTime() - 15_000) {
      continue;
    }
    commentReplies.push({
      aura: 0,
      content: generateCommentText(rng, true),
      createdAt,
      creationAura: 0,
      id: seedId("creply", index),
      parentId: parent.id,
      postId: parent.postId,
      postReceivedAura: 0,
      receivedAura: 0,
      // One level of nesting only, so rootId is always the top level comment.
      rootId: parent.rootId ?? parent.id,
      userId: author.id,
    });
  }
  const allComments = [...comments, ...commentReplies];

  // Votes, bookmarks, comment votes and visits are all one row per
  // (user, target) pair, so they come out of the same distinct-pair builder.
  // Votes skew up because the app's vote values are overwhelmingly +1.
  const votable = rootPosts.length > 0 ? rootPosts : gusts;
  // The second index is a post or a comment, not a user, so "is this a valid
  // pair" has to compare the voter against the target's actual author. An
  // index comparison would read as a self interaction only by accident, and
  // would happily let an author vote on their own post.
  const voterIsNotPostAuthor = (
    userIndex: number,
    postIndex: number
  ): boolean => users[userIndex]?.id !== votable[postIndex]?.userId;
  const voterIsNotCommentAuthor = (
    userIndex: number,
    commentIndex: number
  ): boolean => users[userIndex]?.id !== allComments[commentIndex]?.userId;
  const votes: SeedVote[] = distinctPairs(
    rng,
    userCount,
    votable.length,
    voterIsNotPostAuthor,
    config.votes,
    (a, b) => `${a}:${b}`
  ).map(([userIndex, postIndex]) => ({
    createdAt: votable[postIndex]?.createdAt ?? now,
    postId: votable[postIndex]?.id ?? "",
    userId: users[userIndex]?.id ?? "",
    value: rng.chance(0.92) ? 1 : -1,
  }));

  const commentVotes: SeedCommentVote[] = distinctPairs(
    rng,
    userCount,
    allComments.length,
    voterIsNotCommentAuthor,
    config.commentVotes,
    (a, b) => `${a}:${b}`
  ).map(([userIndex, commentIndex]) => ({
    commentId: allComments[commentIndex]?.id ?? "",
    createdAt: allComments[commentIndex]?.createdAt ?? now,
    userId: users[userIndex]?.id ?? "",
    value: 1,
  }));

  const bookmarks: SeedBookmark[] = distinctPairs(
    rng,
    userCount,
    votable.length,
    voterIsNotPostAuthor,
    config.bookmarks,
    (a, b) => `${a}:${b}`
  ).map(([userIndex, postIndex], row) => ({
    createdAt: votable[postIndex]?.createdAt ?? now,
    id: seedId("bookmark", row),
    postId: votable[postIndex]?.id ?? "",
    userId: users[userIndex]?.id ?? "",
  }));

  const postVisits: SeedPostVisit[] = distinctPairs(
    rng,
    userCount,
    votable.length,
    voterIsNotPostAuthor,
    config.postVisits,
    (a, b) => `${a}:${b}`
  ).map(([userIndex, postIndex], row) => ({
    createdAt: votable[postIndex]?.createdAt ?? now,
    id: seedId("visit", row),
    postId: votable[postIndex]?.id ?? "",
    userId: users[userIndex]?.id ?? "",
  }));

  // Community membership and subscriptions, both unique per (community, user).
  // The owner is always a member first, so the member list and the owner never
  // disagree with each other.
  const communityMembers: SeedCommunityMember[] = [];
  for (const community of communities) {
    communityMembers.push({
      communityId: community.id,
      createdAt: community.createdAt,
      id: seedId("member", communityMembers.length),
      role: "OWNER",
      status: "ACTIVE",
      userId: community.ownerId,
    });
  }
  const notCommunityOwner = (
    userIndex: number,
    communityIndex: number
  ): boolean => communities[communityIndex]?.ownerId !== users[userIndex]?.id;
  for (const [userIndex, communityIndex] of distinctPairs(
    rng,
    userCount,
    communities.length,
    notCommunityOwner,
    config.communityMembers,
    (a, b) => `${a}:${b}`
  )) {
    const community = communities[communityIndex];
    const user = users[userIndex];
    if (!community || !user) {
      continue;
    }
    communityMembers.push({
      communityId: community.id,
      createdAt: community.createdAt,
      id: seedId("member", communityMembers.length),
      // A couple of mods per community, the rest plain members; joining a
      // restricted community sometimes leaves the membership pending.
      role: rng.chance(0.08)
        ? "MODERATOR"
        : rng.chance(0.35)
          ? "MEMBER"
          : "PARTICIPANT",
      status:
        community.type === "RESTRICTED" && rng.chance(0.3)
          ? "PENDING"
          : "ACTIVE",
      userId: user.id,
    });
  }
  const communitySubscriptions: SeedCommunitySubscription[] = distinctPairs(
    rng,
    userCount,
    communities.length,
    notCommunityOwner,
    config.communitySubscriptions,
    (a, b) => `${a}:${b}`
  ).map(([userIndex, communityIndex], row) => ({
    communityId: communities[communityIndex]?.id ?? "",
    createdAt: communities[communityIndex]?.createdAt ?? now,
    id: seedId("sub", row),
    userId: users[userIndex]?.id ?? "",
  }));

  // The aura ledger. Every interaction above writes the log rows the real
  // ledger would have written, and the totals on users, posts and comments are
  // reduced from them below - so a seeded profile's aura always equals the sum
  // of its own history instead of being a number invented next to it.
  const auraLogs: SeedAuraLog[] = [];
  const addAura = (log: Omit<SeedAuraLog, "id">): void => {
    auraLogs.push({ ...log, id: seedId("aura", auraLogs.length) });
  };
  const postAuthor = new Map(auraPosts.map((post) => [post.id, post.userId]));
  const postById = new Map(auraPosts.map((post) => [post.id, post]));

  for (const post of auraPosts) {
    addAura({
      amount: AURA.postCreated,
      commentId: null,
      createdAt: post.createdAt,
      issuerId: post.userId,
      postId: post.id,
      type: "POST_CREATION",
      userId: post.userId,
    });
  }
  for (const vote of votes) {
    const author = postAuthor.get(vote.postId);
    if (!author || vote.value < 0) {
      continue;
    }
    addAura({
      amount: AURA.postVote,
      commentId: null,
      createdAt: vote.createdAt,
      issuerId: vote.userId,
      postId: vote.postId,
      type: "POST_VOTE",
      userId: author,
    });
  }
  for (const bookmark of bookmarks) {
    const author = postAuthor.get(bookmark.postId);
    if (!author) {
      continue;
    }
    addAura({
      amount: AURA.bookmarkReceived,
      commentId: null,
      createdAt: bookmark.createdAt,
      issuerId: bookmark.userId,
      postId: bookmark.postId,
      type: "POST_BOOKMARK_RECEIVED",
      userId: author,
    });
  }
  for (const mention of mentions) {
    addAura({
      amount: AURA.mentionReceived,
      commentId: null,
      createdAt: mention.createdAt,
      issuerId: postAuthor.get(mention.postId) ?? mention.userId,
      postId: mention.postId,
      type: "MENTION_RECEIVED",
      userId: mention.userId,
    });
  }
  for (const follow of follows) {
    addAura({
      amount: AURA.followGiven,
      commentId: null,
      createdAt: now,
      issuerId: follow.followerId,
      postId: null,
      type: "FOLLOW_GIVEN",
      userId: follow.followerId,
    });
    addAura({
      amount: AURA.followGained,
      commentId: null,
      createdAt: now,
      issuerId: follow.followerId,
      postId: null,
      type: "FOLLOW_GAINED",
      userId: follow.followingId,
    });
  }
  for (const community of communities) {
    addAura({
      amount: AURA.communityCreated,
      commentId: null,
      createdAt: community.createdAt,
      issuerId: community.ownerId,
      postId: null,
      type: "COMMUNITY_CREATED",
      userId: community.ownerId,
    });
  }
  for (const member of communityMembers) {
    if (member.role === "OWNER") {
      continue;
    }
    addAura({
      amount: AURA.communityJoin,
      commentId: null,
      createdAt: member.createdAt,
      issuerId: member.userId,
      postId: null,
      type: "COMMUNITY_JOIN",
      userId: member.userId,
    });
    const owner = communities.find(
      (community) => community.id === member.communityId
    )?.ownerId;
    if (owner) {
      addAura({
        amount: AURA.communityJoinOwner,
        commentId: null,
        createdAt: member.createdAt,
        issuerId: member.userId,
        postId: null,
        type: "COMMUNITY_JOIN_OWNER",
        userId: owner,
      });
    }
  }
  for (const comment of allComments) {
    addAura({
      amount: AURA.commentCreated,
      commentId: comment.id,
      createdAt: comment.createdAt,
      issuerId: comment.userId,
      postId: null,
      type: "COMMENT_CREATION",
      userId: comment.userId,
    });
    const author = postAuthor.get(comment.postId);
    // A comment on your own post does not pay you for reading it.
    if (author && author !== comment.userId) {
      addAura({
        amount: AURA.commentReceived,
        commentId: comment.id,
        createdAt: comment.createdAt,
        issuerId: comment.userId,
        postId: null,
        type: "COMMENT_RECEIVED",
        userId: author,
      });
    }
  }
  const commentAuthor = new Map(
    allComments.map((comment) => [comment.id, comment.userId] as const)
  );
  for (const vote of commentVotes) {
    const author = commentAuthor.get(vote.commentId);
    if (!author) {
      continue;
    }
    addAura({
      amount: AURA.commentVote,
      commentId: vote.commentId,
      createdAt: vote.createdAt,
      issuerId: vote.userId,
      postId: null,
      type: "COMMENT_VOTE",
      userId: author,
    });
  }

  // Reduce the ledger into the columns the app reads. A user's aura is the sum
  // of every log credited to them; a post's is the sum of the logs attached to
  // it; a comment splits that into what its own author earned (creationAura),
  // what the post's author earned for it (postReceivedAura) and the total it
  // carries (aura / receivedAura).
  const userAura = new Map<string, number>();
  const postAura = new Map<string, number>();
  const commentTotals = new Map<
    string,
    { aura: number; creation: number; postReceived: number; received: number }
  >();
  for (const log of auraLogs) {
    userAura.set(log.userId, (userAura.get(log.userId) ?? 0) + log.amount);
    if (log.postId !== null) {
      postAura.set(log.postId, (postAura.get(log.postId) ?? 0) + log.amount);
    }
    if (log.commentId === null) {
      continue;
    }
    const totals = commentTotals.get(log.commentId) ?? {
      aura: 0,
      creation: 0,
      postReceived: 0,
      received: 0,
    };
    totals.aura += log.amount;
    if (log.type === "COMMENT_CREATION") {
      totals.creation += log.amount;
    }
    if (log.type === "COMMENT_RECEIVED") {
      totals.received += log.amount;
      const postId =
        postById.size > 0
          ? allComments.find((comment) => comment.id === log.commentId)?.postId
          : undefined;
      if (postId !== undefined && postAuthor.get(postId) === log.userId) {
        totals.postReceived += log.amount;
      }
    }
    commentTotals.set(log.commentId, totals);
  }

  for (const user of users) {
    user.aura = userAura.get(user.id) ?? 0;
  }
  for (const post of auraPosts) {
    post.aura = postAura.get(post.id) ?? 0;
  }
  for (const comment of allComments) {
    const totals = commentTotals.get(comment.id);
    comment.aura = totals?.aura ?? 0;
    comment.creationAura = totals?.creation ?? 0;
    comment.receivedAura = totals?.received ?? 0;
    comment.postReceivedAura = totals?.postReceived ?? 0;
  }

  return {
    auraLogs,
    bookmarks,
    commentReplies,
    commentVotes,
    comments,
    communities,
    communityMembers,
    communityPostShares,
    communitySubscriptions,
    config,
    follows,
    gusts,
    mentions,
    // Community shares are ordinary root posts that also carry a communityId,
    // so they belong with the fleets rather than in their own bucket.
    posts: [...rootPosts, ...communityPosts],
    postTags,
    postVisits,
    responses,
    tags,
    users,
    votes,
  };
}
