import { beforeEach, expect, mock, test } from "bun:test";

let signedIn = true;
let allowed = true;
let offline = false;
const reads: unknown[] = [];
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(signedIn ? { user: { id: "reader" } } : null),
}));
mock.module("@asm/db", () => ({
  consumeRateLimit: () => Promise.resolve({ allowed }),
  knowledgeTopicPage: (options: unknown) => {
    reads.push(options);
    return offline
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({
          aliases: [],
          items: [
            {
              aliases: [],
              id: "Provider topic",
              label: "Provider topic",
              source: "wikimedia",
            },
          ],
          parent: null,
          partial: false,
        });
  },
  networkTopicCatalog: () => Promise.resolve([]),
}));
const { GET } = await import("./route");
beforeEach(() => {
  signedIn = true;
  allowed = true;
  offline = false;
  reads.length = 0;
});

test("authenticated autocomplete and expansion forward bounded queries to the dynamic catalog", async () => {
  const response = await GET(
    new Request("http://localhost/api/network/topics?q=provider")
  );
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.items[0].label).toBe("Provider topic");
  expect(reads[0]).toEqual({ parent: undefined, query: "provider" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const nested = await GET(
    new Request(
      "http://localhost/api/network/topics?parent=Category%3AProvider"
    )
  );
  expect(nested.status).toBe(200);
  expect(reads[1]).toEqual({ parent: "Category:Provider", query: "" });
});

test("guest, malformed and throttled requests never call the provider", async () => {
  signedIn = false;
  const guest = await GET(new Request("http://localhost/api/network/topics"));
  expect(guest.status).toBe(401);
  signedIn = true;
  const malformed = await GET(
    new Request(`http://localhost/api/network/topics?q=${"x".repeat(65)}`)
  );
  expect(malformed.status).toBe(400);
  allowed = false;
  const throttled = await GET(
    new Request("http://localhost/api/network/topics")
  );
  expect(throttled.status).toBe(429);
  expect(reads).toEqual([]);
});

test("provider failure stays retryable when no local suggestions are available", async () => {
  offline = true;
  const response = await GET(
    new Request("http://localhost/api/network/topics")
  );
  expect(response.status).toBe(503);
});
