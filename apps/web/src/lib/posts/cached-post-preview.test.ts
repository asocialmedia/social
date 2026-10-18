import { expect, test } from "bun:test";

import { cachedPostPreview } from "./cached-post-preview";

const portraitPost = {
  attachments: [{ height: 1920, type: "VIDEO", width: 1080 }],
  content: "",
  id: "7e422386-full-id",
};

test("post-route placeholders find full or short ids in paginated feed caches", () => {
  const cache = {
    pages: [
      {
        posts: [
          { attachments: [], content: "other", id: "different" },
          portraitPost,
        ],
      },
    ],
  };
  expect(cachedPostPreview(cache, "7e422386")).toMatchObject(portraitPost);
  expect(cachedPostPreview(cache, "7e422386-full-id")).toMatchObject(
    portraitPost
  );
  expect(cachedPostPreview({ post: portraitPost }, "7e422386")).toMatchObject(
    portraitPost
  );
});

test("unrelated cache entries and overly broad prefixes do not supply media hints", () => {
  expect(
    cachedPostPreview({ pages: [{ posts: [portraitPost] }] }, "7e42")
  ).toBeUndefined();
  expect(
    cachedPostPreview({ post: portraitPost }, "unknown-id")
  ).toBeUndefined();
  expect(
    cachedPostPreview({ id: "7e422386", name: "an account" }, "7e422386")
  ).toBeUndefined();
  expect(cachedPostPreview(null, "7e422386")).toBeUndefined();
});
