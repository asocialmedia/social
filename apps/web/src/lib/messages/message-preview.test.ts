// What a conversation list row says for a message, derived on the client because
// the server stores only ciphertext.

import { describe, expect, test } from "bun:test";

import type { MessagePayload } from "./crypto";
import { conversationPreviewText, messagePreviewText } from "./message-preview";

describe("messagePreviewText", () => {
  test("a text message previews its body", () => {
    expect(
      messagePreviewText({ content: "see you at six", type: "text" })
    ).toBe("see you at six");
  });

  test("a body is collapsed to one line", () => {
    // A preview is a row the list truncates with CSS; a literal newline would
    // change the row's height instead.
    expect(
      messagePreviewText({
        content: "first line\n\nsecond   line",
        type: "text",
      })
    ).toBe("first line second line");
  });

  // The difference from the transcript's quote label, and the reason this function
  // is not simply reused there: a quote of a captioned photo says "Shared an image"
  // because the quote cannot show the picture, while a list with no picture at all
  // would be throwing away the only words the sender wrote.
  test("a caption is the preview even when the message is a photo", () => {
    expect(
      messagePreviewText({
        content: "look at this",
        images: [{ url: "/api/media/a" }],
        kind: "image",
        type: "media",
      })
    ).toBe("look at this");
  });

  test("a captionless album counts its images", () => {
    expect(
      messagePreviewText({
        images: [{ url: "/a" }, { url: "/b" }, { url: "/c" }],
        kind: "image",
        type: "media",
      })
    ).toBe("Shared 3 images");
    expect(
      messagePreviewText({
        images: [{ url: "/a" }],
        kind: "image",
        type: "media",
      })
    ).toBe("Shared an image");
  });

  test("a gif says gif", () => {
    expect(
      messagePreviewText({
        images: [{ url: "/a" }],
        kind: "gif",
        type: "media",
      })
    ).toBe("Shared a GIF");
    // The legacy single-URL shape previews the same way.
    expect(messagePreviewText({ kind: "gif", type: "media", url: "/a" })).toBe(
      "Shared a GIF"
    );
  });

  test("a shared post says post", () => {
    expect(messagePreviewText({ postId: "p1", type: "post" })).toBe(
      "Shared a post"
    );
  });

  test("a shape this build does not know previews as nothing", () => {
    expect(messagePreviewText({ content: "", type: "text" })).toBe("");
  });
});

describe("conversationPreviewText", () => {
  const text: MessagePayload = { content: "hello", type: "text" };

  test("an own message is framed as the reader's own", () => {
    expect(
      conversationPreviewText({ deleted: false, mine: true, payload: text })
    ).toBe("You: hello");
    expect(
      conversationPreviewText({ deleted: false, mine: false, payload: text })
    ).toBe("hello");
  });

  // Deleted wins over the payload: the sender took the message back, and what its
  // ciphertext still decrypts to is not what the conversation says any more.
  test("a deleted message says so whatever it decrypts to", () => {
    expect(
      conversationPreviewText({ deleted: true, mine: false, payload: text })
    ).toBe("This message was deleted");
    expect(
      conversationPreviewText({ deleted: true, mine: true, payload: text })
    ).toBe("This message was deleted");
  });

  test("an undecrypted message is silent, not empty-sounding", () => {
    expect(
      conversationPreviewText({
        deleted: false,
        mine: false,
        payload: undefined,
      })
    ).toBe("");
  });
});
