import { afterEach, expect, mock, test } from "bun:test";

import type { PostData } from "@asm/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { useVideoCaptionsStore } from "@/lib/stores/video-captions-store";

// Keep portal contents inline so the regression test exercises both the Gust
// additions and the real shared post menu in one rendered dropdown.
const Inline = ({ children }: { children: ReactNode }) => <div>{children}</div>;
mock.module("@asm/ui/shadui/dropdown-menu", () => ({
  DropdownMenu: Inline,
  DropdownMenuContent: Inline,
  DropdownMenuItem: ({ children, onClick }: ComponentProps<"button">) => (
    <button onClick={onClick} type="button">
      {children}
    </button>
  ),
  DropdownMenuTrigger: Inline,
}));
mock.module("@/components/posts/actions/delete-post-dialog", () => ({
  default: () => null,
}));
mock.module("@/components/posts/actions/post-moderation-dialog", () => ({
  default: () => null,
}));
mock.module("@/components/tags/post-meta-editor-dialog", () => ({
  PostMetaEditorDialog: () => null,
}));
mock.module("@/components/home/feedview/share-button", () => ({
  default: () => null,
}));
const { GustCard } = await import("./gust-card");

const router = {
  back() {
    return null;
  },
  forward() {
    return null;
  },
  hmrRefresh() {
    return null;
  },
  prefetch() {
    return Promise.resolve();
  },
  push() {
    return null;
  },
  refresh() {
    return null;
  },
  replace() {
    return null;
  },
};
const post = {
  _count: { bookmarks: 0, comments: 0, responses: 0 },
  attachments: [
    {
      altText: "Clip description",
      height: 1920,
      id: "video",
      type: "VIDEO",
      width: 1080,
    },
  ],
  aura: 0,
  bookmarks: [],
  content: "A Gust",
  createdAt: new Date("2026-10-16"),
  id: "gust-menu",
  isGust: true,
  moderated: false,
  user: {
    avatarUrl: null,
    badges: [],
    createdAt: new Date("2026-01-01"),
    displayName: "Artist",
    followers: [],
    id: "artist",
    username: "artist",
  },
  vote: [],
} as unknown as PostData;

function renderMenu(moderated = false) {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AppRouterContext.Provider value={router}>
        <GustCard
          isActive={false}
          isMuted
          onOpenComments={() => null}
          onToggleMute={() => null}
          post={{ ...post, moderated }}
        />
      </AppRouterContext.Provider>
    </QueryClientProvider>
  );
  client.clear();
  return html;
}
const originalCaptions = useVideoCaptionsStore.getInitialState().showCaptions;
function setCaptions(showCaptions: boolean) {
  // Static rendering reads Zustand's server snapshot, rather than its live client state.
  useVideoCaptionsStore.getInitialState().showCaptions = showCaptions;
  useVideoCaptionsStore.setState({ showCaptions });
}
afterEach(() => setCaptions(originalCaptions));

test("Gust options show exactly one captions toggle plus one transcript action", () => {
  setCaptions(false);
  const html = renderMenu();
  expect(html.match(/Show captions/g)).toHaveLength(1);
  expect(html.match(/View transcript/g)).toHaveLength(1);
});

test("enabled captions retain a single working Hide captions action", () => {
  setCaptions(true);
  const html = renderMenu();
  expect(html.match(/Hide captions/g)).toHaveLength(1);
  expect(html).not.toContain("Show captions");
});

test("moderated Gusts do not offer captions or transcript playback controls", () => {
  const html = renderMenu(true);
  expect(html).not.toContain("Show captions");
  expect(html).not.toContain("Hide captions");
  expect(html).not.toContain("View transcript");
});
