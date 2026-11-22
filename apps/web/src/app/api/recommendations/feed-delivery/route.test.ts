import { beforeEach, expect, mock, test } from "bun:test";

let signedIn = true;
let allowed = true;
const report = mock();
mock.module("@asm/db", () => ({
  consumeRateLimit: () => Promise.resolve({ allowed, retryAfterSeconds: 10 }),
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(signedIn ? { user: { id: "reader" } } : null),
}));
mock.module("@/lib/recommendations/feed-authority", () => ({
  reportFeedMix: report,
}));

const { POST } = await import("./route");
const valid = {
  client: "mobile",
  durationMs: 120,
  mode: "personalized",
  sources: ["asm", "bluesky", "bluesky", "asm"],
};
const request = (body: unknown = valid, headers?: HeadersInit) =>
  new Request("http://localhost/api/recommendations/feed-delivery", {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });

beforeEach(() => {
  signedIn = true;
  allowed = true;
  report.mockClear();
});

test("accepts a bounded aggregate with no post or account identifiers", async () => {
  const response = await POST(request());
  expect(response.status).toBe(204);
  expect(report).toHaveBeenCalledWith(valid);
  const excess = await POST(
    request({ ...valid, sources: Array.from({ length: 21 }, () => "asm") })
  );
  expect(excess.status).toBe(400);
  const untrusted = await POST(request({ ...valid, userId: "private" }));
  expect(untrusted.status).toBe(400);
  expect(report).toHaveBeenCalledTimes(1);
});

test("rejects cross-site, anonymous, and excessive telemetry", async () => {
  const crossSite = await POST(
    request(valid, { "sec-fetch-site": "cross-site" })
  );
  expect(crossSite.status).toBe(403);
  signedIn = false;
  const anonymous = await POST(request());
  expect(anonymous.status).toBe(401);
  signedIn = true;
  allowed = false;
  const limited = await POST(request());
  expect(limited.status).toBe(429);
  expect(report).not.toHaveBeenCalled();
});
