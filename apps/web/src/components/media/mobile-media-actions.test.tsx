import { expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { MobileMediaActions, MOBILE_MEDIA_ICON } from "./mobile-media-actions";

test("mobile media keeps Eddies and voting together with share and bookmark on the right", () => {
  const html = renderToStaticMarkup(
    <MobileMediaActions
      comments={4}
      onOpenEddies={mock()}
      vote={<button type="button">Amplify</button>}
      share={
        <button className={MOBILE_MEDIA_ICON} type="button">
          Share
        </button>
      }
      bookmark={
        <button className={MOBILE_MEDIA_ICON} type="button">
          Bookmark
        </button>
      }
    />
  );
  expect(html).toContain('aria-label="View eddies"');
  expect(html).toContain("media-viewer-chip");
  expect(html).toContain(">4</span>");
  expect(html.indexOf("Amplify")).toBeLessThan(html.indexOf("Share"));
  expect(html.indexOf("Share")).toBeLessThan(html.indexOf("Bookmark"));
});
