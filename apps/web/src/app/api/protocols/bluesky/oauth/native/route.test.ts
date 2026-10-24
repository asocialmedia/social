import { beforeEach, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

mock.module("server-only", () => ({}));
const values = new Map<string, string>();
const jar = new Map<string, string>();
let user: { id: string; email: string; emailVerified: boolean } | null;
let oauthState = "";
const finish = mock(() => Promise.resolve());
mock.module("@asm/db", () => ({
  redis: {
    get: (key: string) => Promise.resolve(values.get(key) ?? null),
    getdel: (key: string) => {
      const value = values.get(key);
      values.delete(key);
      return Promise.resolve(value ?? null);
    },
    set: (key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve("OK");
    },
  },
}));
mock.module("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      delete: (key: string) => jar.delete(key),
      get: (key: string) =>
        jar.has(key) ? { value: jar.get(key) } : undefined,
      set: (key: string, value: string) => jar.set(key, value),
    }),
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(user ? { user } : null),
}));
mock.module("@/lib/protocols/gateway", () => ({
  consumeProtocolBudget: () => Promise.resolve(),
}));
mock.module("@/lib/auth/account-notices", () => ({
  accountNotices: { socialAccount: () => Promise.resolve() },
  noticeTimestamp: () => "now",
  queueNotice: () => {},
}));
mock.module("@/lib/protocols/oauth", () => ({
  blueskyOAuthOrigin: () => "http://localhost:3000",
  createBlueskyOAuthClient: () => ({
    authorize: (_handle: string, options: { state: string }) => {
      oauthState = options.state;
      return Promise.resolve(new URL("https://provider.test/authorize"));
    },
    callback: () =>
      Promise.resolve({
        session: {
          did: "did:plc:alice",
          fetchHandler: () =>
            Promise.resolve(Response.json({ handle: "alice.test" })),
        },
        state: oauthState,
      }),
  }),
  finishBlueskyOAuth: finish,
}));
const { GET, POST } = await import("./route");
const { nativeBlueskyCallback } = await import("@/lib/protocols/native-oauth");
const origin = "http://localhost:3000/api/protocols/bluesky/oauth/native";
const verifier = "a-secure-client-generated-verifier-that-is-long-enough";
const state = "ef3da2e9-1a2d-493e-9daf-05b3e4a8908a";
const issue = {
  challenge: createHash("sha256").update(verifier).digest("hex"),
  handle: "alice.test",
  state,
};
const post = (body: unknown) =>
  POST(
    new Request(origin, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
async function authorize() {
  const start = await post(issue);
  const launch = (await start.json()) as { url: string };
  expect(await responseStatus(GET(new Request(launch.url)))).toBe(303);
  const callback = await nativeBlueskyCallback(
    new Request(
      "http://localhost:3000/api/protocols/bluesky/oauth/callback?code=provider-code"
    )
  );
  expect(callback?.status).toBe(303);
  const returned = new URL(callback?.headers.get("location") ?? "");
  return { launch, returned };
}
beforeEach(() => {
  values.clear();
  jar.clear();
  finish.mockClear();
  user = { email: "alice@example.test", emailVerified: true, id: "alice" };
});

test("native launch, browser nonce, opaque return and authenticated verifier exchange form a one-use round trip", async () => {
  const { launch, returned } = await authorize();
  expect(returned.protocol).toBe("asocialmedia:");
  expect(returned.searchParams.get("state")).toBe(state);
  expect(returned.searchParams.has("access_token")).toBe(false);
  expect(finish).not.toHaveBeenCalled();
  expect(await responseStatus(GET(new Request(launch.url)))).toBe(410);
  const body = { code: returned.searchParams.get("code"), verifier };
  expect(await responseStatus(post(body))).toBe(200);
  expect(finish).toHaveBeenCalledWith("alice", "did:plc:alice", "alice.test");
  expect(await responseStatus(post(body))).toBe(410);
});
test("a different user or wrong verifier cannot consume the originating app's authorization", async () => {
  const { returned } = await authorize();
  const code = returned.searchParams.get("code");
  user = { email: "bob@example.test", emailVerified: true, id: "bob" };
  expect(await responseStatus(post({ code, verifier }))).toBe(403);
  user = { email: "alice@example.test", emailVerified: true, id: "alice" };
  expect(
    await responseStatus(post({ code, verifier: `${verifier}-wrong` }))
  ).toBe(403);
  expect(finish).not.toHaveBeenCalled();
  expect(await responseStatus(post({ code, verifier }))).toBe(200);
});
test("requires verified authentication and leaves ordinary web callbacks alone", async () => {
  user = null;
  expect(await responseStatus(post(issue))).toBe(401);
  user = { email: "alice@example.test", emailVerified: false, id: "alice" };
  expect(await responseStatus(post(issue))).toBe(403);
  expect(await nativeBlueskyCallback(new Request(origin))).toBeNull();
});

async function responseStatus(pending: Promise<Response>) {
  const response = await pending;
  return response.status;
}
