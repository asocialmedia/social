import { afterAll, expect, mock, test } from "bun:test";

import type { PostPreviewSource } from "@asm/ui/lib/post-preview-layout";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";

const dom = new Window({ url: "http://localhost:3000/posts/preview-id" });
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
mock.module("next/navigation", () => ({
  useParams: () => ({ postId: "preview-id" }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("./post-card-skeleton", () => ({
  PostCardSkeleton: ({ post }: { post?: PostPreviewSource }) => (
    <p>{post?.content ?? "pending"}</p>
  ),
}));
const { createRoot } = await import("react-dom/client");
const { CachedPostCardSkeleton } = await import("./cached-post-card-skeleton");

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

function QueryCreatedDuringRender() {
  useQuery({
    enabled: false,
    initialData: {
      attachments: [],
      content: "loaded preview",
      id: "preview-id",
    },
    queryKey: ["post", "preview-id"],
  });
  useQuery({
    enabled: false,
    initialData: { following: false },
    queryKey: ["external-follow", "other"],
  });
  return null;
}

test("preview subscribers do not update during another component's query initialization and still receive data changes", async () => {
  const client = new QueryClient();
  const container = dom.document.createElement("div");
  dom.document.body.append(container);
  const root = createRoot(container);
  const errors: unknown[][] = [];
  const previousError = console.error;
  console.error = (...values: unknown[]) => {
    errors.push(values);
  };
  try {
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <CachedPostCardSkeleton />
        </QueryClientProvider>
      )
    );
    await act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <CachedPostCardSkeleton />
          <QueryCreatedDuringRender />
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await Bun.sleep(20);
    });
    expect(errors.flat().join(" ")).not.toContain("Cannot update a component");
    expect(errors.flat().join(" ")).not.toContain(
      "getSnapshot should be cached"
    );
    await act(async () => {
      client.setQueryData(["post", "preview-id"], {
        attachments: [],
        content: "updated preview",
        id: "preview-id",
      });
      await Bun.sleep(20);
    });
    expect(container.textContent).toContain("updated preview");
    await act(async () => {
      client.removeQueries({ queryKey: ["post", "preview-id"] });
      await Bun.sleep(20);
    });
    expect(container.textContent).toContain("pending");
  } finally {
    await act(() => root.unmount());
    client.clear();
    container.remove();
    console.error = previousError;
  }
});
