import { expect, test } from "bun:test";

import { uniqueFeedContent } from "./unique-feed-content";

test("syndicated text copies cannot refill later pages while short captions and different quoted discussions survive", () => {
  const text =
    "A detailed TypeScript compiler release explains inference improvements and server component integration.";
  const ranked = [
    { id: "best", text, thread: "" },
    { id: "copy", text: text.toUpperCase().replaceAll(" ", "  "), thread: "" },
    { id: "other-thread", text, thread: "different-quote" },
    { id: "photo-one", text: "New work", thread: "" },
    { id: "photo-two", text: "New work", thread: "" },
  ];
  expect(
    uniqueFeedContent(
      ranked,
      (item) => item.text,
      (item) => item.thread
    ).map((item) => item.id)
  ).toEqual(["best", "other-thread", "photo-one", "photo-two"]);
});
