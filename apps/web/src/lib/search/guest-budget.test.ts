import { afterAll, expect, mock, test } from "bun:test";

let signedIn = false;
let wait = 0;
let offline = false;
const identities: string[] = [];
const evaluate = mock((_script: string, _count: number, minuteKey: string) => {
  identities.push(minuteKey);
  return offline
    ? Promise.reject(new Error("Redis offline"))
    : Promise.resolve(wait);
});
mock.module("@asm/db", () => ({
  getClientIpFromHeaders: () => "192.0.2.1",
  getTrustedIngressIp: () => "192.0.2.1",
  hashViewerId: () => "hashed-ingress",
  redis: { eval: evaluate },
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(signedIn ? { user: { id: "signed-viewer" } } : null),
}));
const original = process.env.PROTOCOLS_GUEST_SECRET;
process.env.PROTOCOLS_GUEST_SECRET = crypto.randomUUID() + crypto.randomUUID();
afterAll(() => {
  if (original === undefined) {
    delete process.env.PROTOCOLS_GUEST_SECRET;
  } else {
    process.env.PROTOCOLS_GUEST_SECRET = original;
  }
});
const { guestSearchBudget } = await import("./guest-budget");

test("a signed guest identity shares the search budget across both sources", async () => {
  const first = await guestSearchBudget(
    new Request("http://localhost/api/search/spotlight?q=software")
  );
  expect(first.response).toBeNull();
  const cookie = first.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("asm_search_guest=");
  expect(cookie).toContain("HttpOnly; SameSite=Lax; Path=/api");
  const returning = await guestSearchBudget(
    new Request("http://localhost/api/protocols/bluesky/search?q=software", {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    })
  );
  expect(returning.response).toBeNull();
  expect(identities.at(-1)).toBe(identities.at(-2));
  expect(returning.headers.get("set-cookie")).toBeNull();
});

test("guest limits return a retry hint while signed-in users keep their existing limits", async () => {
  wait = 17;
  const denied = await guestSearchBudget(
    new Request("http://localhost/api/search/spotlight?q=software")
  );
  expect(denied.response?.status).toBe(429);
  expect(denied.headers.get("retry-after")).toBe("17");
  const count = evaluate.mock.calls.length;
  signedIn = true;
  const allowed = await guestSearchBudget(
    new Request("http://localhost/api/search/spotlight?q=software")
  );
  expect(allowed.response).toBeNull();
  expect(evaluate.mock.calls.length).toBe(count);
  signedIn = false;
  wait = 0;
});

test("guests fail closed with a retryable response when the budget store is unavailable", async () => {
  offline = true;
  try {
    const result = await guestSearchBudget(
      new Request("http://localhost/api/search/spotlight?q=software")
    );
    expect(result.response?.status).toBe(503);
    expect(result.headers.get("retry-after")).toBe("1");
  } finally {
    offline = false;
  }
});
