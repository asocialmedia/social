import { expect, test } from "bun:test";

import { mergeCommunityChatMemberOptions } from "./community-chat-members";

function member(id: string, displayName = id) {
  return { avatarUrl: null, displayName, id, username: id };
}

test("member lookup pages replace duplicate profiles and preserve stable ordering", () => {
  const result = mergeCommunityChatMemberOptions(
    [member("a"), member("b")],
    [member("b", "Updated"), member("c")]
  );
  expect(result.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  expect(result[1]?.displayName).toBe("Updated");
});

test("browsing many member pages never retains the full roster", () => {
  let options = [] as ReturnType<typeof mergeCommunityChatMemberOptions>;
  for (let page = 0; page < 100; page += 1) {
    options = mergeCommunityChatMemberOptions(
      options,
      Array.from({ length: 20 }, (_, index) =>
        member(String(page * 20 + index))
      )
    );
    expect(options.length).toBeLessThanOrEqual(100);
  }
  expect(options[0]?.id).toBe("1900");
  expect(options.at(-1)?.id).toBe("1999");
});
