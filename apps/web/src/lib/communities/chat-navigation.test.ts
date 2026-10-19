import { expect, test } from "bun:test";

import {
  communityChatLocation,
  communityChatRoomMatchesLocation,
  isCommunityChatPath,
} from "./chat-navigation";

test("community conversations use their own navigation without obscuring the composer", () => {
  for (const path of [
    "/a/photography/chat",
    "/a/photography/chat/general",
    "/a/photography/chat/general/threads/walk/",
  ]) {
    expect(isCommunityChatPath(path)).toBe(true);
  }
  for (const path of [
    "/a/photography",
    "/a/chat",
    "/a/photography/chatty",
    "/messages/chat",
    "/a/photography/chat/general/settings",
    "/a/photography/chat/general/threads",
  ]) {
    expect(isCommunityChatPath(path)).toBe(false);
  }
});

test("channel and thread URLs select the requested room without server route props", () => {
  expect(communityChatLocation("/a/table/chat/general", "table")).toEqual({
    channelId: "general",
    threadId: undefined,
  });
  expect(
    communityChatLocation("/a/table/chat/general/threads/private", "table")
  ).toEqual({ channelId: "general", threadId: "private" });
});

test("other communities and malformed paths cannot select a room in this workspace", () => {
  for (const path of [
    "/a/other/chat/general",
    "/a/table",
    "/a/table/chat",
    "/a/table/chat/general/threads",
    "/a/table/chat/general/posts/private",
    "/a/table/chat/general/threads/private/extra",
  ]) {
    expect(communityChatLocation(path, "table")).toBeNull();
  }
});

test("client switches preserve channel kind and thread parent validation", () => {
  expect(
    communityChatRoomMatchesLocation(
      { id: "general", kind: "CHANNEL", parentRoomId: null },
      "general"
    )
  ).toBe(true);
  expect(
    communityChatRoomMatchesLocation(
      { id: "private", kind: "THREAD", parentRoomId: "general" },
      "general",
      "private"
    )
  ).toBe(true);
  expect(
    communityChatRoomMatchesLocation(
      { id: "private", kind: "THREAD", parentRoomId: "other" },
      "general",
      "private"
    )
  ).toBe(false);
  expect(
    communityChatRoomMatchesLocation(
      { id: "private", kind: "THREAD", parentRoomId: "general" },
      "private"
    )
  ).toBe(false);
});
