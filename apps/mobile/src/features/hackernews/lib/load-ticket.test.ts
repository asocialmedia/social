import { describe, expect, test } from "bun:test";

import { createLoadTicket } from "./load-ticket";

describe("createLoadTicket", () => {
  test("a later load retires an earlier one, whichever settles first", () => {
    const ticket = createLoadTicket();
    const first = ticket.begin();
    const second = ticket.begin();

    // The old response arriving late must not write.
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  test("cancel retires the load in flight without starting another", () => {
    const ticket = createLoadTicket();
    const inFlight = ticket.begin();

    ticket.cancel();

    expect(inFlight()).toBe(false);
  });

  test("current observes without retiring, so an append survives its own read", () => {
    const ticket = createLoadTicket();
    const append = ticket.current();
    expect(append()).toBe(true);
    // Taking a fresh ticket does not disturb the append's own check until the
    // first page it belongs to is actually replaced.
    const firstPage = ticket.begin();
    expect(append()).toBe(false);
    expect(firstPage()).toBe(true);
  });

  test("every ticket from a series ends up with exactly one survivor", () => {
    const ticket = createLoadTicket();
    const checks = [ticket.begin(), ticket.begin(), ticket.begin()];
    expect(checks.map((check) => check())).toEqual([false, false, true]);
  });
});
