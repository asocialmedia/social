import { describe, expect, test } from "bun:test";

import {
  activeTrigger,
  applySuggestion,
  collectRelations,
} from "./inline-relations";

describe("activeTrigger", () => {
  test("detects a mention or tag being typed at the cursor", () => {
    expect(activeTrigger("hi @ali", 7)).toEqual({
      query: "ali",
      start: 3,
      trigger: "@",
    });
    expect(activeTrigger("#", 1)).toEqual({
      query: "",
      start: 0,
      trigger: "#",
    });
  });

  test("ignores triggers glued to a word or behind the cursor", () => {
    expect(activeTrigger("mail@host", 9)).toBeNull();
    expect(activeTrigger("@ali done", 9)).toBeNull();
  });
});

describe("applySuggestion", () => {
  test("replaces the query with the token and a trailing space", () => {
    const active = activeTrigger("hey @al there", 7);
    expect(active).not.toBeNull();
    if (active) {
      expect(applySuggestion("hey @al there", 7, active, "alice")).toEqual({
        cursor: 11,
        text: "hey @alice  there",
      });
    }
  });
});

describe("collectRelations", () => {
  test("keeps only picks whose token is still in the text", () => {
    const relations = collectRelations("hi @alice #Cats and #dogs", {
      mentions: [
        { id: "u1", username: "alice" },
        { id: "u2", username: "bob" },
      ],
      tags: ["Cats", "birds"],
    });
    expect(relations).toEqual({ mentions: ["u1"], tags: ["cats"] });
  });

  test("does not match a longer handle that starts with the pick", () => {
    expect(
      collectRelations("@alicex", {
        mentions: [{ id: "u1", username: "alice" }],
        tags: [],
      }).mentions
    ).toEqual([]);
  });
});
