import { beforeEach, describe, expect, mock, test } from "bun:test";

let session: { user: { emailVerified: boolean; id: string } } | null = {
  user: { emailVerified: true, id: "user-123" },
};

let existingAccount: {
  accountId: string;
  id: string;
  providerId: string;
  userId: string;
} | null = null;

const accountInserts: unknown[] = [];
const accountUpdates: unknown[] = [];

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));

mock.module("@asm/protocols/bluesky", () => ({
  createBlueskySession: (creds: { identifier: string; password: string }) => {
    if (creds.password === "bad-password") {
      return Promise.reject(new Error("Invalid App Password"));
    }
    return Promise.resolve({
      accessJwt: "jwt-token-123",
      did: creds.identifier,
      handle: "alice.bsky.social",
      refreshJwt: "refresh-token-123",
    });
  },
  resolveBlueskyHandle: (handle: string) => {
    if (handle === "unknown.bsky.social") {
      return Promise.reject(new Error("Could not resolve Bluesky handle"));
    }
    return Promise.resolve({ did: "did:plc:alice123" });
  },
}));

mock.module("@asm/db", () => ({
  prisma: {
    orm: {
      public: {
        Accounts: {
          create: (data: unknown) => {
            accountInserts.push(data);
            return Promise.resolve(data);
          },
          where: () => ({
            first: () => Promise.resolve(existingAccount),
            updateAndCount: (data: unknown) => {
              accountUpdates.push(data);
              return Promise.resolve({ count: 1 });
            },
          }),
        },
      },
    },
  },
}));

const { POST } = await import("./route");

const request = (body: unknown) =>
  new Request("http://localhost/api/protocols/bluesky/link", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

beforeEach(() => {
  session = { user: { emailVerified: true, id: "user-123" } };
  existingAccount = null;
  accountInserts.length = 0;
  accountUpdates.length = 0;
});

describe("Bluesky link route", () => {
  test("returns 401 when unauthorized", async () => {
    session = null;
    const response = await POST(request({ handle: "alice.bsky.social" }));
    expect(response.status).toBe(401);
  });

  test("returns 403 when user email is not verified", async () => {
    session = { user: { emailVerified: false, id: "user-123" } };
    const response = await POST(request({ handle: "alice.bsky.social" }));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("verify your email address");
  });

  test("returns 400 on invalid body schema", async () => {
    const response = await POST(request({ handle: "" }));
    expect(response.status).toBe(400);
  });

  test("returns 400 when handle fails resolution", async () => {
    const response = await POST(request({ handle: "unknown.bsky.social" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Could not resolve");
  });

  test("returns 400 when app password is invalid", async () => {
    const response = await POST(
      request({ appPassword: "bad-password", handle: "alice.bsky.social" })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Invalid App Password");
  });

  test("returns 409 when account is already linked to another user", async () => {
    existingAccount = {
      accountId: "did:plc:alice123",
      id: "acc-1",
      providerId: "bluesky",
      userId: "other-user-999",
    };
    const response = await POST(request({ handle: "alice.bsky.social" }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("already linked to another user");
  });

  test("links new account and stores in Accounts table", async () => {
    const response = await POST(
      request({ appPassword: "valid-pass", handle: "@Alice.bsky.social" })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      did: string;
      handle: string;
      hasSession: boolean;
      success: boolean;
    };
    expect(body.success).toBe(true);
    expect(body.handle).toBe("alice.bsky.social");
    expect(body.did).toBe("did:plc:alice123");
    expect(body.hasSession).toBe(true);
    expect(accountInserts.length).toBe(1);
  });

  test("updates existing account when same user relinks", async () => {
    existingAccount = {
      accountId: "did:plc:alice123",
      id: "acc-1",
      providerId: "bluesky",
      userId: "user-123",
    };
    const response = await POST(
      request({ appPassword: "valid-pass", handle: "alice.bsky.social" })
    );
    expect(response.status).toBe(200);
    expect(accountUpdates.length).toBe(1);
    expect(accountInserts.length).toBe(0);
  });
});
