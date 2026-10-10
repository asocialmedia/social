import { describe, expect, test } from "bun:test";

import {
  classifySessionRefresh,
  SessionConnection,
} from "./session-connection";
import type { SessionRefreshResult } from "./session-connection";

function deferred<T>() {
  return Promise.withResolvers<T>();
}

function fixture(refresh: () => Promise<SessionRefreshResult>) {
  const events: string[] = [];
  const connection = new SessionConnection({
    connect: () => {
      events.push("connect");
      return Promise.resolve();
    },
    onExpired: () => {
      events.push("expired");
    },
    refresh,
    sessionId: "current",
  });
  return { connection, events };
}

describe("native session reconnect", () => {
  test("cold start waits for cookie renewal before opening the stream", async () => {
    const renewal = deferred<SessionRefreshResult>();
    const { connection, events } = fixture(() => renewal.promise);
    const pending = connection.resume();
    expect(events).toEqual([]);
    renewal.resolve({ sessionId: "current", status: "valid" });
    await pending;
    expect(events).toEqual(["connect"]);
  });

  test("a stale-cookie stream 401 retries after successful revalidation", async () => {
    const { connection, events } = fixture(() =>
      Promise.resolve({ sessionId: "current", status: "valid" })
    );
    expect(
      await connection.confirmUnauthorized(new AbortController().signal)
    ).toBe(true);
    expect(events).toEqual([]);
  });

  test("offline reopening retains the session and allows transport backoff", async () => {
    const { connection, events } = fixture(() =>
      Promise.resolve({ status: "unavailable" })
    );
    await connection.resume();
    expect(
      await connection.confirmUnauthorized(new AbortController().signal)
    ).toBe(true);
    expect(events).toEqual(["connect"]);
  });

  test("confirmed expiry ends the session without opening a stream", async () => {
    const { connection, events } = fixture(() =>
      Promise.resolve({ status: "expired" })
    );
    await connection.resume();
    expect(events).toEqual(["expired"]);
  });

  test("confirmed revocation on a live stream stops retries", async () => {
    const { connection, events } = fixture(() =>
      Promise.resolve({ status: "expired" })
    );
    expect(
      await connection.confirmUnauthorized(new AbortController().signal)
    ).toBe(false);
    expect(events).toEqual(["expired"]);
  });

  test("backgrounding while renewal is in flight cannot open a stale stream", async () => {
    const renewal = deferred<SessionRefreshResult>();
    const { connection, events } = fixture(() => renewal.promise);
    const pending = connection.resume();
    connection.suspend();
    renewal.resolve({ sessionId: "current", status: "valid" });
    await pending;
    expect(events).toEqual([]);
  });

  test("repeated foreground transitions only connect the latest attempt", async () => {
    const renewal = deferred<SessionRefreshResult>();
    const { connection, events } = fixture(() => renewal.promise);
    const first = connection.resume();
    const second = connection.resume();
    renewal.resolve({ sessionId: "current", status: "valid" });
    await Promise.all([first, second]);
    expect(events).toEqual(["connect"]);
  });

  test("an account change cannot reconnect or revoke the previous identity", async () => {
    const { connection, events } = fixture(() =>
      Promise.resolve({ sessionId: "other", status: "valid" })
    );
    await connection.resume();
    expect(
      await connection.confirmUnauthorized(new AbortController().signal)
    ).toBe(false);
    expect(events).toEqual([]);
  });

  test("an aborted 401 confirmation cannot sign out after leaving the screen", async () => {
    const renewal = deferred<SessionRefreshResult>();
    const { connection, events } = fixture(() => renewal.promise);
    const controller = new AbortController();
    const pending = connection.confirmUnauthorized(controller.signal);
    controller.abort();
    renewal.resolve({ status: "expired" });
    expect(await pending).toBe(false);
    expect(events).toEqual([]);
  });
});

describe("session revalidation response", () => {
  const cached = { session: { id: "current" } };
  test("returns the server-confirmed identity", () => {
    expect(
      classifySessionRefresh({
        data: cached,
        error: null,
        isPending: false,
        isRefetching: false,
      })
    ).toEqual({ sessionId: "current", status: "valid" });
  });
  test("a completed empty response confirms expiry", () => {
    expect(
      classifySessionRefresh({
        data: null,
        error: null,
        isPending: false,
        isRefetching: false,
      })
    ).toEqual({ status: "expired" });
  });
  test("a server 401 confirms expiry", () => {
    expect(
      classifySessionRefresh({
        data: null,
        error: { status: 401 },
        isPending: false,
        isRefetching: false,
      })
    ).toEqual({ status: "expired" });
  });
  test("a cancelled or superseded refresh cannot invalidate a cached session", () => {
    expect(
      classifySessionRefresh({
        data: cached,
        error: null,
        isPending: false,
        isRefetching: true,
      })
    ).toEqual({ status: "unavailable" });
  });
  test("a server outage retains the identity without claiming it was revalidated", () => {
    expect(
      classifySessionRefresh({
        data: cached,
        error: { status: 503 },
        isPending: false,
        isRefetching: false,
      })
    ).toEqual({ status: "unavailable" });
  });
});
