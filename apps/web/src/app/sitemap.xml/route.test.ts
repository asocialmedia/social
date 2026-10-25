import { expect, test } from "bun:test";

import { GET } from "./route";

test("the sitemap index returns XML synchronously without content queries", async () => {
  const response = GET();
  expect(response).toBeInstanceOf(Response);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "application/xml; charset=utf-8"
  );
  const xml = await response.text();
  expect(xml).toContain("<sitemapindex");
  expect(xml).toContain("https://asocialmedia.cc/sitemaps/posts.xml");
  expect(xml).toContain("https://asocialmedia.cc/sitemaps/gusts.xml");
  expect(xml.match(/<sitemap>/g)).toHaveLength(6);
});
