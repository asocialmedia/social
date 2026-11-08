import { describe, expect, test } from "bun:test";

import { HttpError } from "@/features/media-upload/lib/retry";

import { altSuggestToastCopy, classifyAltSuggest } from "./alt-text-suggest";

describe("alt-text suggestion matrix", () => {
  test("no media id asks the writer to wait for the upload", () => {
    expect(classifyAltSuggest({})).toEqual({ kind: "missing" });
    expect(altSuggestToastCopy({ kind: "missing" }).title).toBe(
      "Media upload in progress"
    );
  });

  test("a suggestion wins and is trimmed to the max length", () => {
    const outcome = classifyAltSuggest({
      result: { suggestedAlt: `${"a".repeat(1200)}` },
    });
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.suggestion).toHaveLength(1000);
    }
    expect(
      altSuggestToastCopy({ kind: "success", suggestion: "x" }).title
    ).toBe("Alt text generated from media analysis");
  });

  test("processing vs no-text split on the flag", () => {
    expect(classifyAltSuggest({ result: { isProcessing: true } })).toEqual({
      kind: "processing",
    });
    expect(classifyAltSuggest({ result: {} })).toEqual({ kind: "no-text" });
  });

  test("401/404 map to auth/stale, other HTTP maps to processing", () => {
    expect(
      classifyAltSuggest({ error: new HttpError("no", 401, null) })
    ).toEqual({ kind: "auth" });
    expect(
      classifyAltSuggest({ error: new HttpError("no", 404, null) })
    ).toEqual({ kind: "stale" });
    expect(
      classifyAltSuggest({ error: new HttpError("no", 500, null) })
    ).toEqual({ kind: "processing" });
  });

  test("non-HTTP failures map to the network copy", () => {
    expect(classifyAltSuggest({ error: new Error("offline") })).toEqual({
      kind: "network",
    });
  });
});
