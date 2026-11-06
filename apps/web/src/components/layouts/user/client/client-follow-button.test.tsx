import { expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/hooks/auth/use-require-auth", () => ({
  useRequireAuth: () => ({ isLoggedIn: true, user: { id: "viewer" } }),
}));
mock.module("@/hooks/users/user-mutations", () => ({
  useFollowUserMutation: () => ({ isPending: false, mutateAsync: () => {} }),
  useUnfollowUserMutation: () => ({ isPending: false, mutateAsync: () => {} }),
}));
mock.module("./follow-state", () => ({
  useFollowStateStore: () => ({ followMap: {}, setUserFollowState: () => {} }),
}));
const { default: ClientFollowButton } = await import("./client-follow-button");

test.each([false, true])(
  "native follow state %s uses the matching raised button color",
  (following) => {
    const client = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ClientFollowButton
          userId="author"
          initialState={{ followers: 1, isFollowedByUser: following }}
        />
      </QueryClientProvider>
    );
    expect(html).toContain(following ? ">Following<" : ">Follow<");
    expect(html).toContain(following ? "btn-3d-gray" : "btn-3d ");
    expect(html).not.toContain("follow-btn-3d");
    expect(html).toContain("text-[13px]! sm:text-sm!");
    expect(html).toContain("inline-flex shrink-0");
    client.clear();
  }
);
