import { expect, mock, test } from "bun:test";

let optedIn = false;
mock.module("@asm/db", () => ({
  findVisiblePost: () => null,
  prisma: {
    orm: {
      public: {
        PostMedia: {
          where: () => ({ select: () => ({ all: () => Promise.resolve([]) }) }),
        },
      },
    },
  },
  readNetworkPreferences: () =>
    Promise.resolve({ preferences: { showExplicitContent: optedIn } }),
}));

const { threadStreamContent } = await import("./thread-stream-policy");

test("response streams remove unsafe parent previews and recheck the reader's opt-in for every event", async () => {
  const response = {
    content: "A safe response",
    id: "response",
    parentPost: { content: "#porn", id: "parent" },
  };
  expect(await threadStreamContent(response, "viewer", false)).toMatchObject({
    parentPost: null,
  });
  expect(
    await threadStreamContent(response.parentPost, "viewer", false)
  ).toBeNull();
  optedIn = true;
  expect(await threadStreamContent(response, "viewer", false)).toMatchObject({
    parentPost: response.parentPost,
  });
  optedIn = false;
  expect(await threadStreamContent(response, "viewer", false)).toMatchObject({
    parentPost: null,
  });
});

test("malformed parent previews cannot bypass stream policy", async () => {
  expect(
    await threadStreamContent(
      { content: "safe", id: "response", parentPost: "#porn" },
      "viewer",
      false
    )
  ).toBeNull();
});
