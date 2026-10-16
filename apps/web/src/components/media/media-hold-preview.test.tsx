import { afterAll, expect, mock, test } from "bun:test";

import type { PostData } from "@asm/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot } from "react-dom/client";

function noop() {
  return null;
}

const window = new Window({ url: "https://example.test" });
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  Node: window.Node,
  ResizeObserver: class {
    observe = noop;
    disconnect = noop;
  },
  document: window.document,
  window,
})) {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}
afterAll(async () => {
  await window.happyDOM.close();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});

const push = mock(noop);
const respond = mock(noop);
const Surface = (props: ComponentProps<"div">) => <div {...props} />;
mock.module("@asm/ui/shadui/drawer", () => ({
  Drawer: ({ children, open }: { children: ReactNode; open: boolean }) => (
    <div data-open={open}>{children}</div>
  ),
  DrawerDescription: Surface,
  DrawerHandle: Surface,
  DrawerOverlay: Surface,
  DrawerPortal: ({ children }: { children: ReactNode }) => children,
  DrawerSurface: Surface,
  DrawerTitle: Surface,
}));
mock.module("motion/react", () => ({
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  useReducedMotion: () => true,
}));
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));
mock.module("next/image", () => ({
  default: () => <span data-preview-image />,
}));
mock.module("@/app/(main)/session-provider", () => ({
  useSession: () => ({ user: { id: "viewer" } }),
}));
mock.module("@/components/posts/actions/aura-vote-button", () => ({
  default: () => <button type="button">Amplify</button>,
}));
mock.module("@/components/posts/actions/bookmark-button", () => ({
  default: () => <button type="button">Bookmark</button>,
}));
mock.module("@/components/protocols/external-post-controls", () => ({
  ExternalBookmarkButton: () => <button type="button">Bookmark</button>,
  ExternalVoteButton: () => <button type="button">Amplify</button>,
}));
mock.module("@/lib/gooey-toast", () => ({ useToast: () => ({ toast: noop }) }));
mock.module("@/store/composer-store", () => ({
  useComposerStore: { getState: () => ({ openComposer: respond }) },
}));
const { MediaHoldPreview } = await import("./media-hold-preview");
const post = {
  attachments: [
    { id: "first", type: "IMAGE" },
    { id: "second", type: "IMAGE" },
  ],
  bookmarks: [],
  content: "Original caption",
  id: "post-id",
  user: { username: "artist" },
  vote: [],
} as unknown as PostData;

async function renderPreview() {
  const container = window.document.createElement("div");
  window.document.body.append(container);
  const root = createRoot(container as unknown as HTMLElement);
  const onClose = mock(noop);
  const client = new QueryClient();
  await act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MediaHoldPreview
          onClose={onClose}
          request={{
            bounds: { height: 200, width: 200, x: 0, y: 0 },
            media: { id: "second", type: "IMAGE" },
            post,
            postId: post.id,
          }}
        />
      </QueryClientProvider>
    );
  });
  return {
    container,
    async dispose() {
      await act(() => root.unmount());
      client.clear();
      container.remove();
    },
    onClose,
  };
}

test("controlled close completes after the exit and releases the parent hold state", async () => {
  const view = await renderPreview();
  try {
    await act(() => {
      view.container
        .querySelector('[aria-label="Close media preview"]')
        ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.container.querySelector('[data-open="false"]')).not.toBeNull();
    await act(async () => {
      await Bun.sleep(550);
    });
    expect(view.onClose).toHaveBeenCalledTimes(1);
  } finally {
    await view.dispose();
  }
});

test("respond opens the composer only after the menu has closed", async () => {
  const view = await renderPreview();
  respond.mockClear();
  try {
    const button = [...view.container.querySelectorAll("button")].find(
      (element) => element.textContent === "Respond"
    );
    await act(() => {
      button?.click();
    });
    expect(respond).not.toHaveBeenCalled();
    await act(async () => {
      await Bun.sleep(550);
    });
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      "post",
      expect.objectContaining({ content: "Original caption", id: post.id })
    );
  } finally {
    await view.dispose();
  }
});

test("fullscreen opens the held album item instead of always using the first", async () => {
  const view = await renderPreview();
  push.mockClear();
  try {
    const button = [...view.container.querySelectorAll("button")].find(
      (element) => element.textContent === "Open full screen"
    );
    await act(() => {
      button?.click();
    });
    expect(push).not.toHaveBeenCalled();
    await act(async () => {
      await Bun.sleep(550);
    });
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/media/1"));
  } finally {
    await view.dispose();
  }
});
