import { describe, expect, test } from "bun:test";

import {
  communityChatHref,
  communityPostsHref,
  communitySectionScope,
  rememberCommunityChatHref,
  rememberCommunityPostsHref,
} from "./community-section-links";

describe("community section links", () => {
  test("posts href is the community root until a filtered visit is remembered", () => {
    expect(communityPostsHref("hopper", "hackers")).toBe("/a/hackers");
    rememberCommunityPostsHref("ada", "hackers", "/a/hackers?sort=top&media=1");
    expect(communityPostsHref("ada", "hackers")).toBe(
      "/a/hackers?sort=top&media=1"
    );
    // A bare root never overwrites the remembered filtered href from the
    // chat side: the chat screen only ever remembers chat hrefs.
    expect(communityPostsHref(undefined, "hackers")).toBe("/a/hackers");
  });

  test("chat href prefers the channel, then memory, then the chat index", () => {
    expect(communityChatHref("grace", "hackers")).toBe("/a/hackers/chat");
    expect(communityChatHref("grace", "hackers", "general")).toBe(
      "/a/hackers/chat/general"
    );
    rememberCommunityChatHref("grace", "hackers", "/a/hackers/chat/general");
    expect(communityChatHref("grace", "hackers")).toBe(
      "/a/hackers/chat/general"
    );
  });

  test("scopes isolate viewers so accounts never share return destinations", () => {
    rememberCommunityChatHref("ada", "solar", "/a/solar/chat/alpha");
    expect(communityChatHref("grace", "solar")).toBe("/a/solar/chat");
    expect(communityChatHref("ada", "solar")).toBe("/a/solar/chat/alpha");
    expect(communitySectionScope("ada", "solar")).not.toBe(
      communitySectionScope("grace", "solar")
    );
    expect(communitySectionScope(undefined, "solar")).toBe(
      JSON.stringify(["guest", "solar"])
    );
  });

  test("scopes stay bounded like web's store", () => {
    for (let index = 0; index < 40; index += 1) {
      rememberCommunityChatHref(
        `viewer-${index}`,
        "overflow",
        `/a/overflow/chat/c${index}`
      );
    }
    // The earliest scopes fall out; the latest ones survive.
    expect(communityChatHref("viewer-0", "overflow")).toBe("/a/overflow/chat");
    expect(communityChatHref("viewer-39", "overflow")).toBe(
      "/a/overflow/chat/c39"
    );
  });
});
