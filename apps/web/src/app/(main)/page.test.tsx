import { expect, mock, test } from "bun:test";

import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";

let session: { user: { id: string } } | null = null;
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
  default: ({ composer }: { composer?: ReactNode }) => <main>{composer}</main>,
}));
const { default: Page } = await import("./page");

test("guest home does not serialize the account-gated composer", async () => {
  session = null;
  const html = await new Response(
    await renderToReadableStream(<Page />)
  ).text();
  expect(html).not.toContain('aria-label="Home composer"');
});

test("signed-in home retains the composer in its server-rendered slot", async () => {
  session = { user: { id: "local-audit" } };
  const html = await new Response(
    await renderToReadableStream(<Page />)
  ).text();
  expect(html).toContain('aria-label="Home composer"');
});
