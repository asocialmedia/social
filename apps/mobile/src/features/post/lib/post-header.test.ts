import { describe, expect, test } from "bun:test";

import { externalPostHeader, externalUriActor } from "./post-header";

const URI = "at://did:plc:abc123/app.bsky.feed.post/3k";

describe("externalUriActor", () => {
  test("reads the DID from an at:// URI", () => {
    expect(externalUriActor(URI)).toBe("did:plc:abc123");
  });

  test("returns an empty actor for other ids", () => {
    expect(externalUriActor("post-1")).toBe("");
  });
});

describe("externalPostHeader", () => {
  test("prefers the fetched profile's name, handle and banner", () => {
    expect(
      externalPostHeader(
        {
          avatarUrl: "post-avatar",
          displayName: "Post Name",
          handle: "post.bsky.social",
        },
        {
          avatarUrl: "profile-avatar",
          bannerUrl: "profile-banner",
          displayName: "Profile Name",
          handle: "profile.bsky.social",
        }
      )
    ).toEqual({
      bannerUrl: "profile-banner",
      subtitle: "@profile.bsky.social",
      title: "Profile Name's Post",
    });
  });

  test("falls back to the post author and their avatar", () => {
    expect(
      externalPostHeader(
        { avatarUrl: "post-avatar", displayName: "", handle: "a.bsky.social" },
        null
      )
    ).toEqual({
      bannerUrl: "post-avatar",
      subtitle: "@a.bsky.social",
      title: "a.bsky.social's Post",
    });
  });

  test("an unavailable post uses web's profile-only fallback copy", () => {
    expect(externalPostHeader(null, null)).toEqual({
      bannerUrl: null,
      subtitle: "Bluesky",
      title: "Post",
    });
    expect(
      externalPostHeader(null, { avatarUrl: "avatar", handle: "h.bsky.social" })
    ).toEqual({
      bannerUrl: "avatar",
      subtitle: "@h.bsky.social",
      title: "Post",
    });
  });
});
