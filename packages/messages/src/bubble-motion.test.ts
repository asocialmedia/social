import { expect, test } from "bun:test";

import { BubbleEntranceRegistry } from "./bubble-entrance";
import {
  BUBBLE_MOTION,
  BUBBLE_SPRING_EASING,
  bubbleLaunchOffset,
  bubbleSpringProgress,
} from "./bubble-motion";

test("both springs settle with a restrained overshoot and a bounded lifetime", () => {
  for (const direction of ["outgoing", "incoming"] as const) {
    const { duration } = BUBBLE_MOTION[direction];
    const samples = Array.from({ length: 101 }, (_, index) =>
      bubbleSpringProgress(direction, (index / 100) * duration)
    );
    expect(samples[0]).toBe(0);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(1.06);
    expect(Math.abs(1 - samples[100])).toBeLessThan(0.002);
    expect(BUBBLE_SPRING_EASING[direction]).toStartWith("linear(0,");
    expect(BUBBLE_SPRING_EASING[direction]).toEndWith(", 1)");
  }
});

test("composer launch follows its source with capped travel for long messages and resized screens", () => {
  expect(
    bubbleLaunchOffset({ x: 310, y: 700 }, { bottom: 650, right: 300 })
  ).toEqual({ x: 10, y: 50 });
  expect(
    bubbleLaunchOffset({ x: -1000, y: 3000 }, { bottom: 650, right: 300 })
  ).toEqual({ x: -24, y: 72 });
  expect(
    bubbleLaunchOffset({ x: 3000, y: -1000 }, { bottom: 650, right: 300 })
  ).toEqual({ x: 24, y: 24 });
  expect(
    bubbleLaunchOffset({ x: Number.NaN, y: 10 }, { bottom: 650, right: 300 })
  ).toEqual({ x: 12, y: 48 });
});

test("a launch source is retained until consumed and duplicate acknowledgements cannot replace it", () => {
  const registry = new BubbleEntranceRegistry();
  registry.register("sent", 100, { x: 300, y: 700 });
  registry.register("sent", 101, { x: 200, y: 500 });
  expect(registry.getOrigin("sent")).toEqual({ x: 300, y: 700 });
  registry.consume("sent");
  expect(registry.getOrigin("sent")).toBeUndefined();
  registry.register("sent", 102, { x: 200, y: 500 });
  expect(registry.isPending("sent", 103)).toBe(false);
});
