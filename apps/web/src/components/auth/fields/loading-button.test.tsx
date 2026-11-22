import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { LoadingButton } from "./loading-button";

test("auth submissions render a 3D spinner and disable the pending button", () => {
  const pending = renderToStaticMarkup(
    <LoadingButton indicator="spinner" loading>
      Sign in
    </LoadingButton>
  );

  expect(pending).toContain('disabled=""');
  expect(pending).toContain('<output aria-label="Loading"');
  expect(pending).toContain("animate-spin");
  expect(pending).toContain("Sign in");
  expect(pending).not.toContain("<img");

  const ready = renderToStaticMarkup(
    <LoadingButton indicator="spinner" loading={false}>
      Sign in
    </LoadingButton>
  );

  expect(ready).not.toContain('disabled=""');
  expect(ready).not.toContain("<output");
});

test("shared callers use the original animated loading icon by default", () => {
  const pending = renderToStaticMarkup(
    <LoadingButton loading>Save</LoadingButton>
  );

  expect(pending).toContain("<svg");
  expect(pending).toContain("animate-spin");
  expect(pending).not.toContain("<img");
});
