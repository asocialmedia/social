import { describe, expect, test } from "bun:test";

import { SingleFlight } from "./single-flight";

describe("SingleFlight", () => {
  test("collapses concurrent calls for the same key into one task", async () => {
    const singleFlight = new SingleFlight();
    let started = 0;
    const task = () => {
      started += 1;
    };

    const first = singleFlight.run("alice", task);
    // Registration is synchronous, so this call joins the first one instead of
    // starting a second request for the same profile.
    const second = singleFlight.run("alice", task);
    expect(second).toBe(first);
    expect(singleFlight.has("alice")).toBe(true);

    await Promise.all([first, second]);
    // One task, not two, and the key is released once it settles.
    expect(started).toBe(1);
    expect(singleFlight.has("alice")).toBe(false);
  });

  test("runs a new task for the same key once the previous one settled", async () => {
    const singleFlight = new SingleFlight();
    let started = 0;
    const task = () => {
      started += 1;
    };

    await singleFlight.run("alice", task);
    // A prefetch that already landed must not block the screen's own fetch.
    expect(singleFlight.has("alice")).toBe(false);
    await singleFlight.run("alice", task);
    expect(started).toBe(2);
  });

  test("releases the key when the task rejects so a retry is possible", async () => {
    const singleFlight = new SingleFlight();
    let started = 0;
    const failing = () => {
      started += 1;
      throw new Error("offline");
    };

    const first = singleFlight.run("alice", failing);
    expect(singleFlight.has("alice")).toBe(true);
    await first.catch(() => {});

    // Cleared by the rejection, so the retry really does start a new task
    // instead of awaiting the already-failed one.
    expect(singleFlight.has("alice")).toBe(false);
    expect(started).toBe(1);
    await singleFlight.run("alice", failing).catch(() => {});
    expect(started).toBe(2);
  });

  // Regression: a task that throws synchronously used to run the cleanup
  // before its entry was stored, leaving the key stuck in the map so every
  // later call joined the already-failed promise and silently did nothing.
  test("does not wedge the key when a task throws synchronously", async () => {
    const singleFlight = new SingleFlight();
    let attempts = 0;
    const failing = () => {
      attempts += 1;
      throw new Error("offline");
    };

    await singleFlight.run("alice", failing).catch(() => {});
    expect(singleFlight.has("alice")).toBe(false);

    await singleFlight.run("alice", failing).catch(() => {});
    expect(attempts).toBe(2);
  });

  test("keeps different keys independent", async () => {
    const singleFlight = new SingleFlight();
    let started = 0;
    const task = () => {
      started += 1;
    };

    await Promise.all([
      singleFlight.run("alice", task),
      singleFlight.run("bob", task),
    ]);
    expect(started).toBe(2);
    expect(singleFlight.size).toBe(0);
  });
});
