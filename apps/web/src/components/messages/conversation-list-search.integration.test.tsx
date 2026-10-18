import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { saveGlobalMessageSearchViewState } from "@/lib/messages/global-message-search-view-state";

import { ConversationList } from "./conversation-list";

const viewer = "unified-interaction-viewer";
const onSelectMessage = mock(() => {});
const toast = mock(() => {});
const noop = () => {};
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: viewer } }),
}));
mock.module("@/lib/messages/use-presence", () => ({ usePresence: () => [] }));
mock.module("@/lib/messages/use-message-activity", () => ({
  useMessageActivity: noop,
}));
mock.module("@/lib/gooey-toast", () => ({ toast }));
mock.module("./create-den-dialog", () => ({ CreateDenDialog: () => null }));
mock.module("./join-den-dialog", () => ({ JoinDenDialog: () => null }));
mock.module("./use-conversation-preview-requests", () => ({
  useConversationPreviewRequests: noop,
}));
mock.module("@/lib/messages/use-global-message-search", () => ({
  useGlobalMessageSearch: () => ({
    coverageComplete: true,
    coveragePaused: false,
    error: null,
    hasMore: false,
    loadMore: noop,
    loading: false,
    loadingMore: false,
    queryReady: true,
    results: [],
    retry: noop,
    retryAt: 0,
  }),
}));

let dom: Window;
let root: Root;
let queryClient: QueryClient;
const globals = new Map<string, PropertyDescriptor | undefined>();

function button(label: string): HTMLButtonElement {
  const found = dom.document.querySelector(`button[aria-label="${label}"]`);
  if (!found) {
    throw new Error(`Missing button: ${label}`);
  }
  return found as unknown as HTMLButtonElement;
}

function input(): HTMLInputElement {
  const found = dom.document.querySelector('input[type="search"]');
  if (!found) {
    throw new Error("Missing search input");
  }
  return found as unknown as HTMLInputElement;
}

async function settle(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop -- Observe the debounced profile request and React render.
    await act(async () => {
      await Bun.sleep(10);
    });
  }
  expect(predicate()).toBe(true);
}

beforeEach(async () => {
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "getComputedStyle",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ]) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }
  dom = new Window({ url: "http://localhost:3000/messages" });
  for (const [key, value] of Object.entries({
    Event: dom.Event,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    KeyboardEvent: dom.KeyboardEvent,
    MouseEvent: dom.MouseEvent,
    document: dom.document,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    navigator: dom.navigator,
    window: dom,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: (url: unknown) => {
      if (String(url).includes("/api/messages/search?")) {
        return Promise.resolve(
          Response.json({
            users: Array.from({ length: 7 }, (_, index) => ({
              addRefusal: null,
              avatarUrl: null,
              badge: null,
              badges: [],
              displayName: `Needle ${index}`,
              hasIdentity: true,
              id: `profile-${index}`,
              username: `needle${index}`,
            })),
          })
        );
      }
      return Promise.resolve(new Response(null, { status: 503 }));
    },
    writable: true,
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  saveGlobalMessageSearchViewState(viewer, {
    query: "needle",
    scrollTop: 0,
    selectedMessageId: "selected",
  });
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  root = createRoot(container as unknown as HTMLElement);
  onSelectMessage.mockClear();
  toast.mockClear();
  await act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ConversationList
          activeConversationId={null}
          layout="full"
          onSelect={noop}
          onSelectMessage={onSelectMessage}
        />
      </QueryClientProvider>
    );
  });
});

afterEach(async () => {
  await act(() => {
    root.unmount();
  });
  queryClient.clear();
  await dom.happyDOM.abort();
  dom.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  globals.clear();
});

describe("unified search interactions", () => {
  test("preserves the query on filter and outside clicks, and clears explicitly", async () => {
    const filter = button("DMs message results");
    await act(() => {
      filter.dispatchEvent(
        new dom.MouseEvent("mousedown", { bubbles: true }) as unknown as Event
      );
      filter.click();
      dom.document.body.dispatchEvent(
        new dom.MouseEvent("mousedown", { bubbles: true })
      );
    });
    expect(input().value).toBe("needle");
    expect(filter.dataset.state).toBe("active");
    await act(() => {
      button("Clear search").click();
    });
    expect(input().value).toBe("");
    expect(dom.document.activeElement).toBe(input());
  });

  test("shows five profiles, expands the remainder, and retains the query if opening one fails", async () => {
    await settle(
      () =>
        dom.document.querySelectorAll(
          "#global-message-search-profiles-list button"
        ).length === 5
    );
    const expansion = [...dom.document.querySelectorAll("button")].find(
      (element) => element.textContent.includes("Show 2 more profiles")
    );
    expect(expansion).toBeDefined();
    await act(() => {
      expansion?.click();
    });
    expect(
      dom.document.querySelectorAll(
        "#global-message-search-profiles-list button"
      )
    ).toHaveLength(7);
    await act(() => {
      button("Message Needle 0").click();
    });
    await settle(() => toast.mock.calls.length > 0);
    expect(input().value).toBe("needle");
    const profile = button("Message Needle 1");
    await act(() => {
      profile.dispatchEvent(
        new dom.KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape",
        }) as unknown as Event
      );
    });
    expect(input().value).toBe("");
    expect(dom.document.activeElement).toBe(input());
  });
});
