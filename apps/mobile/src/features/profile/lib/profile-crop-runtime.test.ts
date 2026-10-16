import { expect, test } from "bun:test";

import { version as reactVersion } from "react";
import { version as rendererVersion } from "react-dom";

test("the profile crop DOM renderer matches React", () => {
  expect(rendererVersion).toBe(reactVersion);
});
