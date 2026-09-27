#!/usr/bin/env bun
// Populates the dev database with a coherent corpus: people, communities,
// fleets, responses, eddies and their replies, plus the votes, bookmarks,
// follows, mentions and aura ledger that make those surfaces look lived in
// rather than empty.
//
//   bun scripts/development/seed-dev-content.ts --fresh
//   bun scripts/development/seed-dev-content.ts --users=400 --posts=3000
//   bun scripts/development/seed-dev-content.ts --dry-run
//
// The plan itself is built by dev-seed-lib (pure, unit tested); this file only
// maps it onto the ORM and writes it. Three things it is careful about:
//
//  - Insert order is foreign-key safe, and so is the delete order. aura_logs
//    is ON DELETE RESTRICT in both directions, so it has to go before users or
//    the cleanup aborts mid-way.
//  - Rows go in through createAndCount in chunks. The contract ORM has no
//    createMany, and a single statement carrying every aura log would blow
//    past Postgres' 65535 bind parameter limit.
//  - Nothing outside the `seed-` id namespace is ever deleted, so --fresh
//    cannot touch a real account, and the run refuses to point at anything
//    that is not a local database.

import {
  SYSTEM_MODERATION_USER_ID,
  closePrisma,
  computeTrendingScore,
  prisma,
  toPrismaDateTime,
} from "@asm/db";

import {
  DEFAULT_SEED_CONFIG,
  SEED_ID_PREFIX,
  buildSeedPlan,
  countPlanRows,
  isSeedId,
} from "./dev-seed-lib";
import type { SeedConfig, SeedPlan } from "./dev-seed-lib";

// Keeps every insert well under Postgres' 65535 bind parameter ceiling: the
// widest table here is aura_logs at ten columns.
const INSERT_CHUNK = 500;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

interface CliOptions {
  allowRemote: boolean;
  config: Partial<SeedConfig>;
  dryRun: boolean;
  fresh: boolean;
  help: boolean;
}

