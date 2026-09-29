import { describe, expect, test } from "bun:test";

import { createHistoryReadCoordinator } from "./history-read-coordinator";

describe("history read coordinator", () => {
  test("a fresh coordinator is idle", () => {
    const coordinator = createHistoryReadCoordinator();
    expect(coordinator.isBusy()).toBe(false);
  });

  test("a held token blocks background work until it is released", async () => {
    const coordinator = createHistoryReadCoordinator();
    const token = coordinator.acquire();
    expect(coordinator.isBusy()).toBe(true);

    let idle = false;
    const waiting = coordinator.whenIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    coordinator.release(token);
    await waiting;
    expect(idle).toBe(true);
    expect(coordinator.isBusy()).toBe(false);
  });

  test("whenIdle on an idle coordinator resumes without a release", async () => {
    const coordinator = createHistoryReadCoordinator();
    let idle = false;
    const waiting = coordinator.whenIdle().then(() => {
      idle = true;
    });
    // Not synchronous: a caller that loops on this must not be able to spin a
    // tight synchronous cycle through an already-idle wait.
    expect(idle).toBe(false);
    await waiting;
    expect(idle).toBe(true);
  });

  test("every holder must release, and one holder releasing early does not unblock", async () => {
    const coordinator = createHistoryReadCoordinator();
    const first = coordinator.acquire();
    const second = coordinator.acquire();

    let idle = false;
    const waiting = coordinator.whenIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();

    coordinator.release(first);
    await Promise.resolve();
    expect(idle).toBe(false);

    coordinator.release(second);
    await waiting;
    expect(idle).toBe(true);
  });

  // The leak the token shape exists to prevent: a superseded jump's teardown is
  // skipped so it cannot clear a newer jump's state, so it never releases. A
  // counter would stay above zero for the rest of the session and hold the walk
  // off forever.
  test("releasing a token twice cannot unblock a newer holder", async () => {
    const coordinator = createHistoryReadCoordinator();
    const stale = coordinator.acquire();
    const live = coordinator.acquire();

    let idle = false;
    const waiting = coordinator.whenIdle().then(() => {
      idle = true;
    });

    coordinator.release(stale);
    coordinator.release(stale);
    await Promise.resolve();
    expect(idle).toBe(false);
    expect(coordinator.isBusy()).toBe(true);

    coordinator.release(live);
    await waiting;
    expect(idle).toBe(true);
  });

  test("releasing a token that was never taken is a no-op", () => {
    const coordinator = createHistoryReadCoordinator();
    coordinator.release(9999);
    expect(coordinator.isBusy()).toBe(false);
  });

  test("an abort releases a waiting background read", async () => {
    const coordinator = createHistoryReadCoordinator();
    const controller = new AbortController();
    const token = coordinator.acquire();
    const waiting = coordinator.whenIdle(controller.signal);
    controller.abort();
    await waiting;
    // The holder is still there: an abort ends the WAIT, it does not pretend
    // the user-initiated read finished.
    expect(coordinator.isBusy()).toBe(true);
    coordinator.release(token);
    expect(coordinator.isBusy()).toBe(false);
  });

  test("whenIdle on an already-aborted signal returns at once", async () => {
    const coordinator = createHistoryReadCoordinator();
    const controller = new AbortController();
    controller.abort();
    coordinator.acquire();
    await coordinator.whenIdle(controller.signal);
  });

  test("reset drops holds whose owners are gone", async () => {
    const coordinator = createHistoryReadCoordinator();
    coordinator.acquire();
    coordinator.acquire();
    coordinator.reset();
    expect(coordinator.isBusy()).toBe(false);
    await coordinator.whenIdle();
  });

  test("many waiters are all woken by one release", async () => {
    const coordinator = createHistoryReadCoordinator();
    const token = coordinator.acquire();
    let woken = 0;
    const waits = [
      coordinator.whenIdle().then(() => {
        woken += 1;
      }),
      coordinator.whenIdle().then(() => {
        woken += 1;
      }),
      coordinator.whenIdle().then(() => {
        woken += 1;
      }),
    ];
    await Promise.resolve();
    expect(woken).toBe(0);
    coordinator.release(token);
    await Promise.all(waits);
    expect(woken).toBe(3);
  });

  test("a waiter that re-waits after being woken queues again", async () => {
    const coordinator = createHistoryReadCoordinator();
    const first = coordinator.acquire();
    const woken: number[] = [];
    // The background loop shape: wait, then wait again for the next token.
    const loop = (async () => {
      for (let round = 0; round < 2; round += 1) {
        // oxlint-disable-next-line no-await-in-loop -- the loop is the unit under test
        await coordinator.whenIdle();
        woken.push(round);
      }
    })();
    await Promise.resolve();
    coordinator.release(first);
    await Promise.resolve();
    await Promise.resolve();
    const second = coordinator.acquire();
    expect(woken).toEqual([0]);
    coordinator.release(second);
    await loop;
    expect(woken).toEqual([0, 1]);
  });
});
