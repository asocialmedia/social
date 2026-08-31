import {
  getFullPostPath,
  getPostMediaPath,
  getPostMediaUrl,
  getPostPath,
  getPostSlug,
  getPostUrl,
} from "./post-url";

describe("post-url", () => {
  test("getPostSlug extracts clean slugs from content", () => {
    expect(getPostSlug("Use of free will")).toBe("use-of-free-will");
    expect(
      getPostSlug(
        "This is a long post about Next.js 16 and React 19 performance"
      )
    ).toBe("this-is-a-long-post-about-next-js-16-and-react-19");
    expect(getPostSlug("Hello, world! Welcome to @asm!")).toBe(
      "hello-world-welcome-to-asm"
    );
    expect(getPostSlug("Check https://example.com/some/path for updates")).toBe(
      "check-for-updates"
    );
    expect(getPostSlug("🎉 🚀 100% working now!")).toBe("100-working-now");
    expect(getPostSlug("")).toBe("");
    expect(getPostSlug(null)).toBe("");
    expect(getPostSlug()).toBe("");
    expect(getPostSlug("   ")).toBe("");
    expect(getPostSlug("```const x = 1;``` Awesome code")).toBe("awesome-code");
  });

  test("getPostPath generates short URLs with and without slugs by default", () => {
    expect(
      getPostPath({
        content: "Use of free will",
        id: "4f2f26c7-447a-4c66-b02a-67f539c2ab18",
      })
    ).toBe("/posts/4f2f26c7/use-of-free-will");

    expect(
      getPostPath({
        content: "",
        id: "4f2f26c7-447a-4c66-b02a-67f539c2ab18",
      })
    ).toBe("/posts/4f2f26c7");

    expect(
      getPostPath({
        content: "Video post",
        id: "video-123",
        isGust: true,
      })
    ).toBe("/gusts?id=video-123");
  });

  test("getFullPostPath generates unshortened UUID URLs", () => {
    expect(
      getFullPostPath({
        content: "Use of free will",
        id: "4f2f26c7-447a-4c66-b02a-67f539c2ab18",
      })
    ).toBe("/posts/4f2f26c7-447a-4c66-b02a-67f539c2ab18/use-of-free-will");
  });

  test("getPostMediaPath generates shortened media URLs", () => {
    expect(
      getPostMediaPath({ id: "50769dc7-447a-4c66-b02a-67f539c2ab18" }, 0)
    ).toBe("/posts/50769dc7/media/0");
  });

  test("getPostUrl and getPostMediaUrl generate absolute URLs", () => {
    const url = getPostUrl({
      content: "Hello World",
      id: "50769dc7-447a-4c66-b02a-67f539c2ab18",
    });
    expect(url).toContain("/posts/50769dc7/hello-world");

    const mediaUrl = getPostMediaUrl(
      { id: "50769dc7-447a-4c66-b02a-67f539c2ab18" },
      1
    );
    expect(mediaUrl).toContain("/posts/50769dc7/media/1");
  });
});
