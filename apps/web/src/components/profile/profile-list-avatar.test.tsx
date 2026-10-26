import { expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

let visible = false;
let profile: { data?: { avatarUrl?: string }; isPending: boolean } = {
  isPending: true,
};
const reads: { actor: string; enabled: boolean }[] = [];
mock.module("react-intersection-observer", () => ({
  useInView: () => ({ inView: visible, ref: () => {} }),
}));
mock.module("@/components/protocols/use-bluesky-profile", () => ({
  useBlueskyProfile: (actor: string, _initial: unknown, enabled: boolean) => {
    reads.push({ actor, enabled });
    return profile;
  },
}));
const { ProfileListAvatar } = await import("./profile-list-avatar");
const external = {
  avatarUrl: null,
  id: "did:plc:alice",
  source: "bluesky" as const,
  status: "active",
  username: "alice.test",
};

test("native list avatars retain their image and never request a Bluesky profile", () => {
  reads.length = 0;
  const html = renderToStaticMarkup(
    <ProfileListAvatar
      user={{ ...external, avatarUrl: "/avatars/default-2.png", source: "asm" }}
    />
  );
  expect(html).toContain("/avatars/default-2.png");
  expect(reads).toEqual([]);
});

test("remote avatars wait for visibility with stable squircle skeleton dimensions", () => {
  visible = false;
  profile = { isPending: true };
  const html = renderToStaticMarkup(<ProfileListAvatar user={external} />);
  expect(reads.at(-1)).toEqual({ actor: external.id, enabled: false });
  expect(html).toContain("Loading avatar for @alice.test");
  expect(html).toContain("size-11 rounded-[30%]");
  expect(html).not.toContain("/avatars/default-");
});

test("visible Bluesky rows use the cached full profile avatar directly from its sized CDN derivative", () => {
  visible = true;
  const avatarUrl =
    "https://cdn.bsky.app/img/avatar/plain/did:plc:alice/image@jpeg";
  profile = { data: { avatarUrl }, isPending: false };
  const html = renderToStaticMarkup(<ProfileListAvatar user={external} />);
  expect(reads.at(-1)).toEqual({ actor: external.id, enabled: true });
  expect(html).toContain(`src="${avatarUrl}"`);
  expect(html).not.toContain("/_next/image");
  expect(html).not.toContain("Loading avatar");
});

test("an unavailable profile leaves a stable default avatar without blocking the people list", () => {
  profile = { isPending: false };
  const html = renderToStaticMarkup(<ProfileListAvatar user={external} />);
  expect(html).toContain("/avatars/default-");
  expect(html).toContain('width="44"');
  expect(html).not.toContain("Loading avatar");
});

test("deleted remote authors are not fetched and keep a default avatar", () => {
  visible = true;
  profile = { isPending: true };
  const html = renderToStaticMarkup(
    <ProfileListAvatar user={{ ...external, status: "deleted" }} />
  );
  expect(reads.at(-1)?.enabled).toBe(false);
  expect(html).toContain("/avatars/default-");
});
