import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import Spinner3D from "./spinner-3d";

test("navigation and video pending states retain the custom raised rotating ring", () => {
  const html = renderToStaticMarkup(<Spinner3D className="size-5" />);
  expect(html).toContain("conic-gradient");
  expect(html).toContain("animate-spin");
  expect(html).toContain("size-5");
  expect(html).not.toContain("animate-pulse");
});
