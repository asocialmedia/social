import { beforeEach, expect, mock, test } from "bun:test";

let signedIn = true;
let staff = true;
const decide = mock(
  (_community: string, _actor: string, _request: string, decision: string) =>
    Promise.resolve({ applied: true, decision })
);
const list = mock(() =>
  Promise.resolve({ nextCursor: null, requests: [], total: 0 })
);
mock.module("@asm/db", () => ({
  and: (...values: unknown[]) => values,
  decideCommunityMembershipRequest: decide,
  getCommunityBySlug: () =>
    Promise.resolve({ id: "private-community", type: "PRIVATE" }),
  isCommunityModerator: () => Promise.resolve(staff),
  listCommunityMembershipRequests: list,
  prisma: {
    orm: {
      public: {
        CommunityMembers: {
          select: () => ({
            where: () => ({ first: () => Promise.resolve(null) }),
          }),
        },
      },
    },
  },
}));
mock.module("@/communities/api-response", () => ({
  communityErrorResponse: () =>
    Response.json({ error: "Forbidden" }, { status: 403 }),
  readJsonBody: (request: Request) => request.json().catch(() => null),
  requireApiUser: () =>
    Promise.resolve(
      signedIn
        ? { ok: true, userId: "staff" }
        : {
            ok: false,
            response: Response.json({ error: "Unauthorized" }, { status: 401 }),
          }
    ),
}));
const params = Promise.resolve({
  requestId: "original-request",
  slug: "private",
});

beforeEach(() => {
  signedIn = true;
  staff = true;
  decide.mockClear();
  list.mockClear();
});

test("request decisions require authentication before touching membership", async () => {
  signedIn = false;
  const { PATCH } = await import("./[requestId]/route");
  const response = await PATCH(
    new Request("http://localhost", { method: "PATCH" }),
    { params }
  );
  expect(response.status).toBe(401);
  expect(decide).not.toHaveBeenCalled();
});

test("request decision API rejects invalid decision payloads", async () => {
  const { PATCH } = await import("./[requestId]/route");
  const response = await PATCH(
    new Request("http://localhost", {
      body: JSON.stringify({ decision: "activate" }),
      method: "PATCH",
    }),
    { params }
  );
  expect(response.status).toBe(400);
  expect(decide).not.toHaveBeenCalled();
});

test("decision API passes the original request ID to the transactional service", async () => {
  const { PATCH } = await import("./[requestId]/route");
  const response = await PATCH(
    new Request("http://localhost", {
      body: JSON.stringify({ decision: "approve" }),
      method: "PATCH",
    }),
    { params }
  );
  expect(response.status).toBe(200);
  expect(decide).toHaveBeenCalledWith(
    "private-community",
    "staff",
    "original-request",
    "approve"
  );
});

test("request-status lookup hides staff controls after permission loss", async () => {
  staff = false;
  const { GET } = await import("./[requestId]/route");
  const response = await GET(new Request("http://localhost"), { params });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ canDecide: false, pending: false });
});

test("staff list forwards its cursor and returns private cache headers", async () => {
  const { GET } = await import("./route");
  const response = await GET(
    new Request("http://localhost?cursor=next-request"),
    { params }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(list).toHaveBeenCalledWith(
    "private-community",
    "staff",
    "next-request"
  );
});
