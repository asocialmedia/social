import { expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/components/posts/editor/post-editor", () => ({
  default: () => <form />,
}));
const { default: HomeComposer } = await import("./home-composer");

test("a loading editor keeps the surrounding feed visible inside its own boundary", () => {
  const html = renderToStaticMarkup(
    <section>
      <h1>Feed</h1>
      <HomeComposer />
      <p>Existing posts</p>
    </section>
  );
  expect(html).toContain("Feed</h1>");
  expect(html).toContain('aria-label="Loading composer"');
  expect(html).toContain("Existing posts</p>");
  expect(html).toContain("size-12 shrink-0");
});
