import { expect, mock, test } from "bun:test";

const media = [{ commentId: "unsafe-image", safety: { explicit: true } }];
mock.module("@asm/db", () => ({
  findVisiblePost: () => null,
  prisma: {
    orm: {
      public: {
        PostMedia: {
          where: () => ({
            select: () => ({ all: () => Promise.resolve(media) }),
          }),
        },
      },
    },
  },
  readNetworkPreferences: () => null,
}));

const { postContentReadable, postsForReader, commentsForReader } =
  await import("./reader-content-policy");

test("post details and response branches recheck text and inherited previews, preserving opted-in access", () => {
  const unsafe = { content: "#porn", explicitContent: false, id: "unsafe" };
  const safe = {
    content: "TypeScript tutorial",
    id: "safe",
    parentPost: unsafe,
  };
  expect(postContentReadable(unsafe, false)).toBe(false);
  expect(postContentReadable(unsafe, true)).toBe(true);
  expect(postsForReader([safe, unsafe], false)).toEqual([
    { ...safe, parentPost: null },
  ]);
  expect(postsForReader([unsafe], true)).toEqual([unsafe]);
  expect(
    postContentReadable({ content: "ordinary", moderated: true }, true)
  ).toBe(false);
});

test("unsafe comment text or classified attachments become placeholders while safe replies retain structure", async () => {
  const comments = [
    { content: "A clip", deleted: false, id: "unsafe-image" },
    { content: "#hentai", deleted: false, id: "unsafe-text" },
    {
      content: "A safe reply",
      deleted: false,
      id: "safe-reply",
      parentId: "unsafe-text",
    },
  ];
  expect(await commentsForReader(comments, false)).toEqual([
    { ...comments[0], content: "", deleted: true },
    { ...comments[1], content: "", deleted: true },
    comments[2],
  ]);
  expect(await commentsForReader(comments, true)).toEqual(comments);
});
