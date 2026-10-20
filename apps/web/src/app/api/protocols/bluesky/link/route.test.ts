import { beforeEach, expect, mock, test } from "bun:test";

let session: { user: { emailVerified: boolean; id: string } } | null;
const authorize = mock(
  (_handle: string, _options: { state: string; signal: AbortSignal }) =>
    new URL("https://bsky.social/oauth/authorize?request_uri=example")
);
const setCookie = mock(() => {});
mock.module("next/headers", () => ({
  cookies: () => ({ set: setCookie }),
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => session,
}));
mock.module("@/lib/protocols/oauth", () => ({
  blueskyOAuthOrigin: () => "http://localhost:3000",
  createBlueskyOAuthClient: () => ({ authorize }),
}));
const { POST } = await import("./route");
const request = (body: unknown, origin = "http://localhost:3000") =>
  new Request("http://localhost:3000/api/protocols/bluesky/link", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
beforeEach(() => {
  session = { user: { emailVerified: true, id: "user-1" } };
  authorize.mockClear();
  setCookie.mockClear();
});
test("requires a verified ASM session", async () => {
  session = null;
  const unauthenticated = await POST(request({ handle: "alice.bsky.social" }));
  expect(unauthenticated.status).toBe(401);
  session = { user: { emailVerified: false, id: "user-1" } };
  const unverified = await POST(request({ handle: "alice.bsky.social" }));
  expect(unverified.status).toBe(403);
});
test("starts provider authorization without collecting a password", async () => {
  const response = await POST(request({ handle: "@Alice.bsky.social" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url: "https://bsky.social/oauth/authorize?request_uri=example",
  });
  expect(authorize.mock.calls[0]?.[0]).toBe("alice.bsky.social");
  expect(setCookie).toHaveBeenCalled();
});
test("rejects password payloads and cross-origin requests", async () => {
  const passwordResponse = await POST(
    request({ appPassword: "secret", handle: "alice.bsky.social" })
  );
  expect(passwordResponse.status).toBe(400);
  const crossOrigin = await POST(
    request({ handle: "alice.bsky.social" }, "https://evil.example")
  );
  expect(crossOrigin.status).toBe(403);
  expect(authorize).not.toHaveBeenCalled();
});
