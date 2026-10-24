import { beforeEach, expect, mock, test } from "bun:test";

let signedIn = true;
let connected = false;
const writes: unknown[] = [];
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(signedIn ? { user: { id: "asm-reader" } } : null),
}));
mock.module("@asm/db", () => ({
  getClientIpFromHeaders: () => "127.0.0.1",
  getTrustedIngressIp: () => "127.0.0.1",
  hashViewerId: () => "viewer",
  prisma: {
    orm: {
      public: {
        Accounts: {
          where: (where: unknown) => {
            expect(where).toEqual({
              providerId: "bluesky",
              userId: "asm-reader",
            });
            return {
              first: () =>
                Promise.resolve(
                  connected
                    ? {
                        accountId: "did:plc:owner",
                        idToken: "encrypted-session",
                      }
                    : null
                ),
            };
          },
        },
      },
    },
  },
}));
mock.module("@/lib/protocols/budget", () => ({
  ProtocolBudgetError: class extends Error {},
  consumeProtocolBudget: () => Promise.resolve(),
}));
mock.module("@/lib/protocols/oauth", () => ({
  blueskyConnectionPermissions: (saved: string | undefined) => ({
    canLike: Boolean(saved),
    canReply: Boolean(saved),
    connected: Boolean(saved),
  }),
  blueskyOAuthLexClient: (id: string, did: string) => {
    expect(id).toBe("asm-reader");
    expect(did).toBe("did:plc:owner");
    return Promise.resolve({ did });
  },
}));
mock.module("@/lib/protocols/bluesky-like", () => ({
  blueskyLike: (_client: unknown, uri: string, active?: boolean) => {
    writes.push({ active, uri });
    return Promise.resolve({ liked: active ?? true, likes: 12 });
  },
}));
const { GET, POST } = await import("./route");
const uri = "at://did:plc:source/app.bsky.feed.post/example";
const request = (body: unknown, headers?: HeadersInit) =>
  new Request("http://localhost/api/protocols/bluesky/likes", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
beforeEach(() => {
  signedIn = true;
  connected = false;
  writes.length = 0;
});
test("guest and unlinked state cannot create a remote like", async () => {
  signedIn = false;
  const unauthorized = await POST(request({ active: true, uri }));
  expect(unauthorized.status).toBe(401);
  const guest = await GET(
    new Request("http://localhost/api/protocols/bluesky/likes")
  );
  expect(await guest.json()).toEqual({
    canLike: false,
    canReply: false,
    connected: false,
    did: null,
  });
  signedIn = true;
  const unlinked = await POST(request({ active: true, uri }));
  expect(unlinked.status).toBe(409);
  expect(writes).toHaveLength(0);
});
test("linked likes use the authenticated account and reject cross-origin or injected ownership", async () => {
  connected = true;
  const injectedOwner = await POST(
    request({ active: true, did: "did:plc:other", uri })
  );
  expect(injectedOwner.status).toBe(400);
  const crossOrigin = await POST(
    request({ active: true, uri }, { origin: "https://evil.test" })
  );
  expect(crossOrigin.status).toBe(403);
  const response = await POST(request({ active: true, uri }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ liked: true, likes: 12 });
  expect(writes).toEqual([{ active: true, uri }]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
