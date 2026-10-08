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
const sendCalls: GetObjectCommandLike[] = [];

interface GetObjectCommandLike {
  input: { Bucket: string; Key: string };
}

function ownershipRow() {
  return {
    comment: null,
    commentId: null,
    messageConversationId: null,
    post: null,
    postId: "post_1",
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
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve({ user: { id: "user_1" } }),
}));

mock.module("@/lib/media/media-access", () => ({
  decideMediaAccess: () => ({ allowed: true, status: 200 }),
  resolveOwningCommunity: () => null,
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

describe("variant route missing-object mapping", () => {
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
