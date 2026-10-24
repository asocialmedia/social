import { describe, expect, test } from "bun:test";

import {
  createAuthenticatedClient,
  createBlueskySession,
  publishBlueskyLike,
  publishBlueskyReply,
  publishBlueskyRepost,
  resolveBlueskyHandle,
} from "./authenticated";

const VALID_CID = "bafyreibfn4d6xedoe6jixkcl266v2fhiwga2x3zzsnq6yawnago2kb5ouu";

describe("Bluesky authenticated client", () => {
  test("creates authenticated client with did and token", () => {
    const client = createAuthenticatedClient({
      accessJwt: "test-token",
      did: "did:plc:test12345",
    });
    expect(client).toBeDefined();
    expect(client.did).toBe("did:plc:test12345");
  });

  test("resolveBlueskyHandle cleans @ prefix and validates handle", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL) => {
      const urlObj = new URL(url.toString());
      expect(urlObj.searchParams.get("handle")).toBe("alice.bsky.social");
      return Response.json({ did: "did:plc:alice123" });
    }) as unknown as typeof fetch;

    try {
      const result = await resolveBlueskyHandle("@Alice.Bsky.Social ");
      expect(result.did).toBe("did:plc:alice123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("resolveBlueskyHandle throws on failed resolution or missing DID", () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (() =>
        new Response("Not found", { status: 404 })) as unknown as typeof fetch;

      expect(resolveBlueskyHandle("nonexistent.test")).rejects.toThrow(
        'Could not resolve Bluesky handle "nonexistent.test": 404'
      );

      globalThis.fetch = (() => Response.json({})) as unknown as typeof fetch;

      expect(resolveBlueskyHandle("empty.test")).rejects.toThrow(
        'No DID returned for handle "empty.test"'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("createBlueskySession creates session on valid credentials", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
      expect(url.toString()).toContain(
        "/xrpc/com.atproto.server.createSession"
      );
      const body = JSON.parse(init?.body as string);
      expect(body.identifier).toBe("alice.bsky.social");
      expect(body.password).toBe("app-pass-1234");
      return Response.json({
        accessJwt: "mock-access-jwt",
        did: "did:plc:alice123",
        handle: "alice.bsky.social",
        refreshJwt: "mock-refresh-jwt",
      });
    }) as unknown as typeof fetch;

    try {
      const session = await createBlueskySession({
        identifier: "@alice.bsky.social",
        password: "app-pass-1234",
      });
      expect(session.accessJwt).toBe("mock-access-jwt");
      expect(session.did).toBe("did:plc:alice123");
      expect(session.handle).toBe("alice.bsky.social");
      expect(session.refreshJwt).toBe("mock-refresh-jwt");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("createBlueskySession throws on invalid credentials with error message", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Response.json(
        { message: "Invalid App Password" },
        {
          headers: { "Content-Type": "application/json" },
          status: 401,
        }
      )) as unknown as typeof fetch;

    try {
      expect(
        createBlueskySession({
          identifier: "alice.bsky.social",
          password: "wrong",
        })
      ).rejects.toThrow("Invalid App Password");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("publishBlueskyReply formats post record and returns URI and CID", async () => {
    const originalFetch = globalThis.fetch;
    let postedRecord: unknown;

    globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
      if (url.toString().includes("com.atproto.repo.createRecord")) {
        postedRecord = JSON.parse(init?.body as string);
        return Response.json({
          cid: VALID_CID,
          uri: "at://did:plc:alice123/app.bsky.feed.post/3mockkey",
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const result = await publishBlueskyReply(
        { accessJwt: "token123", did: "did:plc:alice123" },
        {
          parentCid: VALID_CID,
          parentUri: "at://did:plc:bob456/app.bsky.feed.post/parent123",
          rootCid: VALID_CID,
          rootUri: "at://did:plc:bob456/app.bsky.feed.post/root123",
          text: "Hello from asocialmedia federated reply!",
        }
      );

      expect(result.cid).toBe(VALID_CID);
      expect(result.uri).toBe(
        "at://did:plc:alice123/app.bsky.feed.post/3mockkey"
      );
      expect((postedRecord as { record: { text: string } })?.record?.text).toBe(
        "Hello from asocialmedia federated reply!"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("publishBlueskyLike formats like record and returns URI and CID", async () => {
    const originalFetch = globalThis.fetch;
    let postedRecord: unknown;

    globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
      if (url.toString().includes("com.atproto.repo.createRecord")) {
        postedRecord = JSON.parse(init?.body as string);
        return Response.json({
          cid: VALID_CID,
          uri: "at://did:plc:alice123/app.bsky.feed.like/3likekey",
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const result = await publishBlueskyLike(
        { accessJwt: "token123", did: "did:plc:alice123" },
        {
          cid: VALID_CID,
          uri: "at://did:plc:bob456/app.bsky.feed.post/target123",
        }
      );

      expect(result.cid).toBe(VALID_CID);
      expect(result.uri).toBe(
        "at://did:plc:alice123/app.bsky.feed.like/3likekey"
      );
      expect(
        (postedRecord as { record: { subject: { cid: string } } })?.record
          ?.subject?.cid
      ).toBe(VALID_CID);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("publishBlueskyRepost formats repost record and returns URI and CID", async () => {
    const originalFetch = globalThis.fetch;
    let postedRecord: unknown;

    globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
      if (url.toString().includes("com.atproto.repo.createRecord")) {
        postedRecord = JSON.parse(init?.body as string);
        return Response.json({
          cid: VALID_CID,
          uri: "at://did:plc:alice123/app.bsky.feed.repost/3repostkey",
        });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const result = await publishBlueskyRepost(
        { accessJwt: "token123", did: "did:plc:alice123" },
        {
          cid: VALID_CID,
          uri: "at://did:plc:bob456/app.bsky.feed.post/target123",
        }
      );

      expect(result.cid).toBe(VALID_CID);
      expect(result.uri).toBe(
        "at://did:plc:alice123/app.bsky.feed.repost/3repostkey"
      );
      expect(
        (postedRecord as { record: { subject: { cid: string } } })?.record
          ?.subject?.cid
      ).toBe(VALID_CID);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
