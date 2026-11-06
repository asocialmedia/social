import { beforeEach, expect, mock, test } from "bun:test";

let userId: string | null = "viewer";
let unavailable = false;
let fail = false;
const inbox = mock(() =>
  fail
    ? Promise.reject(new Error("Unavailable"))
    : Promise.resolve([{ community: { id: "joined" }, hasUnread: true }])
);
mock.module("@asm/db", () => ({ getCommunityChatInbox: inbox }));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(userId ? { user: { id: userId } } : null),
}));
mock.module("@/lib/communities/chat-api", () => ({
  communityChatAvailabilityResponse: () =>
    unavailable ? Response.json({}, { status: 404 }) : null,
}));
const { GET } = await import("./route");

beforeEach(() => {
  userId = "viewer";
  unavailable = false;
  fail = false;
  inbox.mockClear();
});

test("requires authentication before querying memberships", async () => {
  userId = null;
  const response = await GET();
  expect(response.status).toBe(401);
  expect(inbox).not.toHaveBeenCalled();
});

test("returns only the authenticated viewer's inbox without shared caching", async () => {
  const response = await GET();
  expect(inbox).toHaveBeenCalledWith("viewer");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  expect(await response.json()).toEqual({
    communities: [{ community: { id: "joined" }, hasUnread: true }],
  });
});

test("honors the chat rollout gate", async () => {
  unavailable = true;
  const response = await GET();
  expect(response.status).toBe(404);
  expect(inbox).not.toHaveBeenCalled();
});

test("returns a recoverable error without database details", async () => {
  fail = true;
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Couldn't load community chats",
  });
});
