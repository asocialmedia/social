import { expect, mock, test } from "bun:test";

import { renderToReadableStream } from "react-dom/server";

let signedIn = true;
mock.module("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("GUEST_NOT_FOUND");
  },
}));
mock.module("@asm/db", () => ({
  and: () => {},
  communityVisibilityWhere: () => () => {},
  getPostDataQuery: () => ({
    where: () => ({ first: () => Promise.resolve(null) }),
  }),
  mapPostData: (value: unknown) => value,
  prisma: { orm: {} },
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () =>
    Promise.resolve(signedIn ? { user: { id: "member" } } : null),
}));
mock.module("@/hooks/users/use-user-data", () => ({
  getUserData: () => Promise.resolve(null),
}));
mock.module("@/lib/posts/server-feed", () => ({
  getRecentGustsForCrawl: () => Promise.resolve([]),
}));
mock.module("@/lib/posts/reader-content-policy", () => ({
  postContentReadable: () => true,
}));
mock.module("./client-gusts", () => ({
  ClientGusts: () => <div>live-gust-reader</div>,
}));
mock.module("@/components/gusts/gust-card-skeleton", () => ({
  GustCardSkeleton: () => null,
}));
const { default: Page, generateMetadata } = await import("./page");

test("guest-only metadata misses remain non-indexed without denying the signed-in Gust reader", async () => {
  signedIn = true;
  const params = { searchParams: Promise.resolve({ id: "private-gust" }) };
  expect(await generateMetadata(params)).toMatchObject({
    robots: { index: false },
  });
  const stream = await renderToReadableStream(<Page {...params} />);
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("live-gust-reader");
  expect(html).not.toContain("SocialMediaPosting");
});

test("a missing guest Gust still rejects the public body", async () => {
  signedIn = false;
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    <Page searchParams={Promise.resolve({ id: "missing" })} />,
    {
      onError: (error) => {
        errors.push(error);
      },
    }
  );
  await stream.allReady;
  await new Response(stream).text();
  expect(
    errors.some(
      (error) => error instanceof Error && error.message === "GUEST_NOT_FOUND"
    )
  ).toBe(true);
  signedIn = true;
});
