import { expect, test } from "bun:test";

import { appPageRoute } from "./site-route-inventory";

test("route inventory includes actual app pages and excludes similarly named components", () => {
  expect(appPageRoute("apps/web/src/app/(docs)/about/page.tsx")).toBe("/about");
  expect(appPageRoute("apps/web/src/app/(main)/page.tsx")).toBe("/");
  expect(appPageRoute("apps\\web\\src\\app\\(main)\\a\\[slug]\\page.tsx")).toBe(
    "/a/[slug]"
  );
  expect(
    appPageRoute("apps/web/src/app/(main)/client-home-page.tsx")
  ).toBeNull();
});
