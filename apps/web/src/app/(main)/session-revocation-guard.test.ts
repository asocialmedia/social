import { describe, expect, test } from "bun:test";

import {
  createSharedSessionEvents,
  parseSessionRevocationEvent,
  shouldEndSession,
} from "./session-revocation-guard";

const sleep = (ms: number) => Bun.sleep(ms);

describe("session revocation events", () => {
  test("ends only the session named by a single-session revoke", () => {
    const event = parseSessionRevocationEvent(
      '{"kind":"session.revoked","revokedSessionId":"session-1"}'
    );
    expect(event).not.toBeNull();
    if (!event) {
      return;
    }
    expect(shouldEndSession(event, "session-1")).toBe(true);
    expect(shouldEndSession(event, "session-2")).toBe(false);
  });

  test("keeps only the acting session after ending other devices", () => {
    const event = parseSessionRevocationEvent(
      '{"kind":"session.revoked","retainedSessionId":"session-1"}'
    );
    expect(event).not.toBeNull();
    if (!event) {
      return;
    }
    expect(shouldEndSession(event, "session-1")).toBe(false);
    expect(shouldEndSession(event, "session-2")).toBe(true);
  });

  test("rejects malformed event payloads", () => {
    expect(parseSessionRevocationEvent("not-json")).toBeNull();
    expect(parseSessionRevocationEvent('{"kind":"other"}')).toBeNull();
    expect(
      parseSessionRevocationEvent(
        '{"kind":"session.revoked","retainedSessionId":7}'
      )
    ).toBeNull();
  });
});

describe("shared session events", () => {
  test("a remount within the grace period reuses the live stream", () => {
    const seenUrls: string[] = [];
    let closed = 0;
    const pool = createSharedSessionEvents((url) => {
      seenUrls.push(url);
      return {
        addEventListener() {
          seenUrls.push("listener-added");
        },
        close() {
          closed += 1;
        },
        removeEventListener() {
          seenUrls.push("listener-removed");
        },
      };
    }, 1000);

    // StrictMode-style mount, cleanup, and synchronous remount. Listener
    // attach/detach is the component's job, so the pool only proves the
    // stream itself survives: one factory call, same instance, never closed.
    const first = pool.acquire();
    pool.release();
    const second = pool.acquire();

    expect(second).toBe(first);
    expect(seenUrls).toEqual(["/api/auth/session-events"]);
    expect(closed).toBe(0);

    pool.release();
  });

  test("the stream closes once every holder is gone past the grace period", async () => {
    let closed = 0;
    const pool = createSharedSessionEvents(
      () => ({
        addEventListener() {},
        close() {
          closed += 1;
        },
        removeEventListener() {},
      }),
      20
    );

    pool.acquire();
    pool.acquire();
    pool.release();
    await sleep(60);
    // One holder remains, so the stream must stay open.
    expect(closed).toBe(0);

    pool.release();
    await sleep(60);
    expect(closed).toBe(1);

    // A later mount starts a fresh stream.
    pool.acquire();
    pool.release();
    await sleep(60);
    expect(closed).toBe(2);
  });
});
