import { describe, expect, test } from "bun:test";

import { RateBudget } from "./rate-budget";

describe("RateBudget", () => {
  test("lets requests through until the window is full", () => {
    let now = 0;
    const budget = new RateBudget({ limit: 2, now: () => now, windowMs: 1000 });
    expect(budget.delayUntilSlot()).toBe(0);
    now = 10;
    expect(budget.delayUntilSlot()).toBe(0);
  });

  test("waits for the oldest request to age out, serving waiters in order", async () => {
    let now = 0;
    const waits: number[] = [];
    const budget = new RateBudget({
      limit: 2,
      now: () => now,
      wait: (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
      windowMs: 1000,
    });
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((id) => budget.acquire().then(() => order.push(id)))
    );
    expect(order).toEqual([1, 2, 3]);
    expect(waits).toEqual([1000]);
  });
});
