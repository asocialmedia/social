import { describe, expect, test } from "bun:test";

import { redirectSystemPath } from "@/app/+native-intent";

const redirect = (path: string) => redirectSystemPath({ initial: true, path });

describe("system link redirect", () => {
  test("unmapped links land on home, never on the notifications list", () => {
    expect(redirect("https://asocialmedia.cc/about")).toBe("/");
    expect(redirect("https://asocialmedia.cc/soon")).toBe("/");
    expect(redirect("https://attacker.test/posts/1")).toBe("/");
  });

  test("community chat and video links reach their screens", () => {
    expect(redirect("https://asocialmedia.cc/a/code/chat/general")).toBe(
      "/a/code/chat/general"
    );
    expect(redirect("https://asocialmedia.cc/watch/p1/m1")).toBe(
      "/posts/p1/media/0?mediaId=m1"
    );
  });

  test("auth links still win over network paths", () => {
    expect(redirect("/two-factor")).toBe("/login");
  });
});
