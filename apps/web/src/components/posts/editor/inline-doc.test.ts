import { describe, expect, test } from "bun:test";

import { textToDoc } from "./inline-doc";

describe("textToDoc", () => {
  test("keeps plain text as a single paragraph node", () => {
    expect(textToDoc("hello world", false)).toEqual({
      content: [
        { content: [{ text: "hello world", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
  });

  test("rehydrates mentions and hashtags into pills", () => {
    const doc = textToDoc("hey @ada #design thanks", false);
    expect(doc.content?.[0]?.content).toEqual([
      { text: "hey ", type: "text" },
      {
        attrs: { avatarUrl: "", displayName: "ada", id: "", username: "ada" },
        type: "mention",
      },
      { text: " ", type: "text" },
      { attrs: { tag: "design" }, type: "hashtag" },
      { text: " thanks", type: "text" },
    ]);
  });

  test("marks URLs as links only when links are enabled", () => {
    const withLinks = textToDoc("see https://a.test/x now", true);
    expect(withLinks.content?.[0]?.content).toEqual([
      { text: "see ", type: "text" },
      {
        marks: [{ attrs: { href: "https://a.test/x" }, type: "link" }],
        text: "https://a.test/x",
        type: "text",
      },
      { text: " now", type: "text" },
    ]);

    const withoutLinks = textToDoc("see https://a.test/x now", false);
    expect(withoutLinks.content?.[0]?.content).toEqual([
      { text: "see ", type: "text" },
      { text: "https://a.test/x", type: "text" },
      { text: " now", type: "text" },
    ]);
  });

  test("splits lines into paragraphs and keeps blank lines", () => {
    const doc = textToDoc("one\n\n@ada", false);
    expect(doc.content?.map((node) => node.content)).toEqual([
      [{ text: "one", type: "text" }],
      undefined,
      [
        {
          attrs: {
            avatarUrl: "",
            displayName: "ada",
            id: "",
            username: "ada",
          },
          type: "mention",
        },
      ],
    ]);
  });
});
