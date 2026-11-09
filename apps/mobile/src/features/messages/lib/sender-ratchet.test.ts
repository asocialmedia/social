import { describe, expect, test } from "bun:test";

import { createSenderRatchet } from "./sender-ratchet";

describe("sender ratchet", () => {
  test("concurrent sends reserve distinct indexes", () => {
    const ratchet = createSenderRatchet();
    expect(ratchet.reserve("c", 4)).toBe(4);
    expect(ratchet.reserve("c", 4)).toBe(5);
  });

  test("an anchored window's low floor never lowers the counter", () => {
    const ratchet = createSenderRatchet();
    ratchet.observe("c", 41);
    expect(ratchet.reserve("c", 3)).toBe(42);
  });

  test("a window that knows more than the counter wins", () => {
    const ratchet = createSenderRatchet();
    expect(ratchet.reserve("c", 9)).toBe(9);
  });

  test("conversations are independent and forget clears all", () => {
    const ratchet = createSenderRatchet();
    ratchet.observe("a", 7);
    expect(ratchet.reserve("b", 0)).toBe(0);
    ratchet.forget();
    expect(ratchet.reserve("a", 0)).toBe(0);
  });

  test("invalid indexes are ignored", () => {
    const ratchet = createSenderRatchet();
    ratchet.observe("c", -1);
    ratchet.observe("c", Number.NaN);
    expect(ratchet.reserve("c", 0)).toBe(0);
  });
});
