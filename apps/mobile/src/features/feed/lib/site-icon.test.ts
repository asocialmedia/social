import { expect, test } from "bun:test";

import { siteIconUrl } from "./site-icon";

test("favicons use the API proxy and disclose only the hostname", () => {
  const icon = siteIconUrl(
    "https://asm.test/",
    "https://user:password@indielabrador.com/game?id=private#secret"
  );
  const proxy = new URL(icon ?? "");
  expect(proxy.origin).toBe("https://asm.test");
  expect(proxy.pathname).toBe("/api/link-preview/image");
  const target = new URL(proxy.searchParams.get("url") ?? "");
  expect(target.hostname).toBe("www.google.com");
  expect(target.searchParams.get("domain")).toBe("indielabrador.com");
  expect(icon).not.toContain("password");
  expect(icon).not.toContain("private");
});

test("malformed and non-web links do not request favicons", () => {
  for (const url of [
    "bad-url",
    "mailto:test@example.com",
    "file:///etc/passwd",
    "data:text/plain,test",
  ]) {
    expect(siteIconUrl("https://asm.test", url)).toBeNull();
  }
});
