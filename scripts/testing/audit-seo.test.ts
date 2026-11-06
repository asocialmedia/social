import { expect, test } from "bun:test";

import { inspectSeoHtml, sitemapLocations } from "./audit-seo";

test("SEO audit ignores metadata strings embedded in scripts and recognizes streamed noindex", () => {
  const result = inspectSeoHtml(
    `<html><head><title>Public post</title><meta content="index, follow" name="robots"><link href="https://asocialmedia.cc/posts/test" rel="canonical"></head><body><article>Visible post</article><meta name="robots" content="noindex"><script>const fake = '<link rel="canonical" href="https://wrong.test">';</script></body></html>`
  );
  expect(result.canonicals).toEqual(["https://asocialmedia.cc/posts/test"]);
  expect(result.noindex).toBe(true);
  expect(result.hasArticle).toBe(true);
});

test("sitemap sampling excludes image locations and decodes query separators", () => {
  expect(
    sitemapLocations(
      "<url><loc>https://asocialmedia.cc/posts/abc?a=1&amp;b=2</loc><image:loc>https://media.test/image.jpg</image:loc></url>"
    )
  ).toEqual(["https://asocialmedia.cc/posts/abc?a=1&b=2"]);
});
