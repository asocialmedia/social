import { expect, test } from "bun:test";

import { requireLoadConnectionCapacity } from "./network-load-config";

test("load reports account for Bun's default fetch connection bound", () => {
  expect(requireLoadConnectionCapacity(32)).toBe(256);
  expect(() => requireLoadConnectionCapacity(1000)).toThrow(
    "BUN_CONFIG_MAX_HTTP_REQUESTS=1000"
  );
  expect(requireLoadConnectionCapacity(1000, "1000")).toBe(1000);
});

test.each(["", "NaN", "0", "65536", "1.5"])(
  "invalid load connection limit %j fails before creating fixtures",
  (limit) => {
    expect(() => requireLoadConnectionCapacity(1, limit)).toThrow(
      "must be an integer"
    );
  }
);
