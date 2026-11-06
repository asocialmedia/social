// oxlint-disable promise/avoid-new -- Deliberately stalled fetches resolve only when their abort signals fire.
import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  fetchMessageSearchJson,
  MessageSearchRequestError,
} from "./search-request";

const originalFetch = globalThis.fetch;
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator"
);

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
});

function stubFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) {
  globalThis.fetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect,
  });
}

describe("bounded message search requests", () => {
  test("uses current capability, bypasses caches and parses valid JSON", async () => {
    let options: RequestInit | undefined;
    stubFetch((_input, init) => {
      options = init;
      return Promise.resolve(Response.json({ hits: [] }));
    });
    expect(await fetchMessageSearchJson("/search", { method: "POST" })).toEqual(
      { hits: [] }
    );
    expect(options?.cache).toBe("no-store");
    expect(new Headers(options?.headers).get("X-Chat-Capability")).toBeTruthy();
  });

  test("aborts stalled requests at the deadline", async () => {
    let aborted = false;
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true }
          );
        })
    );
    await expect(
      fetchMessageSearchJson("/search", {}, { timeoutMs: 15 })
    ).rejects.toThrow("Search took too long");
    expect(aborted).toBe(true);
  });

  test("times out stalled response bodies as well as headers", async () => {
    let cancelled = false;
    stubFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          })
        )
      )
    );
    await expect(
      fetchMessageSearchJson("/search", {}, { timeoutMs: 15 })
    ).rejects.toThrow("Search took too long");
    expect(cancelled).toBe(true);
  });

  test("propagates cancellation when a newer query replaces the request", async () => {
    const controller = new AbortController();
    stubFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const pending = fetchMessageSearchJson("/search", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("cancels oversized chunked responses before parsing", async () => {
    let cancelled = false;
    stubFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
            pull(controller) {
              controller.enqueue(new Uint8Array(33));
            },
          })
        )
      )
    );
    await expect(
      fetchMessageSearchJson("/search", {}, { maxBytes: 32 })
    ).rejects.toThrow("too much data");
    expect(cancelled).toBe(true);
  });

  test("honors Retry-After and marks expired sessions for a fresh search", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(null, { headers: { "Retry-After": "20" }, status: 429 })
      )
    );
    const before = Date.now();
    const failure = await fetchMessageSearchJson("/search", {}).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(MessageSearchRequestError);
    if (failure instanceof MessageSearchRequestError) {
      expect(failure.retryAt).toBeGreaterThanOrEqual(before + 20_000);
    }
    stubFetch(() => Promise.resolve(new Response(null, { status: 409 })));
    await expect(fetchMessageSearchJson("/search", {})).rejects.toMatchObject({
      restartRequired: true,
    });
  });

  test("reports offline state without starting network work", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: false },
    });
    const fetch = mock(() => Promise.resolve(Response.json({})));
    stubFetch(fetch);
    await expect(fetchMessageSearchJson("/search", {})).rejects.toThrow(
      "Connect to the internet"
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
