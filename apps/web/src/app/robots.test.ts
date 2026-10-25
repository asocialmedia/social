import { expect, test } from "bun:test";

import robots from "./robots";

test("crawlers can read auth noindex directives and public media while private surfaces stay blocked", () => {
  const result = robots();
  expect(result.sitemap).toBe("https://asocialmedia.cc/sitemap.xml");
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
  const publicRule = rules.find((rule) => rule.userAgent === "*");
  expect(publicRule?.allow).toContain("/api/media/");
  expect(publicRule?.disallow).toContain("/messages");
  expect(publicRule?.disallow).not.toContain("/login");
  expect(publicRule?.disallow).not.toContain("/signup");
  expect(publicRule?.disallow).not.toContain("/reset-password");
});
