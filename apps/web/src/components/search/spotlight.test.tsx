import { afterAll, expect, mock, test } from "bun:test";

import type { ExternalAuthor, ExternalPost } from "@asm/protocols/contracts";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import { Window } from "happy-dom";
import type { CSSProperties, ReactNode } from "react";
import { act } from "react";

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

let networkMockState: {
  scope: string;
  settings?: unknown;
} = { scope: "default" };

mock.module("@/hooks/feed/use-network-settings", () => ({
  useNetworkSettings: () => networkMockState,
}));

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: null }),
}));
mock.module("@/components/layouts/user/user-avatar", () => ({
  default: ({ avatarUrl }: { avatarUrl?: string }) => (
    <span data-avatar={avatarUrl} />
  ),
}));
mock.module("@/components/communities/card/community-avatar", () => ({
  default: () => <span />,
}));
mock.module("@asm/ui/shadui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? children : null,
  DialogContent: ({
    children,
    className,
    style,
    "data-search-source": source,
  }: {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
    "data-search-source"?: string;
  }) => (
    <section
      aria-label="Search dialog"
      className={className}
      style={style}
      data-search-source={source}
    >
      {children}
    </section>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogTitle: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <h2 className={className}>{children}</h2>,
}));
const noopMutation = { mutate: mock(() => {}) };
mock.module("./use-search-history", () => ({
  normalizeHistoryItem: (item: unknown) => item,
  useSearchHistory: () => ({
    addPostSearchMutation: noopMutation,
    addSearchMutation: noopMutation,
    addUserSearchMutation: noopMutation,
    clearHistoryMutation: noopMutation,
    history: [],
    removeHistoryItemMutation: noopMutation,
  }),
}));
const vercel: ExternalAuthor = {
  avatarUrl: "https://cdn.bsky.app/avatar/vercel.jpg",
  displayName: "Vercel",
  handle: "vercel.com",
  id: "did:plc:vercel",
  labels: [],
  source: "bluesky",
  upstreamCounts: {},
  url: "https://bsky.app/profile/vercel.com",
};
const next: ExternalAuthor = {
  ...vercel,
  displayName: "Next.js",
  handle: "nextjs.org",
  id: "did:plc:next",
};
const post: ExternalPost = {
  author: vercel,
  createdAt: "2026-10-19T00:00:00Z",
  id: "at://did:plc:vercel/app.bsky.feed.post/launch",
  indexedAt: "2026-10-19T00:00:00Z",
  labels: [],
  languages: [],
  media: [],
  revision: "1",
  segments: [],
  source: "bluesky",
  text: "A Vercel launch post",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/vercel.com/post/launch",
};
const searchData = { posts: [post], profiles: [vercel, next], unavailable: [] };
mock.module("./use-spotlight-search", () => ({
  useSpotlightSearch: (query: string) => ({
    asm: { data: undefined, error: null, isFetching: false },
    bluesky: {
      data: query.trim().length >= 2 ? searchData : undefined,
      error: null,
      isFetching: false,
    },
    waiting: false,
  }),
}));
mock.module("@/hooks/use-discovery-suggestions", () => ({
  useDiscoverySuggestions: () => ({ data: undefined }),
  useSearchLearning: () => async () => {},
}));
mock.module("@/components/recommendations/suggested-follow-button", () => ({
  SuggestedFollowButton: () => <button type="button">Follow</button>,
}));
const { default: Spotlight } = await import("./spotlight");

