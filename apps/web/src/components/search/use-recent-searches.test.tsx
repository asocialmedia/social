import { afterAll, expect, test } from "bun:test";

import { Window } from "happy-dom";
import { act, useEffect } from "react";

import type { SearchTarget } from "./spotlight-search";
import { useRecentSearches } from "./use-recent-searches";

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
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

const profile: SearchTarget = {
  displayName: "Vercel",
  href: "/network/bluesky/profile?actor=did%3Aplc%3Avercel",
  id: "bluesky-user-vercel",
  source: "bluesky",
  subtitle: "@vercel.com",
  type: "user",
};

test("opened results persist before navigation unmounts search, with isolated removable history and suggestions", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  let root = createRoot(host);
  let current: ReturnType<typeof useRecentSearches> | undefined;
  function Probe({ viewer }: { viewer: string }) {
    const recent = useRecentSearches(viewer);
    useEffect(() => {
      current = recent;
    });
    return (
      <span>
        {recent.history
          .map((entry) => entry.target?.displayName ?? entry.query)
          .join(",")}
      </span>
    );
  }
  const render = (viewer: string) =>
    act(() => root.render(<Probe key={viewer} viewer={viewer} />));
  try {
    await render("guest");
    await act(() => {
      current?.remember("vercel", "all");
    });
    expect(host.textContent).toBe("vercel");
    await act(() => {
      current?.rememberResult(profile, "vercel");
      root.unmount();
    });
    expect(
      JSON.parse(
        dom.localStorage.getItem("asm:spotlight:history:guest") ?? "[]"
      )[0].target.displayName
    ).toBe("Vercel");
    root = createRoot(host);
    await render("guest");
    expect(host.textContent).toBe("Vercel");
    await act(() => {
      current?.collect([profile], "vercel");
    });
    expect(current?.candidates).toHaveLength(1);
    await render("alice");
    expect(host.textContent).toBe("");
    expect(current?.candidates).toHaveLength(0);
    await act(() => {
      current?.rememberResult(
        { ...profile, displayName: "Alice's account" },
        "private"
      );
    });
    await render("guest");
    expect(host.textContent).toBe("Vercel");
    expect(current?.candidates).toHaveLength(1);
    await act(() => {
      current?.remove(profile.id);
    });
    expect(host.textContent).toBe("");
    await act(() => {
      current?.clear();
    });
    expect(current?.candidates).toHaveLength(0);
    expect(dom.localStorage.getItem("asm:spotlight:suggestions:guest")).toBe(
      "[]"
    );
    expect(dom.localStorage.getItem("asm:spotlight:history:alice")).toContain(
      "Alice's account"
    );
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
