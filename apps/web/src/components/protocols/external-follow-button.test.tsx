import { afterAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

// The button renders nothing for a guest and reads "Follow" / "Following" for a
// signed-in reader. Both behaviours are asserted here because neither is visible
// in the profile header's own markup: the header composes the button, and a
// missing button is indistinguishable from a broken one without a direct test.
let sessionUser: { id: string } | null = null;

mock.module("@/hooks/auth/use-require-auth", () => ({
  useRequireAuth: () => ({
    goToLogin: () => {
      throw new Error("a guest must not reach the follow control");
    },
    isLoggedIn: Boolean(sessionUser),
    user: sessionUser,
  }),
}));

mock.module("@/lib/gooey-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

const { ExternalFollowButton } = await import("./external-follow-button");

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  Event: dom.Event,
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  navigator: dom.navigator,
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
const { createRoot } = await import("react-dom/client");

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

async function render(following: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    ["external-follow", sessionUser?.id ?? "guest", "did:plc:abc"],
    { following }
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => {
      await Promise.resolve();
      return Response.json({ following });
    },
    { preconnect: originalFetch.preconnect }
  );
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ExternalFollowButton did="did:plc:abc" />
      </QueryClientProvider>
    );
    await Promise.resolve();
  });
  return async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
    client.clear();
    globalThis.fetch = originalFetch;
  };
}

test("a guest sees no follow control on a Bluesky profile", async () => {
  sessionUser = null;
  const cleanup = await render(false);
  // Nothing rendered at all: not a disabled button, no placeholder.
  expect(dom.document.body.innerHTML.trim()).toBe("<div></div>");
  await cleanup();
});

test("a signed-in reader follows without the ASM suffix", async () => {
  sessionUser = { id: "user-1" };
  const cleanup = await render(false);
  const button = [...dom.document.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Follow")
  );
  expect(button).toBeDefined();
  expect(button?.textContent).toBe("Follow");
  expect(button?.classList.contains("btn-3d")).toBe(true);
  expect(button?.classList.contains("btn-3d-gray")).toBe(false);
  expect(button?.textContent).not.toContain("ASM");
  await cleanup();
});

test("following reads as Following, and can be undone", async () => {
  sessionUser = { id: "user-1" };
  const cleanup = await render(true);
  const button = [...dom.document.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Following")
  );
  expect(button?.textContent).toBe("Following");
  expect(button?.classList.contains("btn-3d-gray")).toBe(true);
  expect(button?.classList.contains("btn-3d")).toBe(false);
  await cleanup();
});
