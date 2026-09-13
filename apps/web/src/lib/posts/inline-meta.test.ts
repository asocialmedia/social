import { describe, expect, test } from "bun:test";

import { extractInlineMeta } from "./inline-meta";

describe("extractInlineMeta", () => {
  test("returns empty sets for content without tokens", () => {
    const { tags, usernames } = extractInlineMeta("just a normal sentence");
    expect(tags.size).toBe(0);
    expect(usernames.size).toBe(0);
  });

  test("extracts lowercased usernames and tags", () => {
    const { tags, usernames } = extractInlineMeta(
      "hey @Ada and @bob check #Design #web-dev"
    );
    expect([...usernames].toSorted()).toEqual(["ada", "bob"]);
    expect([...tags].toSorted()).toEqual(["design", "web-dev"]);
  });

  test("dedupes repeated tokens", () => {
    const { tags, usernames } = extractInlineMeta("@ada @Ada #Tag #tag");
    expect([...usernames]).toEqual(["ada"]);
    expect([...tags]).toEqual(["tag"]);
  });
});
