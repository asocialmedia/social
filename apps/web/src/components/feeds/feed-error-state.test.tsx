import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { FeedErrorState } from "./feed-error-state";

test("feed failures show the error illustration, an accessible message and a raised retry action", () => {
  const html = renderToStaticMarkup(
    <FeedErrorState message="Couldn’t load Gusts." onRetry={() => {}} />
  );
  expect(html).toContain("error");
  expect(html).toContain('role="alert"');
  expect(html).toContain("btn-3d");
  expect(html).toContain("Try again");
});