test("clicking a profile shows its avatar in Recent after reopening and suggests other accounts and posts", async () => {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host);
  const close = mock(() => {});
  const render = (key: string, initialQuery = "") =>
    act(() =>
      root.render(
        <Spotlight
          key={key}
          open
          initialQuery={initialQuery}
          onOpenChange={close}
          onSelect={() => {}}
        />
      )
    );
  try {
    await render("search", "vercel");
    expect(host.textContent).not.toContain("Your interests");
    expect(host.querySelector("kbd")).toBeNull();
    const result = host.querySelector<HTMLButtonElement>(
      "[data-search-index='0']"
    );
    expect(result?.textContent).toContain("Vercel");
    await act(() => {
      result?.click();
    });
    expect(push).toHaveBeenCalledWith(
      "/network/bluesky/profile?actor=did%3Aplc%3Avercel"
    );
    expect(close).toHaveBeenCalledWith(false);
    await render("reopen");
    const recent = host.querySelector("section[aria-label='Recent']");
    expect(recent?.textContent).toContain("Vercel");
    expect(recent?.textContent).toContain("@vercel.com");
    expect(recent?.querySelector("[data-avatar]")?.dataset.avatar).toBe(
      vercel.avatarUrl
    );
    expect(
      host.querySelector("section[aria-label='Suggested accounts']")
        ?.textContent
    ).toContain("Next.js");
    expect(
      host.querySelector("section[aria-label='Suggested accounts']")
        ?.textContent
    ).not.toContain("@vercel.com");
    expect(
      host.querySelector("section[aria-label='Suggested posts']")?.textContent
    ).toContain("A Vercel launch post");
    const accountCard = host.querySelector<HTMLButtonElement>(
      "section[aria-label='Suggested accounts'] [data-suggested-account-card] button"
    );
    expect(accountCard?.getAttribute("aria-label")).toBe("Next.js @nextjs.org");
    await act(() => {
      accountCard?.click();
    });
    expect(push).toHaveBeenLastCalledWith(
      "/network/bluesky/profile?actor=did%3Aplc%3Anext"
    );
    await render("reopen-account-card");
    expect(
      host.querySelector("section[aria-label='Recent']")?.textContent
    ).toContain("Next.js");
    const postRow = host.querySelector<HTMLButtonElement>(
      "section[aria-label='Suggested posts'] [data-search-index]"
    );
    await act(() => {
      postRow?.click();
    });
    await render("reopen-post");
    expect(
      host.querySelector("section[aria-label='Recent']")?.textContent
    ).toContain("A Vercel launch post");
    const remove = host.querySelector<HTMLButtonElement>(
      "button[aria-label='Remove Vercel from history']"
    );
    await act(() => {
      remove?.click();
    });
    expect(
      host.querySelector("button[aria-label='Remove Vercel from history']")
    ).toBeNull();
    const clear = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Clear history"
    );
    await act(() => {
      clear?.click();
    });
    expect(host.querySelector("section[aria-label='Recent']")).toBeNull();
    expect(
      host.querySelector("section[aria-label='Suggested accounts']")
    ).toBeNull();
    expect(
      host.querySelector("section[aria-label='Suggested posts']")
    ).toBeNull();
    expect(noopMutation.mutate).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

test("displays user interests from active profile and clicking interest populates query", async () => {
  networkMockState = {
    scope: "default",
    settings: {
      catalog: [],
      persona: {
        avoidedTopics: [],
        learnedInterests: ["AI"],
        relatedInterests: [],
        signalCount: 1,
      },
      preferences: {
        ...defaultNetworkPreferences(),
        activeProfileId: "default",
        profiles: [
          {
            id: "default",
            interests: ["TypeScript", "Next.js"],
            name: "Default",
          },
        ],
      },
      revision: 1,
    },
  };

  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host);
  const close = mock(() => {});
  try {
    await act(() =>
      root.render(
        <Spotlight
          open
          initialQuery=""
          onOpenChange={close}
          onSelect={() => {}}
        />
      )
    );
    const interestsSection = host.querySelector(
      "section[aria-label='Your interests']"
    );
    expect(interestsSection).not.toBeNull();
    expect(interestsSection?.textContent).toContain("TypeScript");
    expect(interestsSection?.textContent).toContain("Next.js");
    expect(interestsSection?.textContent).toContain("AI");

    const input = host.querySelector<HTMLInputElement>(
      "input[aria-label='Search']"
    );
    expect(input?.value).toBe("");

    const tsButton = interestsSection
      ? [
          ...interestsSection.querySelectorAll<HTMLButtonElement>("button"),
        ].find((b) => b.textContent?.includes("TypeScript"))
      : undefined;
    expect(tsButton).not.toBeUndefined();
    await act(() => {
      tsButton?.click();
    });
    expect(input?.value).toBe("TypeScript");
  } finally {
    networkMockState = { scope: "default" };
    await act(() => root.unmount());
    host.remove();
  }
});
