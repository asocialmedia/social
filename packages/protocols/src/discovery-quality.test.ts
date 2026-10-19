import { expect, test } from "bun:test";

import { isDiscoveryColdStart } from "./discovery-quality";

test("guests, empty accounts and weak incidental signals use engagement-qualified discovery", () => {
  expect(isDiscoveryColdStart([])).toBe(true);
  expect(
    isDiscoveryColdStart([], {
      authorWeights: { "bluesky:followed": 0.1 },
      tagWeights: { politics: 0.02 },
    })
  ).toBe(true);
  expect(isDiscoveryColdStart(["software"])).toBe(false);
  expect(isDiscoveryColdStart([], { tagWeights: { software: 0.3 } })).toBe(
    false
  );
  expect(
    isDiscoveryColdStart([], { authorWeights: { "bluesky:developer": 3 } })
  ).toBe(false);
  expect(isDiscoveryColdStart([], { tagWeights: { spam: Number.NaN } })).toBe(
    true
  );
});

test("a newly configured interest profile still needs engaged defaults until activity accumulates", () => {
  const seeded = { tagWeights: { software: 0.8 } };
  expect(isDiscoveryColdStart(["software"], seeded, 0)).toBe(true);
  expect(isDiscoveryColdStart(["software"], seeded, 2)).toBe(true);
  expect(isDiscoveryColdStart(["software"], seeded, 5)).toBe(false);
});
