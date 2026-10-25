import { beforeEach, describe, expect, mock, test } from "bun:test";

const state = {
  allowed: true,
  bytes: "0",
  communityAllowed: true,
  communityMediaId: "delivery",
  copies: 0,
  count: 0,
  deletes: 0,
  failCopy: false,
  media: {
    id: "delivery",
    incognitoSessionId: null as string | null,
    messageConversationId: "dm",
    messageViewOnce: false,
    status: "READY",
    techMetadata: {} as Record<string, unknown>,
  },
  membershipQueries: [] as unknown[][],
  message: {
    deletedAt: null as string | null,
    expiresAt: null as string | null,
    id: "message",
  },
  owned: null as { id: string; favorite: boolean } | null,
  userId: "viewer" as string | null,
  viewOnce: false,
  writes: [] as Record<string, unknown>[],
};
const variants = ["full", "thumb"].map((variant) => ({
  durationMs: null,
  height: 128,
  key: `${variant}.webp`,
  mimeType: "image/webp",
  pipelineVersion: 1,
  sizeBytes: 1000,
  variant,
  width: 128,
}));
function query<T>(get: () => T) {
  const chain = {
    all: () => get(),
    first: () => get(),
    select: (..._args: unknown[]) => chain,
    where: (..._args: unknown[]) => chain,
  };
  return chain;
}
const mediaQuery = query(() => state.media);
const nullQuery = query(() => null);
const tx = {
  orm: {
    public: {
      PostMedia: {
        ...nullQuery,
        create: (data: Record<string, unknown>) => {
          state.writes.push(data);
          return data;
        },
      },
      PostMediaDerivatives: { create: () => ({}) },
      UserStickers: {
        ...nullQuery,
        create: (data: Record<string, unknown>) => ({ ...data, id: "saved" }),
      },
    },
  },
};
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    state.userId ? { user: { id: state.userId } } : null,
}));
mock.module("@/lib/media/message-media-access", () => ({
  resolveMessageMediaMembership: () => state.allowed,
}));
mock.module("@/lib/media/object-storage", () => ({
  ASMOB_BUCKET: "test",
  asmobClient: {
    send: (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "CopyObjectCommand") {
        state.copies += 1;
        if (state.failCopy && state.copies === 2) {
          throw new Error("copy failure");
        }
      } else {
        state.deletes += 1;
      }
      return {};
    },
  },
}));
mock.module("@asm/db", () => ({
  and: (...args: unknown[]) => args,
  consumeRateLimit: () => ({ allowed: true }),
  getCommunityChatMessage: () => ({
    payload: {
      kind: "image",
      presentation: "sticker",
      sticker: { animated: false, mediaId: state.communityMediaId, version: 1 },
      type: "media",
      url: "/api/media/delivery/v/sticker-full.webp",
    },
  }),
  getCommunityChatMessageRoomAccess: () => {
    if (!state.communityAllowed) {
      throw new Error("denied");
    }
    return { room: { id: "room" } };
  },
  prisma: {
    orm: {
      public: {
        MessageMediaLinks: query(() => ({ viewOnce: state.viewOnce })),
        Messages: query(() => state.message),
        PostMedia: { ...mediaQuery, select: () => nullQuery },
        PostMediaDerivatives: query(() => variants),
      },
    },
    transaction: (run: (db: typeof tx) => Promise<unknown>) => run(tx),
  },
  rawQuery: (sql: string, parameters: unknown[]) => {
    if (sql.includes("FROM public.user_stickers s")) {
      state.membershipQueries.push(parameters);
    }
    if (sql.includes("FROM public.user_stickers s")) {
      return { rows: state.owned ? [state.owned] : [] };
    }
    return {
      rows: sql.includes("COUNT")
        ? [{ bytes: state.bytes, count: state.count }]
        : [{ id: "viewer" }],
    };
  },
  redis: { incrby: () => Promise.resolve(0) },
}));
const { POST } = await import("./route");
function save(source = "messages") {
  return POST(
    new Request("http://localhost/api/stickers/save", {
      body: JSON.stringify({
        mediaId: "delivery",
        messageId: "message",
        source,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
}

async function status(source = "messages") {
  const response = await save(source);
  return response.status;
}

beforeEach(() => {
  state.owned = null;
  state.membershipQueries = [];
  state.media.techMetadata = {};
  state.userId = "viewer";
  state.allowed = true;
  state.communityAllowed = true;
  state.media.status = "READY";
  state.media.messageViewOnce = false;
  state.media.incognitoSessionId = null;
  state.message.deletedAt = null;
  state.message.expiresAt = null;
  state.count = 0;
  state.bytes = "0";
  state.viewOnce = false;
  state.copies = 0;
  state.deletes = 0;
  state.failCopy = false;
  state.writes = [];
  state.communityMediaId = "delivery";
});
describe("save received sticker", () => {
  test("requires authentication before any copy", async () => {
    state.userId = null;
    expect(await status()).toBe(401);
    expect(state.copies).toBe(0);
  });
  test("rejects viewers without message access", async () => {
    state.allowed = false;
    expect(await status()).toBe(404);
    expect(state.copies).toBe(0);
  });
  test.each(["messageViewOnce", "incognitoSessionId"] as const)(
    "rejects protected source %s",
    async (field) => {
      if (field === "messageViewOnce") {
        state.media.messageViewOnce = true;
      } else {
        state.media.incognitoSessionId = "session";
      }
      expect(await status()).toBe(404);
      expect(state.copies).toBe(0);
    }
  );
  test("rejects deleted and disappearing source messages", async () => {
    state.message.deletedAt = "now";
    expect(await status()).toBe(404);
    state.message.deletedAt = null;
    state.message.expiresAt = "later";
    expect(await status()).toBe(404);
  });
  test("copies both variants into a new private owner-bound source", async () => {
    expect(await status()).toBe(201);
    expect(state.copies).toBe(2);
    expect(state.deletes).toBe(0);
    expect(state.writes[0]).toMatchObject({
      stickerSource: true,
      userId: "viewer",
      visibility: "PRIVATE",
    });
    expect(state.writes[0]?.id).not.toBe("delivery");
    expect(state.writes[0]?.messageConversationId).toBeUndefined();
  });
  test("enforces the 1000 item quota and cleans copied objects", async () => {
    state.count = 1000;
    const response = await save();
    expect(response.status).toBe(409);
    expect(await response.json().then((body) => body.error)).toContain("1,000");
    expect(state.writes).toHaveLength(0);
    expect(state.deletes).toBe(2);
  });
  test("enforces the library byte quota", async () => {
    state.bytes = String(500 * 1024 * 1024);
    expect(await status()).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  test("cleans the first object when the second copy fails", async () => {
    state.failCopy = true;
    expect(await status()).toBe(409);
    expect(state.deletes).toBe(1);
    expect(state.writes).toHaveLength(0);
  });
  test("checks community room access and payload media identity", async () => {
    state.communityAllowed = false;
    expect(await status("community")).toBe(404);
    state.communityAllowed = true;
    state.communityMediaId = "someone-elses-media";
    expect(await status("community")).toBe(404);
    expect(state.copies).toBe(0);
  });
  test("saves an authorized community sticker with independent copies", async () => {
    expect(await status("community")).toBe(201);
    expect(state.copies).toBe(2);
  });
});

const { GET: membership } = await import("../membership/route");
function lookup() {
  return membership(
    new Request(
      "http://localhost/api/stickers/membership?mediaId=delivery&messageId=message"
    )
  );
}
describe("sent sticker membership", () => {
  test("requires authentication", async () => {
    state.userId = null;
    const response = await lookup();
    expect(response.status).toBe(401);
    expect(state.membershipQueries).toHaveLength(0);
  });
  test("does not expose membership without message access", async () => {
    state.allowed = false;
    const response = await lookup();
    expect(response.status).toBe(404);
    expect(state.membershipQueries).toHaveLength(0);
  });
  test("returns an empty library state without saving a copy", async () => {
    const response = await lookup();
    expect(await response.json()).toEqual({ item: null });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.copies).toBe(0);
  });
  test("matches the viewer's saved sticker through delivery provenance", async () => {
    state.media.techMetadata = { stickerOriginMediaId: "original" };
    state.owned = { favorite: true, id: "owned" };
    const response = await lookup();
    expect(await response.json()).toEqual({ item: state.owned });
    expect(state.membershipQueries[0]).toEqual([
      "viewer",
      "delivery",
      "original",
    ]);
  });
  test("reuses an existing library entry when saving another delivery", async () => {
    state.owned = { favorite: true, id: "owned" };
    const response = await save();
    expect(await response.json()).toEqual({
      item: state.owned,
      saved: true,
      stickerId: "owned",
    });
    expect(state.copies).toBe(0);
    expect(state.writes).toHaveLength(0);
  });
  test("preserves the original identity in a received copy", async () => {
    state.media.techMetadata = { stickerOriginMediaId: "original" };
    expect(await status()).toBe(201);
    expect(state.writes[0]?.techMetadata).toEqual({
      stickerOriginMediaId: "original",
    });
  });
  test("rejects malformed lookup requests", async () => {
    const response = await membership(
      new Request("http://localhost/api/stickers/membership")
    );
    expect(response.status).toBe(400);
  });
});
