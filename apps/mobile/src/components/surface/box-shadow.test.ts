import { describe, expect, test } from "bun:test";

import { splitBoxShadow } from "./box-shadow";

describe("splitBoxShadow", () => {
  test("separates inset and outer layers, keeping rgba commas intact", () => {
    const shadows =
      "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 3px 5px rgba(0, 0, 0, 0.12)";
    expect(splitBoxShadow(shadows)).toEqual({
      inset:
        "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5)",
      outer: "0 0 0 1px rgba(170, 60, 0, 0.95), 0 3px 5px rgba(0, 0, 0, 0.12)",
    });
  });

  test("handles a list with only one kind of layer", () => {
    expect(splitBoxShadow("0 1px 2px rgba(0, 0, 0, 0.05)")).toEqual({
      inset: "",
      outer: "0 1px 2px rgba(0, 0, 0, 0.05)",
    });
    expect(splitBoxShadow("inset 0 1px 1px rgba(255, 255, 255, 0.6)")).toEqual({
      inset: "inset 0 1px 1px rgba(255, 255, 255, 0.6)",
      outer: "",
    });
  });
});