const USAGE = `Seed the dev database with generated content.

Usage
  bun scripts/development/seed-dev-content.ts [options]

Options
  --fresh            Delete any previously seeded rows first (only ids under
                     the seed- prefix are ever removed).
  --dry-run          Build and print the plan without writing anything.
  --allow-remote     Permit a non-local DATABASE_URL.
  --scale=N          Multiply every count by N, rounded down.
  --<field>=N         Override one count, e.g. --posts=3000 --users=400.
                     Fields: ${Object.keys(DEFAULT_SEED_CONFIG)
                       .filter((key) => key !== "seed" && key !== "windowDays")
                       .sort()
                       .join(", ")}
  --seed=N           Rng seed; the same seed reproduces the same corpus.
  --window-days=N    How far back content reaches (default 45).
  -h, --help         Show this message.
`;

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    allowRemote: false,
    config: {},
    dryRun: false,
    fresh: false,
    help: false,
  };
  const scale = { value: 1 };
  for (const arg of argv) {
    if (arg === "--fresh") {
      options.fresh = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--allow-remote") {
      options.allowRemote = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg.startsWith("--scale=")) {
      scale.value = Number(arg.slice("--scale=".length));
    } else if (arg.startsWith("--seed=")) {
      options.config.seed = Number(arg.slice("--seed=".length));
    } else if (arg.startsWith("--window-days=")) {
      options.config.windowDays = Number(arg.slice("--window-days=".length));
    } else if (arg.startsWith("--")) {
      const [flag, raw] = arg.slice(2).split("=");
      if (flag && raw !== undefined && flag in DEFAULT_SEED_CONFIG) {
        options.config[flag as keyof SeedConfig] = Number(raw);
      } else {
        throw new Error(`Unknown option: ${arg}`);
      }
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (Number.isFinite(scale.value) && scale.value !== 1) {
    for (const [key, value] of Object.entries(options.config)) {
      if (key !== "seed" && key !== "windowDays" && typeof value === "number") {
        options.config[key as keyof SeedConfig] = value * scale.value;
      }
    }
    for (const key of Object.keys(DEFAULT_SEED_CONFIG)) {
      if (key === "seed" || key === "windowDays") {
        continue;
      }
      const current = options.config[key as keyof SeedConfig];
      if (typeof current !== "number") {
        const base = DEFAULT_SEED_CONFIG[key as keyof SeedConfig];
        if (typeof base === "number") {
          options.config[key as keyof SeedConfig] = base * scale.value;
        }
      }
    }
  }
  return options;
}

function assertSafeTarget(options: CliOptions): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed with NODE_ENV=production.");
  }
  if (options.allowRemote) {
    return;
  }
  const url = process.env.DATABASE_URL;
  // An unset DATABASE_URL falls back to the local dev database in @asm/db.
  if (!url) {
    return;
  }
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed ${host} - that is not a local database. ` +
        "Point DATABASE_URL at the dev database, or pass --allow-remote."
    );
  }
}

// Chunked so no single statement approaches the bind parameter ceiling.
async function insertChunked<Row>(
  label: string,
  rows: readonly Row[],
  insert: (chunk: Row[]) => Promise<number>
): Promise<number> {
  let inserted = 0;
  const startedAt = Date.now();
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
    inserted += await insert(rows.slice(offset, offset + INSERT_CHUNK));
  }
  const elapsed = Date.now() - startedAt;
  console.log(
    `  ${label.padEnd(26)} ${String(inserted).padStart(7)} rows  ${elapsed}ms`
  );
  return inserted;
}

const SEED_LIKE = "seed-%";

async function deleteSeededRows(): Promise<void> {
  const orm = prisma.orm.public;
  console.log("Removing previously seeded rows...");
  // aura_logs first: its foreign keys to users are ON DELETE RESTRICT, so any
  // other order fails outright. Each column is its own statement because the
  // contract ORM does not re-export a boolean combinator.
  const auraColumns = [
    "id",
    "userId",
    "issuerId",
    "postId",
    "commentId",
  ] as const;
  for (const column of auraColumns) {
    await orm.AuraLogs.where((log) =>
      log[column].like(SEED_LIKE)
    ).deleteAndCount();
  }
  // Everything else cascades, but children are still removed explicitly so the
  // counts read sensibly in the log.
  const counts = {
    bookmarks: await orm.Bookmarks.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    commentVotes: await orm.CommentVotes.where((row) =>
      row.userId.like(SEED_LIKE)
    ).deleteAndCount(),
    communityPostShares: await orm.CommunityPostShares.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    communitySubscriptions: await orm.CommunitySubscriptions.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    communityMembers: await orm.CommunityMembers.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    comments: await orm.Comments.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    follows: await orm.Follows.where((row) =>
      row.followerId.like(SEED_LIKE)
    ).deleteAndCount(),
    mentions: await orm.Mentions.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    postTags: await orm.PostToTag.where((row) =>
      row.a.like(SEED_LIKE)
    ).deleteAndCount(),
    postVisits: await orm.PostVisits.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    // Link rows: visits carry their own seeded id, follows do not, so those are
    // identified by the seeded account on the far end of the edge.
    linkVisits: await orm.PostVisits.where((row) =>
      row.id.like(`${SEED_ID_PREFIX}-link-%`)
    ).deleteAndCount(),
    linkFollows: await orm.Follows.where((row) =>
      row.followingId.like(SEED_LIKE)
    ).deleteAndCount(),
    posts: await orm.Posts.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    votes: await orm.Votes.where((row) =>
      row.userId.like(SEED_LIKE)
    ).deleteAndCount(),
    communities: await orm.Communities.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
    tags: await orm.Tag.where((row) => row.id.like(SEED_LIKE)).deleteAndCount(),
    users: await orm.Users.where((row) =>
      row.id.like(SEED_LIKE)
    ).deleteAndCount(),
  };
  const removed = Object.values(counts).reduce((sum, value) => sum + value, 0);
  console.log(`  removed ${removed} rows`);
}

// The trending score the app ranks the Trending tab by, derived from the same
// engagement the plan actually produced rather than guessed per post.
function withTrendingScores(plan: SeedPlan): Map<string, number> {
  const commentCounts = new Map<string, number>();
  for (const comment of [...plan.comments, ...plan.commentReplies]) {
    commentCounts.set(
      comment.postId,
      (commentCounts.get(comment.postId) ?? 0) + 1
    );
  }
  const bookmarkCounts = new Map<string, number>();
  for (const bookmark of plan.bookmarks) {
    bookmarkCounts.set(
      bookmark.postId,
      (bookmarkCounts.get(bookmark.postId) ?? 0) + 1
    );
  }
  const scores = new Map<string, number>();
  for (const post of [...plan.posts, ...plan.responses, ...plan.gusts]) {
    scores.set(
      post.id,
      computeTrendingScore({
        aura: post.aura,
        bookmarkCount: bookmarkCounts.get(post.id) ?? 0,
        commentCount: commentCounts.get(post.id) ?? 0,
        createdAt: post.createdAt,
        viewCount: post.viewCount,
      })
    );
  }
  return scores;
}

async function writePlan(plan: SeedPlan): Promise<number> {
  const orm = prisma.orm.public;
  const trendingScores = withTrendingScores(plan);
  const postRow = (post: SeedPlan["posts"][number]) => ({
    aura: post.aura,
    communityId: post.communityId,
    content: post.content,
    createdAt: toPrismaDateTime(post.createdAt),
    id: post.id,
    isGust: post.isGust,
    parentPostId: post.parentPostId,
    rootPostId: post.rootPostId,
    threadTopId: post.threadTopId,
    trendingScore: trendingScores.get(post.id) ?? 0,
    userId: post.userId,
    viewCount: post.viewCount,
  });
  const commentRow = (comment: SeedPlan["comments"][number]) => ({
    aura: comment.aura,
    content: comment.content,
    createdAt: toPrismaDateTime(comment.createdAt),
    creationAura: comment.creationAura,
    id: comment.id,
    parentId: comment.parentId,
    postId: comment.postId,
    postReceivedAura: comment.postReceivedAura,
    receivedAura: comment.receivedAura,
    rootId: comment.rootId,
    userId: comment.userId,
  });

  let written = 0;
  written += await insertChunked("tags", plan.tags, (rows) =>
    orm.Tag.createAndCount(
      rows.map((tag) => ({
        createdAt: toPrismaDateTime(tag.createdAt),
        id: tag.id,
        name: tag.name,
      }))
    )
  );
  written += await insertChunked("users", plan.users, (rows) =>
    orm.Users.createAndCount(
      rows.map((user) => ({
        aura: user.aura,
        bio: user.bio,
        createdAt: toPrismaDateTime(user.createdAt),
        displayName: user.displayName,
        displayUsername: user.username,
        id: user.id,
        username: user.username,
      }))
    )
  );
  written += await insertChunked("communities", plan.communities, (rows) =>
    orm.Communities.createAndCount(
      rows.map((community) => ({
        accentColor: community.accentColor,
        createdAt: toPrismaDateTime(community.createdAt),
        description: community.description,
        id: community.id,
        mature: community.mature,
        name: community.name,
        ownerId: community.ownerId,
        slug: community.slug,
        topics: community.topics,
        type: community.type as "PUBLIC" | "RESTRICTED" | "PRIVATE",
      }))
    )
  );
  written += await insertChunked(
    "community members",
    plan.communityMembers,
    (rows) =>
      orm.CommunityMembers.createAndCount(
        rows.map((member) => ({
          communityId: member.communityId,
          createdAt: toPrismaDateTime(member.createdAt),
          id: member.id,
          role: member.role as "OWNER" | "MODERATOR" | "MEMBER" | "PARTICIPANT",
          status: member.status as "ACTIVE" | "PENDING",
          userId: member.userId,
        }))
      )
  );
  written += await insertChunked(
    "community subscriptions",
    plan.communitySubscriptions,
    (rows) =>
      orm.CommunitySubscriptions.createAndCount(
        rows.map((subscription) => ({
          communityId: subscription.communityId,
          createdAt: toPrismaDateTime(subscription.createdAt),
          id: subscription.id,
          userId: subscription.userId,
        }))
      )
  );
  written += await insertChunked("gusts", plan.gusts, (rows) =>
    orm.Posts.createAndCount(rows.map(postRow))
  );
  written += await insertChunked("fleets", plan.posts, (rows) =>
    orm.Posts.createAndCount(rows.map(postRow))
  );
  written += await insertChunked("responses", plan.responses, (rows) =>
    orm.Posts.createAndCount(rows.map(postRow))
  );
  written += await insertChunked(
    "community shares",
    plan.communityPostShares,
    (rows) =>
      orm.CommunityPostShares.createAndCount(
        rows.map((share) => ({
          communityId: share.communityId,
          createdAt: toPrismaDateTime(share.createdAt),
          id: share.id,
          postId: share.postId,
          sourcePostId: share.sourcePostId,
        }))
      )
  );
  written += await insertChunked("eddies", plan.comments, (rows) =>
    orm.Comments.createAndCount(rows.map(commentRow))
  );
  written += await insertChunked("eddie replies", plan.commentReplies, (rows) =>
    orm.Comments.createAndCount(rows.map(commentRow))
  );
  written += await insertChunked("post tags", plan.postTags, (rows) =>
    orm.PostToTag.createAndCount(
      rows.map((link) => ({ a: link.postId, b: link.tagId }))
    )
  );
  written += await insertChunked("mentions", plan.mentions, (rows) =>
    orm.Mentions.createAndCount(
      rows.map((mention) => ({
        createdAt: toPrismaDateTime(mention.createdAt),
        id: mention.id,
        postId: mention.postId,
        userId: mention.userId,
      }))
    )
  );
  written += await insertChunked("votes", plan.votes, (rows) =>
    orm.Votes.createAndCount(
      rows.map((vote) => ({
        createdAt: toPrismaDateTime(vote.createdAt),
        postId: vote.postId,
        userId: vote.userId,
        value: vote.value,
      }))
    )
  );
  written += await insertChunked("comment votes", plan.commentVotes, (rows) =>
    orm.CommentVotes.createAndCount(
      rows.map((vote) => ({
        commentId: vote.commentId,
        createdAt: toPrismaDateTime(vote.createdAt),
        userId: vote.userId,
        value: vote.value,
      }))
    )
  );
  written += await insertChunked("bookmarks", plan.bookmarks, (rows) =>
    orm.Bookmarks.createAndCount(
      rows.map((bookmark) => ({
        createdAt: toPrismaDateTime(bookmark.createdAt),
        id: bookmark.id,
        postId: bookmark.postId,
        userId: bookmark.userId,
      }))
    )
  );
  written += await insertChunked("follows", plan.follows, (rows) =>
    orm.Follows.createAndCount(
      rows.map((follow) => ({
        followerId: follow.followerId,
        followingId: follow.followingId,
      }))
    )
  );
  written += await insertChunked("post visits", plan.postVisits, (rows) =>
    orm.PostVisits.createAndCount(
      rows.map((visit) => ({
        id: visit.id,
        postId: visit.postId,
        // This table timestamps the visit, it is not a generic createdAt.
        userId: visit.userId,
        visitedAt: toPrismaDateTime(visit.createdAt),
      }))
    )
  );
  written += await insertChunked("aura logs", plan.auraLogs, (rows) =>
    orm.AuraLogs.createAndCount(
      rows.map((log) => ({
        amount: log.amount,
        commentId: log.commentId,
        createdAt: toPrismaDateTime(log.createdAt),
        id: log.id,
        issuerId: log.issuerId,
        // The contract carries the enum through its underscored storage name,
        // so the ORM field is _type rather than type.
        _type: log.type,
        postId: log.postId,
        userId: log.userId,
      }))
    )
  );
  return written;
}

// Accounts that already exist in the database - the developer, a tester - are
// not part of the generated corpus, but leaving them untouched means their
// Following tab is empty and their recommendations have no signal at all. This
// wires each of them into the graph: they follow the accounts the generator
// made popular, and they leave a few visits behind for the ranker.
//
// It never touches a seeded row, and --fresh reverses all of it, because every
// row it writes lives under the same seed- namespace.
const LINK_FOLLOWS_PER_USER = 15;
const LINK_VISITS_PER_USER = 25;

async function linkExistingAccounts(): Promise<number> {
  const orm = prisma.orm.public;
  const existing = await orm.Users.select("id", "username").all();
  // The system moderation persona is a fixed account, not a person: it gets no
  // follows and leaves no visit trail.
  const outsiders = existing.filter(
    (user) => !isSeedId(user.id) && user.id !== SYSTEM_MODERATION_USER_ID
  );
  if (outsiders.length === 0) {
    return 0;
  }
  // The generator's popularity skew pushes followers onto the low indices, so
  // the top of the aura ranking is exactly the "accounts worth following" set.
  const popular = await orm.Users.select("id")
    .where((user) => user.id.like(SEED_LIKE))
    .orderBy((user) => user.aura.desc())
    .limit(LINK_FOLLOWS_PER_USER)
    .all();
  const recentPosts = await orm.Posts.select("id")
    .where((post) => post.id.like(SEED_LIKE))
    .orderBy((post) => post.createdAt.desc())
    .limit(120)
    .all();
  if (popular.length === 0 || recentPosts.length === 0) {
    return 0;
  }

  let linked = 0;
  for (const outsider of outsiders) {
    for (const target of popular) {
      if (target.id === outsider.id) {
        continue;
      }
      linked += await orm.Follows.createAndCount([
        { followerId: outsider.id, followingId: target.id },
      ]);
    }
    const start = Math.max(0, recentPosts.length - LINK_VISITS_PER_USER);
    await orm.PostVisits.createAndCount(
      recentPosts.slice(start).map((post) => ({
        id: `seed-link-visit-${outsider.id}-${post.id}`,
        postId: post.id,
        userId: outsider.id,
        visitedAt: toPrismaDateTime(new Date()),
      }))
    );
    linked += Math.min(LINK_VISITS_PER_USER, recentPosts.length);
  }
  return linked;
}

function printPlanSummary(plan: SeedPlan): void {
  const rows: [string, number][] = [
    ["users", plan.users.length],
    ["tags", plan.tags.length],
    ["communities", plan.communities.length],
    ["community members", plan.communityMembers.length],
    ["community subscriptions", plan.communitySubscriptions.length],
    ["fleets (roots)", plan.posts.length],
    ["responses", plan.responses.length],
    ["gusts", plan.gusts.length],
    ["community shares", plan.communityPostShares.length],
    ["eddies (comments)", plan.comments.length],
    ["eddie replies", plan.commentReplies.length],
    ["votes", plan.votes.length],
    ["comment votes", plan.commentVotes.length],
    ["bookmarks", plan.bookmarks.length],
    ["follows", plan.follows.length],
    ["mentions", plan.mentions.length],
    ["post tags", plan.postTags.length],
    ["post visits", plan.postVisits.length],
    ["aura logs", plan.auraLogs.length],
  ];
  console.log("Planned rows:");
  for (const [label, count] of rows) {
    console.log(`  ${label.padEnd(24)} ${String(count).padStart(7)}`);
  }
  console.log(
    `  ${"total".padEnd(24)} ${String(countPlanRows(plan)).padStart(7)}`
  );
}

export async function seedDevContent(options: CliOptions): Promise<number> {
  // Handles already in the database, so a seeded username cannot collide with
  // a real account and take the whole run down on the users unique index.
  const existing = await prisma.orm.public.Users.select("username").all();
  const reserved = new Set(existing.map((row) => row.username));
  const plan = buildSeedPlan(options.config, { reservedUsernames: reserved });

  const strayId = [...plan.users, ...plan.posts, ...plan.comments].find(
    (row) => !isSeedId(row.id)
  );
  if (strayId) {
    throw new Error(
      `Refusing to write id outside the seed namespace: ${strayId.id}`
    );
  }

  printPlanSummary(plan);
  if (options.dryRun) {
    console.log("\nDry run: nothing was written.");
    return 0;
  }

  const startedAt = Date.now();
  console.log("\nWriting:");
  const written = await writePlan(plan);
  const linked = await linkExistingAccounts();
  if (linked > 0) {
    console.log(
      `  ${"linked existing accounts".padEnd(26)} ${String(linked).padStart(7)} rows`
    );
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nSeeded ${written} rows in ${elapsed}s.`);
  return written;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  assertSafeTarget(options);
  if (options.fresh) {
    await deleteSeededRows();
  }
  await seedDevContent(options);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`\nSeed failed: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closePrisma();
  }
}
