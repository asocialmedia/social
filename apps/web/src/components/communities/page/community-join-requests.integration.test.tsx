import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

const showToast = mock(() => {});
mock.module("@/lib/gooey-toast", () => ({
  useToast: () => ({ toast: showToast }),
}));
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "owner" } }),
}));
mock.module("@/components/layouts/user/user-avatar", () => ({
  default: () => <span>Avatar</span>,
}));
mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("requests=1"),
}));

const originals = new Map<string, PropertyDescriptor | undefined>();
let dom: Window;
let root: Root | undefined;
let client: QueryClient;
const fetchOriginal = globalThis.fetch;
let pending = true;
let failDecision = false;
const decisions: string[] = [];

beforeAll(() => {
  dom = new Window({ url: "http://localhost/a/private" });
  const bindings = {
    CustomEvent: dom.CustomEvent,
    Element: dom.Element,
    Event: dom.Event,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    MutationObserver: dom.MutationObserver,
    Node: dom.Node,
    NodeFilter: dom.NodeFilter,
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    document: dom.document,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    navigator: dom.navigator,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    window: dom,
  };
  for (const [key, value] of Object.entries(bindings)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
      writable: true,
    });
  }
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  client?.clear();
  dom.document.body.innerHTML = "";
  globalThis.fetch = fetchOriginal;
  pending = true;
  failDecision = false;
  decisions.length = 0;
  showToast.mockClear();
});

afterAll(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
  dom.happyDOM.abort();
});

async function settle() {
  await act(async () => {
    await Bun.sleep(20);
  });
}

function button(label: string) {
  const found = [...dom.document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label
  );
  if (!found) {
    throw new Error(`Button missing: ${label}`);
  }
  return found;
}

async function render(content: React.ReactNode) {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  root = createRoot(host);
  globalThis.fetch = mock(
    (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { decision: string };
        decisions.push(body.decision);
        if (failDecision) {
          return Response.json(
            { error: "Community is at capacity" },
            { status: 409 }
          );
        }
        pending = false;
        return Response.json({ applied: true, decision: body.decision });
      }
      if (path.endsWith("/request-one")) {
        return Response.json({ canDecide: true, pending });
      }
      const more = path.includes("cursor=");
      const requestId = more ? "request-two" : "request-one";
      return Response.json({
        nextCursor: more ? null : "next",
        requests: [
          {
            createdAt: "2026-10-22T00:00:00Z",
            id: requestId,
            user: {
              avatarUrl: null,
              displayName: more ? "Second applicant" : "First applicant",
              id: requestId,
              username: requestId,
            },
          },
        ],
        total: 2,
      });
    }
  ) as typeof fetch;
  await act(() =>
    root?.render(
      <QueryClientProvider client={client}>{content}</QueryClientProvider>
    )
  );
  await settle();
}

test("notification actions accept a request and replace stale controls", async () => {
  const { CommunityRequestNotificationActions } =
    await import("./community-join-requests");
  await render(
    <CommunityRequestNotificationActions
      slug="private"
      requestId="request-one"
    />
  );
  expect(button("Accept").disabled).toBe(false);
  await act(() => button("Accept").click());
  await settle();
  expect(decisions).toEqual(["approve"]);
  expect(dom.document.body.textContent).toContain(
    "This request is no longer pending"
  );
  expect(
    [...dom.document.querySelectorAll("button")].some(
      (element) => element.textContent === "Accept"
    )
  ).toBe(false);
});

test("notification actions decline requests and retain controls after a failed decision", async () => {
  const { CommunityRequestNotificationActions } =
    await import("./community-join-requests");
  failDecision = true;
  await render(
    <CommunityRequestNotificationActions
      slug="private"
      requestId="request-one"
    />
  );
  await act(() => button("Accept").click());
  await settle();
  expect(button("Accept").disabled).toBe(false);
  expect(showToast).toHaveBeenCalled();
  failDecision = false;
  await act(() => button("Decline").click());
  await settle();
  expect(decisions).toEqual(["approve", "decline"]);
  expect(dom.document.body.textContent).toContain(
    "This request is no longer pending"
  );
});

test("notification deep link opens an accessible staff dialog and loads the next page", async () => {
  const { default: CommunityJoinRequests } =
    await import("./community-join-requests");
  await render(<CommunityJoinRequests slug="private" />);
  const dialog = dom.document.querySelector('[role="dialog"]');
  expect(Boolean(dialog)).toBe(true);
  expect(dialog?.textContent).toContain("First applicant");
  expect(dialog?.textContent).toContain("Join requests (2)");
  await act(() => button("Load more requests").click());
  await settle();
  expect(dialog?.textContent).toContain("Second applicant");
  expect(dialog?.querySelectorAll('a[href^="/users/"]').length).toBe(2);
  expect(
    [...dom.document.querySelectorAll("button")].filter(
      (element) => element.textContent?.trim() === "Accept"
    )
  ).toHaveLength(2);
});
