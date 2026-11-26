import { expect, mock, test } from "bun:test";

import type { UserData } from "@asm/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import MobileTopBar from "./mobile-top-bar";

const viewer = { id: "mobile-viewer", username: "mobileviewer" };

mock.module("next/navigation", () => ({ usePathname: () => "/" }));
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: viewer }),
}));
mock.module("@/components/search/spotlight-provider", () => ({
  useSpotlight: () => ({ openSpotlight: () => {} }),
}));
mock.module("@/components/home/sidebars/left/user-profile-popover", () => ({
  default: ({ userData }: { userData: Pick<UserData, "username"> }) => (
    <button
      aria-label={`Open profile menu for ${userData.username}`}
      type="button"
    />
  ),
}));

function topBar(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <MobileTopBar />
    </QueryClientProvider>
  );
}

test("hydrates the profile link against a warm client cache, then shows the menu and unread count", async () => {
  const server = new QueryClient();
  const client = new QueryClient();
  const markup = renderToString(topBar(server));
  client.setQueryData(["user", viewer.id], viewer);
  client.setQueryData(["unread-notification-count"], { unreadCount: 3 });
  const dom = new Window({ url: "http://localhost:3000" });
  const globals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    IS_REACT_ACT_ENVIRONMENT: true,
    document: dom.document,
    window: dom,
  })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const host = dom.document.createElement("div");
  host.innerHTML = markup;
  dom.document.body.append(host);
  const errors: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    expect(host.querySelector('a[href="/mobileviewer"]')).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Notifications"]')?.textContent
    ).toBe("");
    await act(() => {
      root = hydrateRoot(host as unknown as HTMLElement, topBar(client), {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(
      host.querySelector(
        'button[aria-label="Open profile menu for mobileviewer"]'
      )
    ).not.toBeNull();
    expect(
      host.querySelector('[aria-label="Notifications"]')?.textContent
    ).toBe("3");
  } finally {
    await act(() => root?.unmount());
    client.clear();
    server.clear();
    await dom.happyDOM.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  }
});
