import { describe, expect, test } from "bun:test";

import { HttpError } from "@/features/media-upload/lib/retry";

import {
  duplicatePostId,
  isInFlightConflict,
  runPublishFlow,
} from "./publish-flow";

const noWait = () => Promise.resolve();

function sequence<T>(steps: (() => Promise<T>)[]) {
  let call = 0;
  const send = () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    if (!step) {
      return Promise.reject(new Error("no step"));
    }
    return step();
  };
  return { calls: () => call, send };
}

describe("conflict parsing", () => {
  test("reads a duplicate post id", () => {
    expect(
      duplicatePostId(
        new HttpError("x", 409, { error: "duplicate", postId: "p1" })
      )
    ).toBe("p1");
    expect(
      duplicatePostId(new HttpError("x", 409, { error: "in-flight" }))
    ).toBeNull();
    expect(
      duplicatePostId(new HttpError("x", 400, { postId: "p1" }))
    ).toBeNull();
  });

  test("recognizes an in-flight twin", () => {
    expect(
      isInFlightConflict(new HttpError("x", 409, { error: "in-flight" }))
    ).toBe(true);
    expect(isInFlightConflict(new TypeError("Network"))).toBe(false);
  });
});

describe("runPublishFlow", () => {
  test("returns the created post", async () => {
    const { send } = sequence([() => Promise.resolve({ id: "p1" })]);
    expect(await runPublishFlow(send, { wait: noWait })).toEqual({
      kind: "created",
      post: { id: "p1" },
    });
  });

  test("retries a dropped connection with the same key and resolves to the landed post", async () => {
    const flow = sequence<{ id: string }>([
      () => Promise.reject(new TypeError("Network request failed")),
      () =>
        Promise.reject(
          new HttpError("dup", 409, { error: "duplicate", postId: "p1" })
        ),
    ]);
    const outcome = await runPublishFlow(flow.send, {
      retryBaseMs: 1,
      wait: noWait,
    });
    expect(outcome).toEqual({ kind: "duplicate", postId: "p1" });
    expect(flow.calls()).toBe(2);
  });

  test("waits out an in-flight twin without spending retries", async () => {
    const waits: number[] = [];
    const flow = sequence<{ id: string }>([
      () => Promise.reject(new HttpError("busy", 409, { error: "in-flight" })),
      () => Promise.reject(new HttpError("busy", 409, { error: "in-flight" })),
      () => Promise.resolve({ id: "p2" }),
    ]);
    const outcome = await runPublishFlow(flow.send, {
      inFlightWaitMs: 5,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(outcome).toEqual({ kind: "created", post: { id: "p2" } });
    expect(waits).toEqual([5, 5]);
  });

  test("gives up on an endless in-flight twin", async () => {
    const flow = sequence<{ id: string }>([
      () => Promise.reject(new HttpError("busy", 409, { error: "in-flight" })),
    ]);
    const failing = runPublishFlow(flow.send, {
      maxInFlightWaits: 2,
      wait: noWait,
    });
    await expect(failing).rejects.toThrow("busy");
    expect(flow.calls()).toBe(3);
  });

  test("surfaces a rule violation immediately", async () => {
    const flow = sequence<{ id: string }>([
      () => Promise.reject(new HttpError("Join this community first", 400)),
    ]);
    await expect(runPublishFlow(flow.send, { wait: noWait })).rejects.toThrow(
      "Join this community first"
    );
    expect(flow.calls()).toBe(1);
  });
});
