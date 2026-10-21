import { beforeEach, expect, mock, test } from "bun:test";

let user: { emailVerified: boolean; id: string } | null = {
  emailVerified: true,
  id: "alice",
};
let browserNonce: string | undefined;
let returnedState: string;
const nonce = "ef3da2e9-1a2d-493e-9daf-05b3e4a8908a";
const finish = mock(() => Promise.resolve());
const callback = mock(() =>
  Promise.resolve({
    session: {
      did: "did:plc:alice",
      fetchHandler: () =>
        Promise.resolve(Response.json({ handle: "alice.bsky.social" })),
    },
    state: returnedState,
  })
);
mock.module("next/headers", () => ({
  cookies: () => ({ delete: () => {}, get: () => ({ value: browserNonce }) }),
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => (user ? { user } : null),
}));
mock.module("@/lib/protocols/oauth", () => ({
  blueskyOAuthOrigin: () => "http://localhost:3000",
  createBlueskyOAuthClient: () => ({ callback }),
  finishBlueskyOAuth: finish,
}));
mock.module("@/lib/protocols/native-oauth", () => ({
  nativeBlueskyCallback: () => Promise.resolve(null),
}));
const { GET } = await import("./route");
const request = () =>
  new Request(
    "http://localhost:3000/api/protocols/bluesky/oauth/callback?code=example&state=state"
  );
beforeEach(() => {
  user = { emailVerified: true, id: "alice" };
  browserNonce = nonce;
  returnedState = JSON.stringify({ nonce, userId: "alice" });
  finish.mockClear();
  callback.mockClear();
});
test("links only the authenticated browser and user that started OAuth", async () => {
  const response = await GET(request());
  expect(response.headers.get("location")).toContain("bluesky=connected");
  expect(finish).toHaveBeenCalledWith(
    "alice",
    "did:plc:alice",
    "alice.bsky.social"
  );
});
test.each([
  { nonce, userId: "bob" },
  { nonce: "fa59412c-cb83-4a2f-827c-a941ba529de1", userId: "alice" },
])("rejects a mismatched OAuth browser or user (%j)", async (invalidState) => {
  returnedState = JSON.stringify(invalidState);
  const response = await GET(request());
  expect(response.headers.get("location")).toContain("bluesky=error");
  expect(finish).not.toHaveBeenCalled();
});
test("does not exchange a code without the browser cookie", async () => {
  browserNonce = undefined;
  const response = await GET(request());
  expect(response.headers.get("location")).toContain("bluesky=error");
  expect(callback).not.toHaveBeenCalled();
});
test("bridges loopback back to localhost before reading cookies", async () => {
  const response = await GET(
    new Request(
      "http://127.0.0.1:3000/api/protocols/bluesky/oauth/callback?code=example&state=state"
    )
  );
  expect(response.headers.get("location")).toBe(request().url);
  expect(callback).not.toHaveBeenCalled();
});
