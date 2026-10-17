import { afterAll, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { ExternalResponses } from "./external-responses";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
afterAll(async () => {
  await dom.happyDOM.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

const router = {
  back: () => {},
  bfcacheId: "ext-resp-test",
  forward: () => {},
  prefetch: () => {},
  push: () => {},
  refresh: () => {},
  replace: () => {},
};

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  return {
    host,
    render: async () => {
      await act(() => {
        root.render(
          <AppRouterContext.Provider value={router}>
            <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
          </AppRouterContext.Provider>
        );
      });
    },
    unmount: async () => {
      await act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

test("ExternalResponses renders responses using unified thread rows rather than post cards", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Response.json({
      cursor: null,
      items: [
        {
          _count: { bookmarks: 0, comments: 0, responses: 0, vote: 0 },
          attachments: [],
          aura: 0,
          bookmarks: [],
          community: null,
          communityId: null,
          content: "Thread response to Bluesky post",
          createdAt: new Date("2026-10-17T00:00:00Z"),
          embeds: null,
          id: "response-1",
          isGust: false,
          parentPostId: null,
          rootPostId: null,
          user: {
            avatarUrl: null,
            badge: null,
            badges: [],
            createdAt: "2026-01-01T00:00:00.000Z",
            displayName: "Responder",
            id: "responder-id",
            username: "responder",
          },
          userId: "responder-id",
          vote: [],
        },
      ],
    })) as unknown as typeof fetch;

  const testHarness = renderWithClient(
    <ExternalResponses uri="at://did:plc:test/app.bsky.feed.post/123" />
  );
  await testHarness.render();

  // Allow query to settle
  await act(async () => {
    await Bun.sleep(50);
  });

  expect(testHarness.host.textContent).toContain("Responses on ASM");
  expect(testHarness.host.textContent).toContain(
    "Thread response to Bluesky post"
  );
  expect(testHarness.host.textContent).toContain("Responder");

  await testHarness.unmount();
  globalThis.fetch = originalFetch;
});

test("ExternalResponses shows helpful copy when no responses exist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Response.json({ cursor: null, items: [] })) as unknown as typeof fetch;

  const testHarness = renderWithClient(
    <ExternalResponses uri="at://did:plc:empty/app.bsky.feed.post/456" />
  );
  await testHarness.render();

  await act(async () => {
    await Bun.sleep(50);
  });

  expect(testHarness.host.textContent).toContain(
    "No responses yet. Use Respond to post a fleet."
  );

  await testHarness.unmount();
  globalThis.fetch = originalFetch;
});
