import { afterEach, expect, mock, test } from "bun:test";

import { LIFECYCLE_CAPABILITY } from "@asm/messages";

import { chatCapabilityError, fetchChatApi } from "./chat-capability";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.each(["chat-lifecycle-v1", "chat-lifecycle-v2"])(
  "normal message reads and streams accept the supported %s protocol",
  (capability) => {
    const url = "https://example.test/api/messages/conversations/dm/stream";
    expect(
      chatCapabilityError(new Request(`${url}?capability=${capability}`), {
        retentionVersion: 1,
      })
    ).toBeNull();
    expect(
      chatCapabilityError(
        new Request(url, { headers: { "X-Chat-Capability": capability } }),
        { retentionVersion: 1 }
      )
    ).toBeNull();
  }
);

test.each([null, "chat-lifecycle-v0", "chat-lifecycle-v999"])(
  "timed history rejects missing or unsupported acknowledgement %s",
  (capability) => {
    const response = chatCapabilityError(
      new Request("https://example.test/stream", {
        headers: capability ? { "X-Chat-Capability": capability } : {},
      }),
      { retentionVersion: 1 }
    );
    expect(response?.status).toBe(426);
    expect(response?.headers.get("X-Chat-Capability")).toBe(
      LIFECYCLE_CAPABILITY
    );
  }
);

test("stream requests carry the current protocol and preserve reconnect options", async () => {
  const controller = new AbortController();
  let captured: RequestInit | undefined;
  const fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) => {
    captured = init;
    return Promise.resolve(
      new Response("event: connected\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      })
    );
  });
  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });
  const response = await fetchChatApi("https://example.test/stream", {
    credentials: "same-origin",
    headers: {
      "Last-Event-ID": "reconnect-cursor",
      "X-Chat-Capability": "chat-lifecycle-v1",
    },
    signal: controller.signal,
  });
  expect(response.ok).toBe(true);
  expect(new Headers(captured?.headers).get("X-Chat-Capability")).toBe(
    "chat-lifecycle-v2"
  );
  expect(new Headers(captured?.headers).get("Last-Event-ID")).toBe(
    "reconnect-cursor"
  );
  expect(captured?.signal).toBe(controller.signal);
  expect(captured?.credentials).toBe("same-origin");
});
