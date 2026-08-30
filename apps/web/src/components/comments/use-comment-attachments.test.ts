import { describe, expect, test } from "bun:test";

import React from "react";
import { renderToString } from "react-dom/server";

import { useCommentAttachments } from "./use-comment-attachments";

function TestComponent() {
  const { attachments, isUploading, mediaIds } = useCommentAttachments();
  return React.createElement(
    "div",
    null,
    React.createElement(
      "span",
      { "data-testid": "count" },
      `${attachments.length}`
    ),
    React.createElement(
      "span",
      { "data-testid": "uploading" },
      `${isUploading}`
    ),
    React.createElement(
      "span",
      { "data-testid": "media-count" },
      `${mediaIds.length}`
    )
  );
}

describe("useCommentAttachments", () => {
  test("renders initial empty state", () => {
    const html = renderToString(React.createElement(TestComponent));
    expect(html).toContain(">0<");
    expect(html).toContain(">false<");
  });
});
