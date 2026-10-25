import { beforeEach, expect, mock, test } from "bun:test";

import { defaultNetworkPreferences } from "@asm/protocols/discovery";

const uri = "at://did:plc:author/app.bsky.feed.post/post";
const snapshot = {
  author: {
    displayName: "Author",
    handle: "author.test",
    id: "did:plc:author",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/author.test",
  },
  createdAt: "2026-10-25T00:00:00Z",
  id: uri,
  indexedAt: "2026-10-25T00:00:00Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "1",
  segments: [{ text: "Hello" }],
  source: "bluesky",
  text: "Hello",
  upstreamCounts: { likes: 1, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/author.test/post/post",
};
const preferences = defaultNetworkPreferences();
const author = {
  avatarUrl: null,
  displayName: "Profile",
  id: "profile",
  username: "profile",
};
const stored = () => ({
  available: true,
  checkedAt: new Date(),
  snapshot,
  uri,
});
let amplified = [
  {
    amplifiedAt: new Date("2026-10-25T00:00:00Z"),
    externalPost: stored(),
    externalPostId: "external-id",
  },
];
let comments = [
  {
    content: "My eddie",
    createdAt: new Date("2026-10-25T00:00:00Z"),
    externalPost: stored(),
    id: "comment-id",
    user: author,
  },
];
let current = [snapshot];
let offline = false;
const cursors: unknown[] = [];
const viewers: string[] = [];
function chain<T>(rows: () => T[]) {
  const query = {
    all: () => Promise.resolve(rows()),
    cursor: (value: unknown) => {
      cursors.push(value);
      return query;
    },
    include: () => query,
    limit: () => query,
    orderBy: () => query,
    select: () => query,
    where: (
      predicate: (entry: {
        userId: { eq: (id: string) => unknown };
        amplified: { eq: (value: boolean) => unknown };
        deleted: { eq: (value: boolean) => unknown };
      }) => unknown
    ) => {
      predicate({
        amplified: { eq: () => true },
        deleted: { eq: () => true },
        userId: {
          eq: (id) => {
            viewers.push(id);
            return true;
          },
        },
      });
      return query;
    },
  };
  return query;
}
mock.module("@asm/db", () => ({
  and: (...values: unknown[]) => values,
  externalPostStates: () =>
    Promise.resolve(
      new Map([
        [
          uri,
          {
            amplifications: 1,
            amplified: true,
            bookmarked: false,
            comments: 1,
          },
        ],
      ])
    ),
  filterExternalMediaSafety: (posts: unknown[]) => Promise.resolve(posts),
  fromPrismaDateTime: (date: Date) => date,
  prisma: {
    orm: {
      public: {
        ExternalComments: chain(() => comments),
        ExternalEngagements: chain(() => amplified),
      },
    },
  },
  readNetworkPreferences: () => Promise.resolve({ preferences }),
}));
mock.module("./service", () => ({
  readBlueskyPosts: () =>
    offline ? Promise.reject(new Error("Offline")) : Promise.resolve(current),
}));
const { profileExternalActivity } = await import("./profile-activity");
beforeEach(() => {
  amplified = [
    {
      amplifiedAt: new Date("2026-10-25T00:00:00Z"),
      externalPost: stored(),
      externalPostId: "external-id",
    },
  ];
  comments = [
    {
      content: "My eddie",
      createdAt: new Date("2026-10-25T00:00:00Z"),
      externalPost: stored(),
      id: "comment-id",
      user: author,
    },
  ];
  current = [snapshot];
  offline = false;
  preferences.showExplicitContent = true;
  preferences.avoidedTopics = [];
  cursors.length = 0;
  viewers.length = 0;
});
const signal = () => new AbortController().signal;

test("another person's amplifications use the profile owner and preserve Bluesky state", async () => {
  const page = await profileExternalActivity(
    "profile",
    "reader",
    "amplified",
    signal()
  );
  expect(viewers).toContain("profile");
  expect(page.items[0]?.post?.id).toBe(uri);
  expect(page.items[0]?.post?.asm?.amplified).toBe(true);
  expect(page.items[0]?.createdAt).toBe("2026-10-25T00:00:00.000Z");
});

test("eddies include the local comment, its author and the external parent", async () => {
  const page = await profileExternalActivity(
    "profile",
    "reader",
    "eddies",
    signal()
  );
  expect(page.items[0]?.comment).toEqual({
    content: "My eddie",
    id: "comment-id",
    user: author,
  });
  expect(page.items[0]?.post?.id).toBe(uri);
});

test("external activity paginates at the last served row rather than skipping the lookahead", async () => {
  amplified = Array.from({ length: 21 }, (_, index) => ({
    ...firstAmplification(),
    externalPostId: `external-${index}`,
  }));
  const page = await profileExternalActivity(
    "profile",
    "reader",
    "amplified",
    signal()
  );
  expect(page.items).toHaveLength(20);
  expect(page.nextCursor?.id).toBe("external-19");
  await profileExternalActivity(
    "profile",
    "reader",
    "amplified",
    signal(),
    page.nextCursor ?? undefined
  );
  expect(cursors).toContainEqual({
    amplifiedAt: new Date("2026-10-25T00:00:00Z"),
    externalPostId: "external-19",
  });
});

function firstAmplification() {
  const [entry] = amplified;
  if (!entry) {
    throw new Error("Expected an amplification fixture");
  }
  return entry;
}

test("confirmed missing sources do not revive stored snapshots, while outages retain available references", async () => {
  firstAmplification().externalPost.available = false;
  const missing = await profileExternalActivity(
    "profile",
    "reader",
    "amplified",
    signal()
  );
  expect(missing.items[0]?.post).toBeNull();
  firstAmplification().externalPost.available = true;
  firstAmplification().externalPost.checkedAt = new Date(0);
  current = [];
  const removed = await profileExternalActivity(
    "profile",
    "reader",
    "amplified",
    signal()
  );
  expect(removed.items[0]?.post).toBeNull();
  offline = true;
  const unavailable = await profileExternalActivity(
    "profile",
    "reader",
    "amplified",
    signal()
  );
  expect(unavailable.items[0]?.post?.id).toBe(uri);
});

test("reader policy still withholds avoided source posts", async () => {
  preferences.avoidedTopics = ["hello"];
  const page = await profileExternalActivity(
    "profile",
    "reader",
    "amplified",
    signal()
  );
  expect(page.items[0]?.post).toBeNull();
});

test("default-safety readers cannot read explicit eddie text through a profile", async () => {
  preferences.showExplicitContent = false;
  const [comment] = comments;
  if (!comment) {
    throw new Error("Expected an eddie fixture");
  }
  comment.content = "#nsfw explicit pornography";
  const page = await profileExternalActivity(
    "profile",
    "reader",
    "eddies",
    signal()
  );
  expect(page.items[0]?.comment?.content).toBe("");
  expect(page.items[0]?.comment?.withheld).toBe(true);
});
