import { describe, expect, test } from "bun:test";

import { newContentLabel } from "./new-content-label";

describe("newContentLabel", () => {
  test("singular and plural", () => {
    expect(newContentLabel(1)).toBe("1 new post");
    expect(newContentLabel(2)).toBe("2 new posts");
  });

  test("caps the visible count at 20+ like web", () => {
    expect(newContentLabel(20)).toBe("20 new posts");
    expect(newContentLabel(21)).toBe("20+ new posts");
  });
});
