import { expect, test } from "bun:test";

import {
  DEN_BAN_PICKER_REFUSAL,
  GROUP_ADD_REFUSAL_COPY,
  dedupePickerCandidates,
  denAddRoom,
  denCreateNeedsOthers,
  denCreateRoom,
  pickerRowState,
  toPickerPerson,
} from "./member-picker-rules";

function person(id: string) {
  return {
    avatarUrl: null,
    displayName: `Person ${id}`,
    hasIdentity: true,
    id,
    username: id,
  };
}

test("a live row has no reason and is enabled", () => {
  expect(
    pickerRowState({
      atCeiling: false,
      banned: false,
      hasIdentity: true,
      isSelected: false,
    })
  ).toEqual({ disabled: false, reason: null });
});

test("the ban reason wins over identity and group-add refusals", () => {
  const state = pickerRowState({
    addRefusal: "NO_DIRECT_ADDS",
    atCeiling: false,
    banned: true,
    hasIdentity: false,
    isSelected: false,
  });
  expect(state.disabled).toBe(true);
  expect(state.reason).toBe(DEN_BAN_PICKER_REFUSAL);
  expect(state.reason).toBe("banned from this den");
  expect(state.reason).not.toContain("you");
});

test("no identity and each group-add refusal render web's copy", () => {
  expect(
    pickerRowState({
      atCeiling: false,
      banned: false,
      hasIdentity: false,
      isSelected: false,
    }).reason
  ).toBe("hasn't enabled Messages");
  expect(
    pickerRowState({
      addRefusal: "NO_DIRECT_ADDS",
      atCeiling: false,
      banned: false,
      hasIdentity: true,
      isSelected: false,
    }).reason
  ).toBe(GROUP_ADD_REFUSAL_COPY.NO_DIRECT_ADDS);
  expect(
    pickerRowState({
      addRefusal: "NOT_FOLLOWING_YOU",
      atCeiling: false,
      banned: false,
      hasIdentity: true,
      isSelected: false,
    }).reason
  ).toBe(GROUP_ADD_REFUSAL_COPY.NOT_FOLLOWING_YOU);
  expect(GROUP_ADD_REFUSAL_COPY.NO_DIRECT_ADDS).toBe(
    "doesn't allow being added to groups"
  );
  expect(GROUP_ADD_REFUSAL_COPY.NOT_FOLLOWING_YOU).toBe(
    "only lets people they follow add them"
  );
});

test("the ceiling disables unselected rows without a reason, never a picked row", () => {
  expect(
    pickerRowState({
      atCeiling: true,
      banned: false,
      hasIdentity: true,
      isSelected: false,
    })
  ).toEqual({ disabled: true, reason: null });
  expect(
    pickerRowState({
      atCeiling: true,
      banned: false,
      hasIdentity: true,
      isSelected: true,
    })
  ).toEqual({ disabled: false, reason: null });
});

test("recents dedupe across conversations, drop excluded ids and cap", () => {
  const rows = dedupePickerCandidates(
    [person("a"), person("b"), person("a"), person("c")],
    new Set(["b"]),
    2
  );
  expect(rows.map((row) => row.id)).toEqual(["a", "c"]);
});

test("den room arithmetic honours the ceiling", () => {
  expect(denCreateRoom()).toBe(99);
  expect(denCreateNeedsOthers()).toBe(1);
  expect(denAddRoom(3)).toBe(97);
  expect(denAddRoom(100)).toBe(0);
});

test("search results map to picker rows without enrichment", () => {
  expect(
    toPickerPerson({
      addRefusal: null,
      avatarUrl: null,
      badge: null,
      badges: [],
      displayName: "Ada",
      hasIdentity: true,
      id: "ada",
      username: "ada",
    })
  ).toEqual({
    addRefusal: null,
    avatarUrl: null,
    displayName: "Ada",
    hasIdentity: true,
    id: "ada",
    username: "ada",
  });
});
