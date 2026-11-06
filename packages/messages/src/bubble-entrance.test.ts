import { describe, expect, test } from "bun:test";

import { BubbleEntranceRegistry } from "./bubble-entrance";

describe("live bubble entrances", () => {
  test("history mounts are still, while an explicitly registered arrival animates", () => {
    const entrances = new BubbleEntranceRegistry();
    expect(entrances.isPending("history", 100)).toBe(false);
    entrances.register("new", 100);
    expect(entrances.isPending("new", 110)).toBe(true);
    // Reads during Strict Mode rendering do not consume the arrival.
    expect(entrances.isPending("new", 110)).toBe(true);
  });

  test("recycling and a duplicate server echo cannot replay a consumed arrival", () => {
    const entrances = new BubbleEntranceRegistry();
    entrances.register("sent", 100);
    entrances.consume("sent");
    entrances.register("sent", 200);
    expect(entrances.isPending("sent", 210)).toBe(false);
  });

  test("a duplicate does not extend the deadline for an offscreen or delayed row", () => {
    const entrances = new BubbleEntranceRegistry();
    entrances.register("offscreen", 100);
    entrances.register("offscreen", 2000);
    expect(entrances.isPending("offscreen", 2099)).toBe(true);
    expect(entrances.isPending("offscreen", 2100)).toBe(false);
    expect(entrances.isPending("offscreen", 90)).toBe(false);
  });

  test("retention stays bounded during a long live conversation", () => {
    const entrances = new BubbleEntranceRegistry();
    for (let index = 0; index < 1000; index += 1) {
      entrances.register(String(index), 100);
    }
    expect(entrances.isPending("871", 110)).toBe(false);
    expect(entrances.isPending("872", 110)).toBe(true);
    expect(entrances.isPending("999", 110)).toBe(true);
  });

  test("consuming an unregistered history row never grants entrance eligibility", () => {
    const entrances = new BubbleEntranceRegistry();
    entrances.consume("history");
    expect(entrances.isPending("history")).toBe(false);
  });
});
