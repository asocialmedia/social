import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { CommentsThreadView } from "./comments-thread-view";

test("native and external discussions share composer, empty, and row spacing", () => {
  const html = renderToStaticMarkup(
    <CommentsThreadView
      loading={false}
      failed={false}
      empty
      composer={<div>Editor</div>}
    >
      <div>Comment row</div>
    </CommentsThreadView>
  );
  expect(html).toContain('aria-label="Eddies on asocialmedia"');
  expect(html).toContain('class="space-y-4"');
  expect(html).toContain("No eddie yet.");
  expect(html).toContain("divide-border/40 divide-y pt-1");
});

test("loading uses the shared thread skeleton before exposing the editor", () => {
  const html = renderToStaticMarkup(
    <CommentsThreadView
      loading
      failed={false}
      empty={false}
      composer={<div>Editor</div>}
    >
      {null}
    </CommentsThreadView>
  );
  expect(html).not.toContain("Editor");
  expect(html).toContain("animate-pulse");
});
