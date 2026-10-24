import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ExploreMasonry } from "./explore-masonry";

test("each live column owns its loading cards immediately after its content", () => {
  const html = renderToStaticMarkup(
    <ExploreMasonry loading scope="test">
      {["first", "second", "third"].map((id) => (
        <article key={id}>{id}</article>
      ))}
    </ExploreMasonry>
  );
  expect(html.match(/data-masonry-column=/g)).toHaveLength(2);
  expect(html.match(/aria-label="Loading more recommendations"/g)).toHaveLength(
    2
  );
  const firstColumnEnd = html.indexOf('data-masonry-column="1"');
  expect(html.indexOf("<article>third</article>")).toBeLessThan(
    html.indexOf('aria-busy="true"')
  );
  expect(html.indexOf('aria-busy="true"')).toBeLessThan(firstColumnEnd);
});
