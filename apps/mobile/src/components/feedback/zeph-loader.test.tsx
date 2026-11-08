import { describe, expect, mock, test } from "bun:test";

mock.module("react-native", () => ({ View: "View" }));
mock.module("./spinner-3d", () => ({ Spinner3D: "Spinner3D" }));

const { ZephLoader } = await import("./zeph-loader");

describe("shared native loading indicator", () => {
  test("uses the custom spinner for every loading context", () => {
    for (const variant of [
      "general",
      "security",
      "media",
      "messages",
      "search",
    ] as const) {
      const element = ZephLoader({ accessibilityLabel: "Signing in", variant });
      expect(element?.props.accessibilityLabel).toBe("Signing in");
      expect(element?.props.accessibilityRole).toBe("progressbar");
      expect(element?.props.children.type).toBe("Spinner3D");
      expect(element?.props.children.props.size).toBe(24);
    }
  });

  test("preserves size and stopped-state behavior", () => {
    expect(ZephLoader({ animating: false })).toBeNull();
    const stopped = ZephLoader({
      animating: false,
      hidesWhenStopped: false,
      size: 18,
    });
    expect(stopped?.props.children.props.animating).toBe(false);
    expect(stopped?.props.children.props.size).toBe(18);
    expect(ZephLoader({ size: "large" })?.props.children.props.size).toBe(56);
  });
});
