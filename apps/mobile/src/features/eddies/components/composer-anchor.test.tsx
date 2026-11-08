import { expect, mock, test } from "bun:test";

mock.module("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  View: "View",
}));
const { ComposerAnchor } = await import("./composer-anchor");

test("thread clearance includes the keyboard only when the viewport has not resized", () => {
  for (const [viewportBottom, keyboardTop, lift] of [
    [952, 616, 336],
    [616, 616, 0],
    [952, null, 0],
  ] as const) {
    const heights: number[] = [];
    const anchor = ComposerAnchor({
      keyboardTop,
      onHeightChange: (height) => heights.push(height),
      viewportBottom,
    });
    expect(anchor.props.style[1].paddingBottom).toBe(lift);
    anchor.props.onLayout({ nativeEvent: { layout: { height: 64 + lift } } });
    expect(heights).toEqual([64 + lift]);
    // The detail screen adds this clearance to its thread's bottom padding.
    expect(heights[0] - lift).toBe(64);
  }
});
