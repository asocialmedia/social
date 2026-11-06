import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import Spinner3D from "./spinner-3d";

test("navigation and video pending states expose the illustrated accessible loader", () => {
  const html = renderToStaticMarkup(<Spinner3D className="size-5" />);
  expect(html).toContain('aria-label="Loading"');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("motion-reduce:animate-none");
  expect(html).toContain("size-5");
});
