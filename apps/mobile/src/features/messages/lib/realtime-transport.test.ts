import { expect, test } from "bun:test";

import { readMessageActivityStream, readMessageStream } from "./realtime";
import type { MessageStreamFetch } from "./realtime";

function openStream(
  frame: string,
  observeHeaders: (headers?: Record<string, string>) => void
): MessageStreamFetch {
  return (_url, init) => {
    observeHeaders(init?.headers);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame));
        init?.signal?.addEventListener("abort", () => controller.close(), {
          once: true,
        });
      },
    });
    return Promise.resolve(new Response(body));
  };
}

test("thread events arrive on an open stream and blur abort closes the subscription", async () => {
  const controller = new AbortController();
  let connected = false;
  let received = false;
  const baseFetch = openStream(
    'event: connected\ndata: {}\n\nevent: message\ndata: {"kind":"typing.started","conversationId":"thread","userId":"peer"}\n\n',
    (headers) => {
      expect(headers?.["x-asm-client"]).toBe("mobile");
      expect(headers?.cookie).toBe("session_token=credential");
      expect(headers?.authorization).toBe("Bearer credential");
    }
  );
  await readMessageStream({
    baseFetch,
    cookie: "session_token=credential",
    onConnect: () => {
      connected = true;
    },
    onEvent: (event) => {
      expect(event.kind).toBe("typing.started");
      received = true;
      controller.abort();
    },
    signal: controller.signal,
    url: "https://messages.invalid/stream",
  });
  expect(connected).toBe(true);
  expect(received).toBe(true);
});

test("list activity arrives without waiting for the SSE response to end", async () => {
  const controller = new AbortController();
  let received = false;
  await readMessageActivityStream({
    baseFetch: openStream(
      'event: message-activity\ndata: {"conversationId":"thread","kind":"message.created"}\n\n',
      () => {
        // Authentication is checked in the thread-stream case above.
      }
    ),
    onActivity: () => {
      received = true;
      controller.abort();
    },
    signal: controller.signal,
    url: "https://messages.invalid/events",
  });
  expect(received).toBe(true);
});

test("a half-open socket is aborted and reconnects without waiting for the fallback poll", async () => {
  const controller = new AbortController();
  const statuses: string[] = [];
  let connections = 0;
  let reconnectGreeting = false;
  const timers = ((callback: () => void, delay?: number) =>
    setTimeout(callback, delay === 45_000 ? 10 : 1)) as typeof setTimeout;
  await readMessageStream({
    baseFetch: (_url, init) => {
      connections += 1;
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(
            new TextEncoder().encode("event: connected\ndata: {}\n\n")
          );
          init?.signal?.addEventListener("abort", () => stream.close(), {
            once: true,
          });
        },
      });
      return Promise.resolve(new Response(body));
    },
    onConnect: (reconnected) => {
      if (reconnected) {
        reconnectGreeting = true;
        controller.abort();
      }
    },
    onEvent: () => {
      throw new Error("No message was published");
    },
    onStatusChange: (status) => {
      statuses.push(status);
    },
    setTimeoutFn: timers,
    signal: controller.signal,
    url: "https://messages.invalid/stream",
  });
  // The reader owns reconnection asynchronously after a connection ends.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (reconnectGreeting) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- await the reconnect callback without letting the test leak a live stream
    await Bun.sleep(5);
  }
  controller.abort();
  expect(connections).toBe(2);
  expect(reconnectGreeting).toBe(true);
  expect(statuses).toContain("reconnecting");
  expect(statuses.at(-1)).toBe("closed");
});

test("activity greetings reconcile after reconnect even if no new event is published", async () => {
  const controller = new AbortController();
  const greetings: boolean[] = [];
  const timers = ((callback: () => void, delay?: number) =>
    setTimeout(callback, delay === 45_000 ? 10 : 1)) as typeof setTimeout;
  await readMessageActivityStream({
    baseFetch: openStream("event: connected\ndata: {}\n\n", () => {}),
    onActivity: () => {
      throw new Error("No activity was published");
    },
    onConnect: (isReconnect) => {
      greetings.push(isReconnect);
      if (isReconnect) {
        controller.abort();
      }
    },
    setTimeoutFn: timers,
    signal: controller.signal,
    url: "https://messages.invalid/events",
  });
  for (let attempt = 0; greetings.length < 2 && attempt < 30; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- wait for the reconnect greeting before asserting
    await Bun.sleep(5);
  }
  controller.abort();
  expect(greetings).toEqual([false, true]);
});
