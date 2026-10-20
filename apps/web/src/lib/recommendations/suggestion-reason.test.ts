import { expect, test } from "bun:test";

import { suggestionReason } from "./suggestion-reason";

const profile = {
  authorWeights: {},
  negativeTagWeights: { politics: 1 },
  tagWeights: { cooking: 0.01, software: 0.3 },
};
test("reasons require actual topic evidence and name the configured interest", () => {
  expect(
    suggestionReason(
      profile,
      ["formula 1"],
      "Formula 1 race analysis",
      [],
      "person"
    )
  ).toBe("Shares your interest in formula 1");
  expect(
    suggestionReason(profile, ["formula 1"], "Unrelated news", [], "person")
  ).toBeNull();
  expect(
    suggestionReason(profile, ["formula 1"], "Cooking recipes", [], "person")
  ).toBeNull();
  expect(
    suggestionReason(profile, [], "Software development", [], "person")
  ).toBe("You’ve been exploring software");
});
test("taxonomy aliases can explain a real match without inventing interest evidence", () => {
  expect(
    suggestionReason(profile, ["formula 1"], "F1 race strategy", [], "person", {
      avoided: {},
      interests: { "formula 1": ["f1"] },
      version: "test",
    })
  ).toBe("Shares your interest in formula 1");
});
