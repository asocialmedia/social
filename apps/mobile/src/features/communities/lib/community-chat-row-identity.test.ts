import { describe, expect, it } from "bun:test";

import type { CommunityChatMessage } from "@asm/messages";

import {
  sameCommunityChatMessageRow,
  stabilizeCommunityChatRows,
} from "./community-chat-row-identity";

function row(
  overrides: Partial<CommunityChatMessage> = {}
): CommunityChatMessage {
  return {
    changeSequence: "7",
    createdAt: "2026-11-07T12:00:00.000Z",
    deletedAt: null,
    editedAt: null,
    id: "m1",
    payload: { content: "hello", type: "text" },
    reactions: [],
    replyTo: null,
    replyToId: null,
    revision: 1,
    roomId: "r1",
    sender: {
      avatarUrl: null,
      displayName: "Ada",
      id: "u1",
      username: "ada",
    },
    senderId: "u1",
    sequence: "3",
    ...overrides,
  };
}

describe("sameCommunityChatMessageRow", () => {
  it("treats identical snapshots as the same row", () => {
    const a = row();
    const b = row();
    expect(sameCommunityChatMessageRow(a, a)).toBe(true);
    expect(sameCommunityChatMessageRow(a, b)).toBe(true);
  });

  it("detects edits, deletions, pins and reaction changes", () => {
    const base = row();
    expect(sameCommunityChatMessageRow(base, row({ revision: 2 }))).toBe(false);
    expect(
      sameCommunityChatMessageRow(
        base,
        row({ deletedAt: "2026-11-07T12:01:00.000Z" })
      )
    ).toBe(false);
    expect(sameCommunityChatMessageRow(base, row({ pinned: true }))).toBe(
      false
    );
    expect(
      sameCommunityChatMessageRow(
        base,
        row({ reactions: [{ count: 1, emoji: "❤️", reacted: true }] })
      )
    ).toBe(false);
  });

  it("detects payload and sender profile changes", () => {
    const base = row();
    expect(
      sameCommunityChatMessageRow(
        base,
        row({ payload: { content: "edited", type: "text" } })
      )
    ).toBe(false);
    expect(
      sameCommunityChatMessageRow(
        base,
        row({ sender: { ...base.sender, displayName: "Ada L." } })
      )
    ).toBe(false);
  });
});

describe("stabilizeCommunityChatRows", () => {
  it("returns the previous array when nothing changed", () => {
    const previous = [row(), row({ id: "m2", sequence: "4" })];
    const next = [row(), row({ id: "m2", sequence: "4" })];
    expect(stabilizeCommunityChatRows(previous, next)).toBe(previous);
  });

  it("reuses unchanged rows and swaps changed ones in place", () => {
    const previous = [row(), row({ id: "m2", sequence: "4" })];
    const next = [row(), row({ id: "m2", payload: null, sequence: "4" })];
    const merged = stabilizeCommunityChatRows(previous, next);
    expect(merged[0]).toBe(previous[0]);
    expect(merged[1]).toBe(next[1]);
    expect(merged).not.toBe(previous);
  });

  it("keeps the incoming order for appended history", () => {
    const previous = [row({ id: "m2", sequence: "4" })];
    const next = [
      row({ id: "m3", sequence: "5" }),
      row({ id: "m2", sequence: "4" }),
    ];
    const merged = stabilizeCommunityChatRows(previous, next);
    expect(merged.map((entry) => entry.id)).toEqual(["m3", "m2"]);
    expect(merged[1]).toBe(previous[0]);
  });
});
