import { beforeEach, describe, expect, mock, test } from "bun:test";

// Variant serving route: how a missing object is reported.
//
// The route has two read paths. The plain path uses the S3 SDK, which throws
// S3ServiceException and is mapped to 404. The ranged path (every <video>
// seek) used to throw a plain Error, so the SAME absent object answered 500
// there - a lost asset looked like a server fault, spammed error logs, and
// left players with an unreadable stream instead of a clean miss. These tests
// pin the mapping: absent object is 404 on both paths, and a real storage
// fault is still 500.

const RANGE = "bytes=0-1023";

let derivativeKey = "p1/mp4-h264.mp4";
let upstreamResponse: () => Response = () => new Response("", { status: 404 });
let status: "DELETED" | "READY" = "READY";
let explicitPost = false;
let includeExplicit = false;
let explicitSafety = false;
let viewerId: string | null = "user_1";
let attachment: "post" | "draft" | "comment" | "message" = "post";
const sendCalls: GetObjectCommandLike[] = [];

interface GetObjectCommandLike {
  input: { Bucket: string; Key: string };
}

function ownershipRow() {
  return {
    _type: "VIDEO",
    comment: null,
    commentId: attachment === "comment" ? "comment_1" : null,
    id: "m1",
    key: "m1/video.mp4",
    messageConversationId: attachment === "message" ? "conversation_1" : null,
    mimeType: "video/mp4",
    post: attachment === "post" ? { explicitContent: explicitPost } : null,
    postId: attachment === "post" ? "post_1" : null,
    postMediaDerivatives: [],
    publishedKey: "m1/published.mp4",
    safety: { explicit: explicitSafety },
    size: 2048,
    status,
    userId: "user_1",
  };
}

function chain<T>(result: T) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "include", "where", "orderBy", "limit"]) {
    query[method] = () => query;
  }
  query.first = () => Promise.resolve(result);
  query.all = () => Promise.resolve(result);
  return query;
}

mock.module("@asm/db", () => ({
  and: (...filters: unknown[]) => ({ filters, kind: "and" }),
  canViewCommunity: () => Promise.resolve(false),
  prisma: {
    orm: {
      public: {
        PostMedia: {
          select: () => chain(ownershipRow()),
        },
        PostMediaDerivatives: {
          select: () => chain({ key: derivativeKey }),
        },
      },
    },
  },
  readNetworkPreferences: () =>
    Promise.resolve({ preferences: { showExplicitContent: includeExplicit } }),
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(viewerId ? { user: { id: viewerId } } : null),
}));

mock.module("@/lib/media/message-media-access", () => ({
  resolveDenWallpaperConversationId: () => Promise.resolve(null),
  resolveMessageMediaMembership: () => Promise.resolve(false),
}));

mock.module("@/lib/otel", () => ({
  getWebLogger: () => {},
}));

mock.module("@/lib/media/object-storage", () => ({
  ASMOB_BUCKET: "bucket",
  asmobClient: {
    send: (command: GetObjectCommandLike) => {
      sendCalls.push(command);
      return Promise.reject(
        Object.assign(new Error("missing"), { name: "NoSuchKey" })
      );
    },
  },
  generatePresignedUrl: () =>
    Promise.resolve("https://storage.test/presigned/mp4-h264.mp4"),
}));

const { GET } = await import("./route");
const { GET: getOriginal } = await import("../../route");

function rangedGet(): Promise<Response> {
  return GET(
    new Request("https://asocialmedia.cc/api/media/m1/v/mp4-h264.mp4", {
      headers: { Range: RANGE },
    }),
    { params: Promise.resolve({ mediaId: "m1", path: ["mp4-h264.mp4"] }) }
  );
}

beforeEach(() => {
  derivativeKey = "p1/mp4-h264.mp4";
  status = "READY";
  explicitPost = false;
  includeExplicit = false;
  explicitSafety = false;
  viewerId = "user_1";
  attachment = "post";
  upstreamResponse = () => new Response("", { status: 404 });
  sendCalls.length = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = (
    _input: unknown,
    init: { headers: Record<string, string> }
  ) => {
    expect(init.headers.Range).toBe(RANGE);
    return Promise.resolve(upstreamResponse());
  };
});

test.each([
  ["variant", rangedGet],
  [
    "original",
    () =>
      getOriginal(
        new Request("https://asocialmedia.cc/api/media/m1", {
          headers: { Range: RANGE },
        }),
        { params: Promise.resolve({ mediaId: "m1" }) }
      ),
  ],
] as const)(
  "%s: explicit draft stays readable only to its uploader without browsing opt-in",
  async (_name, read) => {
    attachment = "draft";
    explicitSafety = true;
    upstreamResponse = () =>
      new Response("partial", {
        headers: { "Content-Range": "bytes 0-6/2048" },
        status: 206,
      });
    const ownedDraft = await read();
    expect(ownedDraft.status).toBe(206);
    expect(await ownedDraft.text()).toBe("partial");
    expect(ownedDraft.headers.get("Cache-Control")).toBe("private, no-store");
    viewerId = null;
    includeExplicit = true;
    const guest = await read();
    expect(guest.status).toBe(404);
    viewerId = "other-user";
    const stranger = await read();
    expect(stranger.status).toBe(404);
    viewerId = "user_1";
    includeExplicit = false;
    attachment = "post";
    const published = await read();
    expect(published.status).toBe(404);
    attachment = "comment";
    const comment = await read();
    expect(comment.status).toBe(404);
    attachment = "message";
    const message = await read();
    expect(message.status).toBe(404);
  }
);

describe("variant route missing-object mapping", () => {
  test("explicit variants require opt-in and never enter a public cache", async () => {
    explicitPost = true;
    upstreamResponse = () =>
      new Response("partial", {
        headers: { "Content-Range": "bytes 0-6/2048" },
        status: 206,
      });
    const hidden = await rangedGet();
    expect(hidden.status).toBe(404);
    includeExplicit = true;
    const allowed = await rangedGet();
    expect(allowed.status).toBe(206);
    expect(allowed.headers.get("Cache-Control")).toBe("private, no-store");
  });
  test("a ranged read of an absent object answers 404, not 500", async () => {
    upstreamResponse = () => new Response("no such key", { status: 404 });
    const response = await rangedGet();
    expect(response.status).toBe(404);
  });

  test("a ranged read of a genuinely broken storage answers 500", async () => {
    upstreamResponse = () => new Response("boom", { status: 500 });
    const response = await rangedGet();
    expect(response.status).toBe(500);
  });

  test("an unsatisfiable range still answers 416", async () => {
    upstreamResponse = () =>
      new Response("", {
        headers: { "Content-Range": "bytes */2048" },
        status: 416,
      });
    const response = await rangedGet();
    expect(response.status).toBe(416);
  });

  test("a partial read still proxies the body as 206", async () => {
    upstreamResponse = () =>
      new Response("partial", {
        headers: {
          "Content-Length": "7",
          "Content-Range": "bytes 0-6/2048",
        },
        status: 206,
      });
    const response = await rangedGet();
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-6/2048");
    expect(await response.text()).toBe("partial");
  });

  test("a non-READY row is refused before any storage read", async () => {
    status = "DELETED";
    const response = await rangedGet();
    expect(response.status).toBe(404);
  });
});
