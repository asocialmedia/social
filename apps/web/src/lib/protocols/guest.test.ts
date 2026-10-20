import { afterAll, beforeAll, expect, test } from "bun:test";

import { protocolGuest } from "./guest";

const original = process.env.PROTOCOLS_GUEST_SECRET;
beforeAll(() => {
  process.env.PROTOCOLS_GUEST_SECRET =
    crypto.randomUUID() + crypto.randomUUID();
});
afterAll(() => {
  if (original === undefined) {
    delete process.env.PROTOCOLS_GUEST_SECRET;
  } else {
    process.env.PROTOCOLS_GUEST_SECRET = original;
  }
});
test("guests behind one network receive independent signed browsing identities", () => {
  const request = new Request(
    "http://localhost/api/protocols/bluesky/discover"
  );
  const first = protocolGuest(request);
  const second = protocolGuest(request);
  expect(first.identity).not.toBe(second.identity);
  expect(first.cookie).toContain("HttpOnly; SameSite=Lax");
  const returning = protocolGuest(
    new Request(request, {
      headers: { cookie: first.cookie?.split(";")[0] ?? "" },
    })
  );
  expect(returning.identity).toBe(first.identity);
  expect(returning.cookie).toBeUndefined();
});
test("tampered or expired guest cookies cannot choose a rate-limit identity", () => {
  const now = Date.now();
  const request = new Request(
    "http://localhost/api/protocols/bluesky/discover"
  );
  const first = protocolGuest(request, now);
  const cookie = first.cookie?.split(";")[0] ?? "";
  const tampered = protocolGuest(
    new Request(request, {
      headers: { cookie: cookie.replace(first.identity, crypto.randomUUID()) },
    }),
    now
  );
  const expired = protocolGuest(
    new Request(request, { headers: { cookie } }),
    now + 86_400_001
  );
  expect(tampered.identity).not.toBe(first.identity);
  expect(expired.identity).not.toBe(first.identity);
});

test("search cookies are scoped across APIs and cannot reuse a protocol-cookie signature", () => {
  const request = new Request("http://localhost/api/search/spotlight");
  const protocol = protocolGuest(request);
  const supplied = (protocol.cookie?.split(";")[0] ?? "").replace(
    "asm_protocol_guest=",
    "asm_search_guest="
  );
  const search = protocolGuest(
    new Request(request, { headers: { cookie: supplied } }),
    Date.now(),
    { cookieName: "asm_search_guest", path: "/api" }
  );
  expect(search.identity).not.toBe(protocol.identity);
  expect(search.cookie).toContain("Path=/api;");
  const returning = protocolGuest(
    new Request(request, {
      headers: { cookie: search.cookie?.split(";")[0] ?? "" },
    }),
    Date.now(),
    { cookieName: "asm_search_guest", path: "/api" }
  );
  expect(returning.identity).toBe(search.identity);
});
