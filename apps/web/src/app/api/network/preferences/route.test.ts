import { beforeEach, describe, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "user-123" } };
let rateAllowed = true;
let conflict = false;
let savedPreferences: unknown = null;

class NetworkPreferenceConflictError extends Error {
  override name = "NetworkPreferenceConflictError";
}

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));

mock.module("@asm/db", () => ({
  NetworkPreferenceConflictError,
  consumeRateLimit: () => Promise.resolve({ allowed: rateAllowed }),
  getNetworkSettings: (_userId: string) =>
    Promise.resolve({
      catalog: [],
      persona: {
        avoidedTopics: [],
        learnedInterests: [],
        relatedInterests: [],
        signalCount: 0,
      },
      preferences: {
        activeProfileId: "default",
        avoidedTopics: [],
        language: "all",
        profiles: [
          {
            description: "Default profile",
            id: "default",
            interests: ["tech"],
            name: "Default",
          },
        ],
        region: "auto",
        showExplicitContent: false,
      },
      revision: 1,
    }),
  saveNetworkPreferences: (
    userId: string,
    preferences: unknown,
    revision: number
  ) => {
    if (conflict) {
      throw new NetworkPreferenceConflictError("Conflict saving preferences");
    }
    savedPreferences = { preferences, revision, userId };
    return Promise.resolve();
  },
}));

const { GET, PUT } = await import("./route");

describe("GET /api/network/preferences", () => {
  beforeEach(() => {
    session = { user: { id: "user-123" } };
  });

  test("returns 401 when unauthenticated", async () => {
    session = null;
    const response = await GET();
    expect(response.status).toBe(401);
  });

  test("returns network settings for authenticated user", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.revision).toBe(1);
    expect(data.preferences.profiles[0].id).toBe("default");
  });
});

describe("PUT /api/network/preferences", () => {
  beforeEach(() => {
    session = { user: { id: "user-123" } };
    rateAllowed = true;
    conflict = false;
    savedPreferences = null;
  });

  test("returns 401 when unauthenticated", async () => {
    session = null;
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: JSON.stringify({
          preferences: {
            activeProfileId: "default",
            avoidedTopics: [],
            language: "all",
            profiles: [
              {
                description: "Default profile",
                id: "default",
                interests: ["tech"],
                name: "Default",
              },
            ],
            region: "auto",
            showExplicitContent: false,
          },
          revision: 1,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(401);
  });

  test("returns 403 when origin header mismatches or sec-fetch-site is cross-site", async () => {
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          origin: "http://malicious.test",
        },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(403);
  });

  test("returns 429 when rate limit is exceeded", async () => {
    rateAllowed = false;
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(429);
  });

  test("returns 413 when body exceeds maximum size", async () => {
    const hugeBody = "a".repeat(33_000);
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: hugeBody,
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(413);
  });

  test("returns 400 when body is not valid JSON", async () => {
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: "not json",
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  test("returns 400 when preferences schema is invalid", async () => {
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: JSON.stringify({ preferences: { invalid: true }, revision: 1 }),
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  test("returns 409 when revision conflict occurs", async () => {
    conflict = true;
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: JSON.stringify({
          preferences: {
            activeProfileId: "default",
            avoidedTopics: [],
            language: "all",
            profiles: [
              {
                description: "Default profile",
                id: "default",
                interests: ["tech"],
                name: "Default",
              },
            ],
            region: "auto",
            showExplicitContent: false,
          },
          revision: 0,
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(409);
  });

  test("saves preferences and returns updated settings on success", async () => {
    const validPrefs = {
      activeProfileId: "default",
      avoidedTopics: ["politics"],
      language: "all",
      profiles: [
        {
          description: "Default profile",
          id: "default",
          interests: ["tech"],
          name: "Default",
        },
      ],
      region: "auto",
      showExplicitContent: false,
    };
    const request = new Request(
      "http://localhost:3000/api/network/preferences",
      {
        body: JSON.stringify({
          preferences: validPrefs,
          revision: 1,
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "PUT",
      }
    );
    const response = await PUT(request);
    expect(response.status).toBe(200);
    expect(savedPreferences).not.toBeNull();
  });
});
