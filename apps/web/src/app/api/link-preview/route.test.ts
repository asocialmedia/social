import { beforeEach, expect, mock, test } from "bun:test";

import type { LinkEmbed } from "@/lib/link-embeds/shared";

let allowed = true;
let embed: LinkEmbed | null = null;
const resolve = mock(() => Promise.resolve(embed));
mock.module("@asm/db", () => ({
  consumeRateLimit: () => Promise.resolve({ allowed }),
  getClientIpFromHeaders: () => "test-reader",
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve({ user: { id: "viewer" } }),
}));
mock.module("@/lib/link-embeds/server", () => ({ resolveLinkEmbed: resolve }));
const { GET } = await import("./route");
beforeEach(() => {
  allowed = true;
  embed = null;
  resolve.mockClear();
});

test("a valid URL without usable metadata returns a cacheable successful miss", async () => {
  const response = await GET(
    new Request(
      "https://asocialmedia.cc/api/link-preview?url=https://example.com"
    )
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ embed: null });
  expect(response.headers.get("cache-control")).toBe("private, max-age=600");
});

test("invalid input is still rejected before resolving", async () => {
  const response = await GET(
    new Request(
      "https://asocialmedia.cc/api/link-preview?url=javascript:alert(1)"
    )
  );
  expect(response.status).toBe(422);
  expect(resolve).not.toHaveBeenCalled();
});

test("rate limits still reject requests", async () => {
  allowed = false;
  const response = await GET(
    new Request(
      "https://asocialmedia.cc/api/link-preview?url=https://example.com"
    )
  );
  expect(response.status).toBe(429);
  expect(resolve).not.toHaveBeenCalled();
});
