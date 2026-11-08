import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import Spinner3D from "./spinner-3d";

test("navigation and video pending states expose the accessible 3D spinner", () => {
  const html = renderToStaticMarkup(<Spinner3D className="size-5" />);
  expect(html).toContain('aria-label="Loading"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("animate-spin");
  expect(html).toContain("motion-reduce:animate-none");
  expect(html).toContain("size-5");
  expect(html).not.toContain("<img");
});
