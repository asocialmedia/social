import { expect, test } from "bun:test";

import { changedMessageIds } from "./changed-message-ids";

test("a cached message edited while offline invalidates only its obsolete plaintext", () => {
  const original = {
    ciphertext: "before",
    id: "edited",
    iv: "iv",
    ratchetIndex: 1,
  };
  expect(changedMessageIds([original], [{ ...original }])).toEqual([]);
  expect(
    changedMessageIds(
      [original],
      [
        { ...original, ciphertext: "after" },
        { ...original, id: "new" },
      ]
    )
  ).toEqual(["edited"]);
  expect(
    changedMessageIds([original], [{ ...original, iv: "new-iv" }])
  ).toEqual(["edited"]);
});
