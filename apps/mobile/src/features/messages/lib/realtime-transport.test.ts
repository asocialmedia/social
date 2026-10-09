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
