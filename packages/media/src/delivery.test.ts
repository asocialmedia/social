import { describe, expect, test } from "bun:test";

import {
  acceptsAvif,
  imageVariantForWidth,
  selectImageDerivative,
} from "./delivery";

describe("delivery selection", () => {
  test("keeps enough decoded pixels for the display and avoids missing tiny rungs", () => {
    expect(imageVariantForWidth(600)).toBe("sm-webp.webp");
    expect(imageVariantForWidth(790)).toBe("md-webp.webp");
    expect(imageVariantForWidth(900)).toBe("lg-webp.webp");
    expect(imageVariantForWidth(900, 500)).toBe("orig-img-webp.webp");
  });
  test("only negotiates AVIF when explicitly accepted", () => {
    expect(acceptsAvif("image/avif,image/webp,*/*")).toBe(true);
    expect(acceptsAvif("image/avif;q=0,image/webp")).toBe(false);
    expect(acceptsAvif("*/*")).toBe(false);
  });
  test("chooses the next covering size, then the largest available derivative", () => {
    const rows = [
      { kind: "thumb", variant: "webp" },
      { kind: "md", variant: "webp" },
      { kind: "orig-img", variant: "webp" },
    ];
    expect(selectImageDerivative(rows, "sm", "webp", false)?.kind).toBe("md");
    expect(selectImageDerivative(rows, "lg", "webp", false)?.kind).toBe(
      "orig-img"
    );
    expect(
      selectImageDerivative(rows.slice(0, 2), "lg", "webp", false)?.kind
    ).toBe("md");
  });
  test("does not transfer a larger modern encode or change non-image derivatives", () => {
    const rows = [
      { kind: "md", sizeBytes: 100, variant: "webp" },
      { kind: "md", sizeBytes: 150, variant: "avif" },
    ];
    expect(selectImageDerivative(rows, "md", "webp", true)?.variant).toBe(
      "webp"
    );
    expect(
      selectImageDerivative(
        [
          { kind: "md", sizeBytes: 50, variant: "avif" },
          { kind: "md", sizeBytes: 100, variant: "webp" },
        ],
        "md",
        "webp",
        true
      )?.variant
    ).toBe("avif");
    expect(selectImageDerivative(rows, "mp4", "h264", true)).toBeUndefined();
  });
});
