import { expect, test } from "bun:test";

import {
  matchesNetworkInterests,
  networkInterestScore,
  networkInterestTerms,
} from "./network-interest-scope";
import type { NetworkTopicScope } from "./network-topics";

const scope: NetworkTopicScope = {
  avoided: {},
  interests: {
    anime: ["manga", "naruto"],
    software: ["postgresql", "compiler construction"],
    "web development": ["typescript", "next.js", "react hooks"],
  },
  version: "fixture-taxonomy",
};

test("eligibility uses supplied topic relationships rather than a built-in subject map", () => {
  expect(networkInterestTerms(["anime"])).toEqual(["anime"]);
  expect(
    matchesNetworkInterests("Naruto chapter discussion", [], ["anime"])
  ).toBe(false);
  expect(
    matchesNetworkInterests("Naruto chapter discussion", [], ["anime"], scope)
  ).toBe(true);
  expect(
    matchesNetworkInterests("Election news", ["politics"], ["anime"], scope)
  ).toBe(false);
  expect(
    matchesNetworkInterests(
      "PostgreSQL query optimization",
      [],
      ["software"],
      scope
    )
  ).toBe(true);
  expect(
    matchesNetworkInterests(
      "Next.js server components",
      [],
      ["web development"],
      scope
    )
  ).toBe(true);
  expect(
    matchesNetworkInterests("", ["WebDevelopment"], ["web development"])
  ).toBe(true);
});

test("changing dynamic evidence changes arbitrary-topic results without source changes", () => {
  const arbitrary = "obscure instrument restoration";
  const first: NetworkTopicScope = {
    avoided: {},
    interests: { [arbitrary]: ["violin varnish"] },
    version: "first",
  };
  const second: NetworkTopicScope = {
    ...first,
    interests: { [arbitrary]: ["cello bridges"] },
    version: "second",
  };
  expect(
    matchesNetworkInterests("Violin varnish tutorial", [], [arbitrary], first)
  ).toBe(true);
  expect(
    matchesNetworkInterests("Violin varnish tutorial", [], [arbitrary], second)
  ).toBe(false);
  expect(
    matchesNetworkInterests("Cello bridges", [], [arbitrary], second)
  ).toBe(true);
});

test("generic substrings and absent relationships do not widen a focused profile", () => {
  expect(
    matchesNetworkInterests(
      "Voters react to the next election; technically close",
      [],
      ["web development", "software", "tech"],
      scope
    )
  ).toBe(false);
  expect(
    matchesNetworkInterests(
      "The car has rust on its doors",
      [],
      ["software"],
      scope
    )
  ).toBe(false);
  expect(
    matchesNetworkInterests(
      "Orchid photography",
      ["orchids"],
      ["software"],
      scope
    )
  ).toBe(false);
  expect(matchesNetworkInterests("Any topic", [], [])).toBe(true);
  expect(
    networkInterestScore(
      "Software and web development",
      [],
      ["software", "web development"],
      scope
    )
  ).toBe(2);
});

test("short inferred aliases cannot admit unrelated posts while explicitly selected acronyms still work", () => {
  const aliases: NetworkTopicScope = {
    avoided: {},
    interests: { typescript: ["ts", "typescript compiler"] },
    version: "short-alias-regression",
  };
  expect(networkInterestTerms(["typescript"], aliases)).toEqual([
    "typescript",
    "typescript compiler",
  ]);
  expect(
    matchesNetworkInterests("Hoppers (2026, TS)", [], ["typescript"], aliases)
  ).toBe(false);
  expect(
    matchesNetworkInterests("Film clip", ["ts"], ["typescript"], aliases)
  ).toBe(false);
  expect(
    matchesNetworkInterests(
      "TypeScript compiler demonstration",
      [],
      ["typescript"],
      aliases
    )
  ).toBe(true);
  expect(matchesNetworkInterests("TS discussion", [], ["ts"], aliases)).toBe(
    true
  );
});

// Postgres raises on tsquery operators, so a saved interest like "(x)" used to
// take the whole feed down for that account on every request.
test("retrieval terms are always safe for plainto_tsquery", () => {
  const unsafe = ["(x)", "user@site", "a:b", "rock & roll", "a|b", "it's"];
  for (const interest of unsafe) {
    const terms = networkInterestTerms([interest]);
    for (const term of terms) {
      expect(term).not.toMatch(/[()@:&|!'"]/u);
    }
  }
});

// A dotted or hyphenated interest is one lexeme to the tokenizer, so the spaced
// form alone retrieves nothing.
test("compound interests keep a joined retrieval variant", () => {
  expect(networkInterestTerms(["node.js"])).toContain("nodejs");
  expect(networkInterestTerms(["web-development"])).toEqual(
    expect.arrayContaining(["web development", "webdevelopment"])
  );
  // "c++" survives as a token the tokenizer indexes.
  expect(networkInterestTerms(["c++"])).toEqual(["c++"]);
  // A declared multi-word phrase is a name, not a compound: no run-on token.
  expect(networkInterestTerms(["typescript compiler"])).not.toContain(
    "typescriptcompiler"
  );
});
