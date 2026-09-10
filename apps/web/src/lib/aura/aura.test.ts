import { describe, expect, test } from "bun:test";

import { getAuraFlameClass } from "./aura";

describe("getAuraFlameClass", () => {
  test("zero aura is hollow (stroke only, no fill)", () => {
    const classes = getAuraFlameClass(0);
    expect(classes).toContain("text-orange-500");
    expect(classes).not.toContain("fill");
  });

  test("negative aura is filled pastel purple", () => {
    expect(getAuraFlameClass(-1)).toBe("fill-[#a78bfa] text-[#a78bfa]");
  });

  test("positive aura up to 500 is filled orange", () => {
    expect(getAuraFlameClass(1)).toBe("fill-orange-500 text-orange-500");
    expect(getAuraFlameClass(500)).toBe("fill-orange-500 text-orange-500");
  });

  test("aura past 500 is a darker orange", () => {
    expect(getAuraFlameClass(501)).toBe("fill-orange-600 text-orange-600");
    expect(getAuraFlameClass(1000)).toBe("fill-orange-600 text-orange-600");
  });

  test("aura past 1k is pastel red", () => {
    expect(getAuraFlameClass(1001)).toBe("fill-[#f87171] text-[#f87171]");
    expect(getAuraFlameClass(10_000)).toBe("fill-[#f87171] text-[#f87171]");
  });

  test("aura past 10k is pastel yellow", () => {
    expect(getAuraFlameClass(10_001)).toBe("fill-[#fde047] text-[#fde047]");
    expect(getAuraFlameClass(999_999)).toBe("fill-[#fde047] text-[#fde047]");
  });
});
