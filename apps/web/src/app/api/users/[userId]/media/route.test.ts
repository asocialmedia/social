import { beforeEach, describe, expect, mock, test } from "bun:test";

let lastFindManyArgs: unknown = null;
const mockFindMany = mock((args: unknown) => {
  lastFindManyArgs = args;
  return [
    {
      id: "media1",
      post: {
        community: null,
        explicitContent: false,
        id: "post1",
        isGust: false,
        moderated: false,
      },
      type: "IMAGE",
    },
  ];
});

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: "viewer1" },
}));

const mockCommunityVisibilityWhere = mock((userId: string) => ({
  _communityVisibilityFor: userId,
}));

mock.module("@asm/db", () => ({
  MediaType: {
    AUDIO: "AUDIO",
    IMAGE: "IMAGE",
    VIDEO: "VIDEO",
  },
  communityVisibilityWhere: mockCommunityVisibilityWhere,
  prisma: {
    media: {
      findMany: mockFindMany,
    },
  },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const { GET } = await import("./route");

describe("GET /api/users/[userId]/media", () => {
  beforeEach(() => {
    lastFindManyArgs = null;
    mockFindMany.mockClear();
    mockGetSession.mockClear();
    mockCommunityVisibilityWhere.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: "viewer1" } }));
  });

  test("rejects unauthenticated requests with 401", async () => {
    mockGetSession.mockImplementationOnce(() => null);

    const req = new Request("http://localhost/api/users/user123/media");
    const res = await GET(req, {
      params: Promise.resolve({ userId: "user123" }),
    });

    expect(res.status).toBe(401);
  });

  test("applies communityVisibilityWhere with the viewer's session id", async () => {
    const req = new Request("http://localhost/api/users/user123/media");
    const res = await GET(req, {
      params: Promise.resolve({ userId: "user123" }),
    });

    expect(res.status).toBe(200);
    expect(mockCommunityVisibilityWhere).toHaveBeenCalledWith("viewer1");

    const query = lastFindManyArgs as {
      where?: {
        post?: {
          _communityVisibilityFor?: string;
          userId?: string;
        };
      };
    };

    expect(query.where?.post?.userId).toBe("user123");
    expect(query.where?.post?._communityVisibilityFor).toBe("viewer1");
  });
});
