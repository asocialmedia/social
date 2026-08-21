import { beforeEach, describe, expect, mock, test } from "bun:test";

import { GET } from "./route";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "viewer1" },
}));

let lastFindManyArgs: unknown = null;

const mockFindMany = mock((args: unknown) => {
  lastFindManyArgs = args;
  return [
    {
      attachments: [{ id: "m1", type: "VIDEO" }],
      aura: 10,
      createdAt: new Date(),
      id: "post1",
      isGust: true,
      userId: "targetUser",
    },
  ];
});

const mockHydrateViewCounts = mock((posts: unknown[]) => posts);

mock.module("@asm/db", () => ({
  MediaType: {
    AUDIO: "AUDIO",
    IMAGE: "IMAGE",
    VIDEO: "VIDEO",
  },
  getPostDataInclude: (viewerId: string) => ({
    user: true,
    vote: !!viewerId,
  }),
  hydrateViewCounts: mockHydrateViewCounts,
  prisma: {
    post: {
      findMany: mockFindMany,
    },
  },
}));

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("GET /api/users/[userId]/posts", () => {
  beforeEach(() => {
    lastFindManyArgs = null;
    mockFindMany.mockClear();
    mockHydrateViewCounts.mockClear();
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "viewer1" } }));
  });

  test("filters only gusts when filter=gusts", async () => {
    const req = new Request(
      "http://localhost:3000/api/users/targetUser/posts?filter=gusts"
    );
    const res = await GET(req, {
      params: Promise.resolve({ userId: "targetUser" }),
    });

    expect(res.status).toBe(200);
    const callArgs = lastFindManyArgs as {
      where?: { isGust?: boolean; userId?: string };
    };
    expect(callArgs?.where?.userId).toBe("targetUser");
    expect(callArgs?.where?.isGust).toBe(true);
  });

  test("excludes gusts from standard user post feed (isGust: false)", async () => {
    const req = new Request("http://localhost:3000/api/users/targetUser/posts");
    const res = await GET(req, {
      params: Promise.resolve({ userId: "targetUser" }),
    });

    expect(res.status).toBe(200);
    const callArgs = lastFindManyArgs as {
      where?: { isGust?: boolean; userId?: string };
    };
    expect(callArgs?.where?.userId).toBe("targetUser");
    expect(callArgs?.where?.isGust).toBe(false);
  });

  test("filters media posts when filter=media", async () => {
    const req = new Request(
      "http://localhost:3000/api/users/targetUser/posts?filter=media"
    );
    const res = await GET(req, {
      params: Promise.resolve({ userId: "targetUser" }),
    });

    expect(res.status).toBe(200);
    const callArgs = lastFindManyArgs as {
      where?: {
        attachments?: { some?: { type?: { in?: string[] } } };
        userId?: string;
      };
    };
    expect(callArgs?.where?.userId).toBe("targetUser");
    expect(callArgs?.where?.attachments?.some?.type?.in).toEqual([
      "IMAGE",
      "VIDEO",
      "AUDIO",
    ]);
  });

  test("allows guests to browse user posts safely", async () => {
    mockGetSession.mockImplementationOnce(() => null);

    const req = new Request(
      "http://localhost:3000/api/users/targetUser/posts?filter=gusts"
    );
    const res = await GET(req, {
      params: Promise.resolve({ userId: "targetUser" }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { posts: unknown[] };
    expect(json.posts).toHaveLength(1);
  });

  test("omits moderated:false by default across all filters", async () => {
    for (const filter of [undefined, "gusts", "media"]) {
      const query = filter ? `?filter=${filter}` : "";
      // Each filter is asserted against the last findMany args, so the calls
      // must run sequentially and share that captured state.
      // eslint-disable-next-line no-await-in-loop
      await GET(
        new Request(`http://localhost:3000/api/users/targetUser/posts${query}`),
        { params: Promise.resolve({ userId: "targetUser" }) }
      );
      const callArgs = lastFindManyArgs as {
        where?: Record<string, unknown>;
      };
      expect(callArgs?.where).not.toHaveProperty("moderated");
    }
  });

  test("applies moderated:false only when excludeModerated=1", async () => {
    for (const filter of [undefined, "gusts", "media"]) {
      const query = `?${filter ? `filter=${filter}&` : ""}excludeModerated=1`;
      // Sequential for the same shared-state reason as the test above.
      // eslint-disable-next-line no-await-in-loop
      await GET(
        new Request(`http://localhost:3000/api/users/targetUser/posts${query}`),
        { params: Promise.resolve({ userId: "targetUser" }) }
      );
      const callArgs = lastFindManyArgs as {
        where?: { moderated?: boolean };
      };
      expect(callArgs?.where?.moderated).toBe(false);
    }
  });
});
