import { expect, mock, test } from "bun:test";

import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";

let session: { user: { id: string } } | null = null;
const readGuestFeed = mock(() =>
  Promise.resolve([{ text: "Public network conversation" }])
);
mock.module("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
mock.module("@/lib/posts/guest-bluesky-feed", () => ({
  getGuestBlueskyFeed: readGuestFeed,
  guestDiscoveryLocale: () => "en",
}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@/hooks/users/use-user-data", () => ({
  getUserData: (id: string) => Promise.resolve({ id }),
}));
mock.module("@/lib/posts/server-feed", () => ({
  getRecentPostDataForCrawl: () => Promise.resolve([]),
}));
mock.module("@/components/posts/editor/post-editor", () => ({
  default: () => <form aria-label="Home composer" />,
}));
mock.module("@/components/layouts/skeletons/home-skeleton", () => ({
  default: () => null,
}));
mock.module("./client-home", () => ({
  default: ({
    composer,
    initialGuestExternalPosts,
  }: {
    composer?: ReactNode;
    initialGuestExternalPosts?: { text: string }[];
  }) => (
    <main>
      {composer}
      {initialGuestExternalPosts?.map((post) => (
        <p key={post.text}>{post.text}</p>
      ))}
    </main>
  ),
}));
const { default: Page } = await import("./page");

test("guest home does not serialize the account-gated composer", async () => {
  session = null;
  const html = await new Response(
    await renderToReadableStream(<Page />)
  ).text();
  expect(html).not.toContain('aria-label="Home composer"');
  expect(html).toContain("Public network conversation");
});

test("signed-in home retains the composer in its server-rendered slot", async () => {
  session = { user: { id: "local-audit" } };
  readGuestFeed.mockClear();
  const html = await new Response(
    await renderToReadableStream(<Page />)
  ).text();
  expect(html).toContain('aria-label="Home composer"');
  expect(readGuestFeed).not.toHaveBeenCalled();
});
