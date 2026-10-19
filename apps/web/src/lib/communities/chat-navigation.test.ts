import { expect, test } from "bun:test";

import { isCommunityChatPath } from "./chat-navigation";

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
