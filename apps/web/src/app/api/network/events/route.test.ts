import { beforeEach, describe, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "user-123" } };
let rateAllowed = true;
const recordedSignals: unknown[] = [];
const removedSignals: unknown[] = [];
let verifiedReceipt: unknown = null;

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));

mock.module("@/lib/recommendations/network-observation", () => ({
  verifyNetworkObservation: () =>
    verifiedReceipt
      ? Promise.resolve(verifiedReceipt)
      : Promise.reject(new Error("Invalid token")),
}));

mock.module("@asm/db", () => ({
  consumeRateLimit: () => Promise.resolve({ allowed: rateAllowed }),
  readNetworkPreferences: (_userId: string) =>
    Promise.resolve({
      preferences: {
        activeProfileId: "profile-1",
        avoidedTopics: [],
        language: "all",
        profiles: [
          { description: "", id: "profile-1", interests: [], name: "Main" },
        ],
        region: "auto",
        showExplicitContent: false,
      },
      revision: 2,
    }),
  recordNetworkSignal: (
    userId: string,
    profileId: string,
    signal: unknown,
    postId: string,
    publicContent: boolean
  ) => {
    recordedSignals.push({ postId, profileId, publicContent, signal, userId });
    return Promise.resolve(true);
  },
  removeNetworkSignal: (
    userId: string,
    profileId: string,
    kind: string,
    postId: string
  ) => {
    removedSignals.push({ kind, postId, profileId, userId });
    return Promise.resolve(true);
  },
}));

const { POST } = await import("./route");

describe("POST /api/network/events", () => {
  beforeEach(() => {
    session = { user: { id: "user-123" } };
    rateAllowed = true;
    recordedSignals.length = 0;
    removedSignals.length = 0;
    verifiedReceipt = {
      authorId: "author-1",
      hasImage: false,
      hasVideo: false,
      postId: "post-1",
      profileId: "profile-1",
      publicContent: true,
      revision: 2,
      source: "asm",
      topics: ["tech"],
    };
  });

  test("returns 401 when unauthenticated", async () => {
    session = null;
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({ events: [] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  test("returns 403 when origin header mismatches", async () => {
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({ events: [] }),
      headers: {
        "Content-Type": "application/json",
        origin: "http://attacker.test",
      },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  test("returns 429 when rate limit is exceeded", async () => {
    rateAllowed = false;
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({ events: [] }),
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(429);
  });

  test("returns 400 when body does not match schema", async () => {
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({ events: [] }), // min 1 event required
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  test("records valid engagement events and returns accepted count", async () => {
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({
        events: [
          {
            durationMs: 6000,
            eventType: "DWELL",
            networkToken: "valid-token",
          },
          {
            eventType: "VOTE",
            networkToken: "valid-token",
          },
        ],
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.accepted).toBe(2);
    expect(recordedSignals.length).toBe(2);
  });

  test("ignores DWELL events shorter than 5000ms", async () => {
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({
        events: [
          {
            durationMs: 3000,
            eventType: "DWELL",
            networkToken: "valid-token",
          },
        ],
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.accepted).toBe(0);
    expect(recordedSignals.length).toBe(0);
  });

  test("handles REMOVE_DOWNVOTE / REMOVE_NOT_INTERESTED by calling removeNetworkSignal", async () => {
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({
        events: [
          {
            eventType: "REMOVE_DOWNVOTE",
            networkToken: "valid-token",
          },
        ],
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.accepted).toBe(1);
    expect(removedSignals.length).toBe(1);
    expect((removedSignals[0] as { kind: string }).kind).toBe("downvote");
  });

  test("rejects events where observation token is invalid or revision does not match", async () => {
    verifiedReceipt = null; // invalid token
    const request = new Request("http://localhost:3000/api/network/events", {
      body: JSON.stringify({
        events: [
          {
            eventType: "VOTE",
            networkToken: "invalid-token",
          },
        ],
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:3000",
      },
      method: "POST",
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.accepted).toBe(0);
  });
});
