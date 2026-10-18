import { afterAll, afterEach, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

// The settings shell owns the URL, so the network tab is told which section is
// open. These tests drive that contract directly and stub the preferences hook,
// which needs a live database.
let hookState: {
  error: Error | null;
  isSaving: boolean;
  ready: boolean;
  refetch: () => Promise<void>;
  save: () => void;
  settings: unknown;
};

const defaultPreferences = {
  activeProfileId: "default",
  avoidedTopics: [],
  language: "auto",
  profiles: [{ id: "default", interests: ["art"], name: "Everyday" }],
  region: "auto",
  showExplicitContent: false,
};

hookState = {
  error: null,
  isSaving: false,
  ready: true,
  refetch: async () => {
    /* the real hook re-reads preferences */
  },
  save: () => {
    /* the real hook writes preferences */
  },
  settings: {
    catalog: ["art", "music"],
    persona: {
      avoidedTopics: [],
      learnedInterests: [],
      relatedInterests: [],
      signalCount: 0,
    },
    preferences: defaultPreferences,
    revision: 1,
  },
};

mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => hookState,
}));

const { default: NetworkSettings } = await import("./network-settings");

const dom = new Window({ url: "http://localhost:3000" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  IS_REACT_ACT_ENVIRONMENT: true,
  document: dom.document,
  window: dom,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  hookState = {
    ...hookState,
    error: null,
    ready: true,
  };
});

afterAll(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

async function render(section: "content" | "moderation" | null) {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const opened: (string | null)[] = [];
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <NetworkSettings
          onOpenSection={(next) => {
            opened.push(next);
          }}
          section={section}
        />
      </QueryClientProvider>
    );
    await Promise.resolve();
  });
  cleanups.push(async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
  });
  return { host, opened };
}

test("a section page offers a back control to the hub", async () => {
  const { host, opened } = await render("content");
  const back = host.querySelector<HTMLButtonElement>(
    '[aria-label="Back to network settings"]'
  );
  expect(back).not.toBeNull();
  expect(host.textContent).toContain("Content & media");

  await act(async () => {
    back?.click();
    await Promise.resolve();
  });
  // Closing a section asks the shell to return to the hub, not to another tab.
  expect(opened).toEqual([null]);
});

test("a slow load shows the pane's shape, not a line of text", async () => {
  hookState = { ...hookState, error: null, ready: false };
  const { host } = await render("moderation");
  // One announcement for assistive tech, and the shapes are hidden from it.
  expect(host.textContent).toContain("Loading network preferences…");
  // Placeholder blocks rather than the real fields.
  expect(
    host.querySelectorAll('[class*="animate-pulse"]').length
  ).toBeGreaterThan(3);
  expect(host.querySelector("#settings-network-region")).toBeNull();
});

test("a failed load says so and keeps the way back", async () => {
  // The exact state that used to strand the reader on a section page.
  hookState = {
    ...hookState,
    error: new Error("Couldn't load network preferences"),
    ready: false,
  };
  const { host, opened } = await render("moderation");
  expect(host.textContent).toContain("Couldn't load network preferences");
  expect(host.textContent).toContain("Try again");
  // It must not claim to still be loading.
  expect(host.textContent).not.toContain("Loading network preferences…");
  const back = host.querySelector<HTMLButtonElement>(
    '[aria-label="Back to network settings"]'
  );
  expect(back).not.toBeNull();
  await act(async () => {
    back?.click();
    await Promise.resolve();
  });
  expect(opened).toEqual([null]);
});

test("the hub itself has no back control and lists every section", async () => {
  const { host } = await render(null);
  expect(
    host.querySelector('[aria-label="Back to network settings"]')
  ).toBeNull();
  for (const title of [
    "Profiles",
    "Content & media",
    "Moderation & content filters",
    "Languages",
  ]) {
    expect(host.textContent).toContain(title);
  }
});
