import { describe, expect, test } from "bun:test";

import { drainSseFrames, readSseStream } from "./sse-stream";

describe("drainSseFrames", () => {
  test("reads a complete frame and keeps an incomplete tail", () => {
    const result = drainSseFrames(
      'event: comment\ndata: {"a":1}\n\nevent: comm'
    );
    expect(result.frames).toEqual([{ data: '{"a":1}', event: "comment" }]);
    // The second frame has no blank-line terminator yet.
    expect(result.rest).toBe("event: comm");
  });

  test("a frame split across two chunks is not lost", () => {
    const first = drainSseFrames('event: comment\ndata: {"kin');
    expect(first.frames).toEqual([]);
    const second = drainSseFrames(`${first.rest}d":"created"}\n\n`);
    expect(second.frames).toEqual([
      { data: '{"kind":"created"}', event: "comment" },
    ]);
  });

  test("handles several frames in one chunk and CRLF line endings", () => {
    const result = drainSseFrames(
      "event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n"
    );
    expect(result.frames.map((frame) => frame.event)).toEqual(["a", "b"]);
  });

  test("drops a frame with no data line", () => {
    expect(drainSseFrames("event: comment\n\n").frames).toEqual([]);
  });
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index] ?? ""));
      index += 1;
    },
  });
}

describe("readSseStream", () => {
  test("delivers only frames matching the requested event name", async () => {
    const seen: unknown[] = [];
    // Abort from inside the handler: the stream ends naturally, and stopping
    // there proves no reconnect was scheduled behind the assertions.
    const controller = new AbortController();
    await readSseStream({
      baseFetch: (() =>
        Promise.resolve(
          new Response(
            streamOf([
              'event: other\ndata: {"n":1}\n\n',
              'event: comment\ndata: {"n":2}\n\n',
            ])
          )
        )) as unknown as typeof fetch,
      eventName: "comment",
      onEvent: (_event, data) => {
        seen.push(data);
        controller.abort();
      },
      signal: controller.signal,
      url: "https://api.test/stream",
    });
    expect(seen).toEqual([{ n: 2 }]);
  });

  test("a malformed frame is dropped without killing the stream", async () => {
    const seen: unknown[] = [];
    const controller = new AbortController();
    await readSseStream({
      baseFetch: (() =>
        Promise.resolve(
          new Response(
            streamOf([
              "event: comment\ndata: not json\n\n",
              'event: comment\ndata: {"ok":true}\n\n',
            ])
          )
        )) as unknown as typeof fetch,
      eventName: "comment",
      onEvent: (_event, data) => {
        seen.push(data);
        controller.abort();
      },
      signal: controller.signal,
      url: "https://api.test/stream",
    });
    expect(seen).toEqual([{ ok: true }]);
  });

  test("a non-ok response is treated as a drop, not a fatal error", async () => {
    const statuses: string[] = [];
    await readSseStream({
      baseFetch: (() =>
        Promise.resolve(
          new Response("nope", { status: 502 })
        )) as unknown as typeof fetch,
      eventName: "comment",
      onEvent: () => {},
      onStatusChange: (status) => statuses.push(status),
      // Abort immediately so the retry timer never fires.
      signal: AbortSignal.abort(),
      url: "https://api.test/stream",
    });
    // An already-aborted signal must not open a connection at all.
    expect(statuses).toEqual(["closed"]);
  });

  test("sends the session cookie so the stream is authenticated", async () => {
    let sent: Record<string, string> = {};
    const controller = new AbortController();
    await readSseStream({
      baseFetch: ((_input: RequestInfo | URL, init?: RequestInit) => {
        sent = (init?.headers ?? {}) as Record<string, string>;
        return Promise.resolve(
          new Response(streamOf(["event: comment\ndata: {}\n\n"]))
        );
      }) as unknown as typeof fetch,
      cookie: "session=abc",
      eventName: "comment",
      onEvent: () => controller.abort(),
      signal: controller.signal,
      url: "https://api.test/stream",
    });
    expect(sent.cookie).toBe("session=abc");
  });

  test("a 401 response calls onUnauthorized and stops retrying", async () => {
    let unauthorizedCalled = false;
    const statuses: string[] = [];
    let fetchCount = 0;
    await readSseStream({
      baseFetch: (() => {
        fetchCount += 1;
        return Promise.resolve(new Response("unauthorized", { status: 401 }));
      }) as unknown as typeof fetch,
      eventName: "comment",
      onEvent: () => {},
      onStatusChange: (status) => statuses.push(status),
      onUnauthorized: () => {
        unauthorizedCalled = true;
      },
      url: "https://api.test/stream",
    });
    expect(unauthorizedCalled).toBe(true);
    expect(fetchCount).toBe(1);
    expect(statuses).toEqual(["connecting", "closed"]);
  });
});

test("SSE retries a revalidated 401 with the renewed cookie", async () => {
  const controller = new AbortController();
  const cookies: string[] = [];
  let cookie = "session=old";
  let retry: (() => void) | undefined;
  const seen: unknown[] = [];
  await readSseStream({
    baseFetch: (_url, init) => {
      cookies.push(init.headers.cookie ?? "");
      return Promise.resolve(
        cookies.length === 1
          ? new Response("unauthorized", { status: 401 })
          : new Response(
              streamOf(['event: session-revoked\ndata: {"ok":true}\n\n'])
            )
      );
    },
    clearTimeoutFn: (() => {}) as typeof clearTimeout,
    eventName: "session-revoked",
    getCookie: () => Promise.resolve(cookie),
    onEvent: (_name, data) => {
      seen.push(data);
      controller.abort();
    },
    onUnauthorized: () => {
      cookie = "session=renewed";
      return Promise.resolve(true);
    },
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- the injected timer API is callback based
    setTimeoutFn: ((callback: () => void) => {
      retry = callback;
      return 1;
    }) as unknown as typeof setTimeout,
    signal: controller.signal,
    url: "https://api.test/session-events",
  });
  expect(cookies).toEqual(["session=old"]);
  expect(retry).toBeDefined();
  retry?.();
  // Drain the asynchronous reader without real retry timers.
  await Bun.sleep(0);
  expect(cookies).toEqual(["session=old", "session=renewed"]);
  expect(seen).toEqual([{ ok: true }]);
});
