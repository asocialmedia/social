import { describe, expect, test } from "bun:test";

import { mapConcurrent } from "./map-concurrent";

describe("mapConcurrent", () => {
  test("keeps work bounded and preserves input order", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapConcurrent([4, 3, 2, 1], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(value);
      active -= 1;
      return value * 2;
    });

    expect(peak).toBe(2);
    expect(results).toEqual([8, 6, 4, 2]);
  });

  test("stops scheduling after a mapper failure and waits for active work", async () => {
    const started: number[] = [];
    let active = 0;
    const pending = mapConcurrent([0, 1, 2, 3], 2, async (value) => {
      started.push(value);
      active += 1;
      await Bun.sleep(1);
      active -= 1;
      if (value === 0) {
        throw new Error("mapper failed");
      }
      return value;
    });

    await expect(pending).rejects.toThrow("mapper failed");
    expect(started).toEqual([0, 1]);
    expect(active).toBe(0);
  });

  test("rejects an invalid concurrency limit", async () => {
    await expect(
      mapConcurrent([1], 0, async (value) => {
        await Bun.sleep(1);
        return value;
      })
    ).rejects.toThrow("concurrency must be a positive integer");
  });
});
