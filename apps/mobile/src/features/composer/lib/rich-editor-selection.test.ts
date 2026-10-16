import { describe, expect, test } from "bun:test";

import { textToDoc } from "@asm/ui/lib/inline-editor-doc";

import { applySuggestion, activeTrigger } from "./inline-relations";
import {
  editorPositionForTextOffset,
  textOffsetForEditorPosition,
} from "./rich-editor-selection";

describe("rich composer selection", () => {
  test("preserves the cursor after badges, links and paragraph breaks", () => {
    const text = "Hello @ada #design\n\nhttps://example.com next";
    const doc = textToDoc(text, true);
    for (const offset of [0, 6, 10, 11, 18, 19, 20, text.length]) {
      expect(
        textOffsetForEditorPosition(
          doc,
          editorPositionForTextOffset(doc, offset)
        )
      ).toBe(offset);
    }
  });

  test("autocomplete replaces the query after an earlier badge without losing following text", () => {
    const text = "@ada says #de later";
    const doc = textToDoc(text, true);
    const cursor = textOffsetForEditorPosition(
      doc,
      editorPositionForTextOffset(doc, 13)
    );
    const trigger = activeTrigger(text, cursor);
    expect(trigger).toEqual({ query: "de", start: 10, trigger: "#" });
    if (!trigger) {
      throw new Error("Missing tag trigger");
    }
    expect(applySuggestion(text, cursor, trigger, "design")).toEqual({
      cursor: 18,
      text: "@ada says #design  later",
    });
  });

  test("positions inside badges snap to the end of the token", () => {
    const doc = textToDoc("@ada hi", true);
    expect(editorPositionForTextOffset(doc, 2)).toBe(2);
    expect(textOffsetForEditorPosition(doc, 2)).toBe(4);
  });
});
