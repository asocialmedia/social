import { expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

const author = { displayName: "Alice", id: "did:plc:alice" };
let query = {
  data: author,
  isError: false,
  isFetching: false,
  isPending: false,
  refetch: mock(),
};
mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ actor: author.id }),
}));
mock.module("./use-bluesky-profile", () => ({
  useBlueskyProfile: () => query,
}));
mock.module("@/lib/posts/presentation", () => ({
  externalAuthorView: () => ({ id: author.id }),
}));
mock.module("@/app/(main)/users/[username]/client-profile", () => ({
  default: () => <main>Cached Alice profile</main>,
}));
mock.module("@/components/layouts/skeletons/profile-skeleton", () => ({
  default: () => <div>Loading profile</div>,
}));
mock.module("@/components/feeds/feed-error-state", () => ({
  FeedErrorState: ({
    message,
    isRetrying,
  }: {
    message: string;
    isRetrying: boolean;
  }) => (
    <aside>
      {message}
      <button disabled={isRetrying} type="button">
        Try again
      </button>
    </aside>
  ),
}));
const { ExternalProfilePage } = await import("./external-profile-page");

test("failed full profile refresh keeps the cached author and exposes retry feedback", () => {
  query = { ...query, isError: true };
  const html = renderToStaticMarkup(<ExternalProfilePage />);
  expect(html).toContain("Cached Alice profile");
  expect(html).toContain("Showing cached details");
  expect(html).toContain("Try again");
  expect(html).not.toContain("disabled");
});

test("profile refresh feedback disables retry during the next read", () => {
  query = { ...query, isError: true, isFetching: true };
  expect(renderToStaticMarkup(<ExternalProfilePage />)).toContain("disabled");
});

test("successful full profiles have no error notice", () => {
  query = { ...query, isError: false, isFetching: false };
  const html = renderToStaticMarkup(<ExternalProfilePage />);
  expect(html).toContain("Cached Alice profile");
  expect(html).not.toContain("Try again");
});
