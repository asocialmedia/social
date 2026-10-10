import { describe, expect, test } from "bun:test";

import {
  blockedSendPeer,
  dmPeerId,
  isBlockPairRule,
  isHiddenByBlock,
} from "./blocks";

// What a block means inside a conversation, in one place.
//
// Four surfaces answer this question - the conversation list, the conversation
// detail gate, the unread badge seed and the send path - and each of them was
// re-deriving it. Two had already drifted into answering it differently for a den
// than for a DM, which is the whole reason these predicates were pulled out of
// `server.ts` and given their own module: a rule that is four lines long can still
// be four different rules.
//
// The decision being pinned: a block is a DM-ONLY rule, and a DM is the only place
// it has force. Two blocked people cannot open a conversation, read one, send into
// one, or correct their own words in one. That is the whole guarantee, and it is
// what these predicates exist to express.
//
// A den admits regardless of blocks. It did not always: it used to carry a block
// check at the create, add and join doors, on the theory that a block's force was
// "spent at the doors" and nowhere else. Those checks are gone, and nothing in
// THIS file changes to accommodate that - which is the point. The predicates are
// already type-aware, so the den paths read them to learn that they must SKIP, and
// the rule that used to be expressed at a den door is now expressed nowhere in a
// den. The reasoning is in the header of `blocks.ts`; the door-level proof is
// `den-service.integration.test.ts` and the members route test.
//
// This is not a weakening. The scheme is server-recoverable, so a member of a den
// can already read the server's copy of every message in it. Hiding one member's
// messages from the other ninety-nine would protect nothing, cost every read a
// per-recipient filter, and still leak through the count and the ordering.

describe("dmPeerId", () => {
  test("names the other member of a two-person conversation", () => {
    const roster = [{ userId: "a" }, { userId: "b" }];
    expect(dmPeerId(roster, "a")).toBe("b");
    expect(dmPeerId(roster, "b")).toBe("a");
  });

  test("has nothing to say about a caller who is alone", () => {
    // A DM row whose peer has been removed is a half-state. Resolving it to
    // "blocked" would take the survivor's own history away from them.
    expect(dmPeerId([{ userId: "a" }], "a")).toBeUndefined();
    expect(dmPeerId([], "a")).toBeUndefined();
  });
});

describe("isHiddenByBlock", () => {
  test("hides a DM from a member of a blocked pair", () => {
    expect(isHiddenByBlock("DM", "b", true)).toBe(true);
  });

  test("leaves an unblocked DM alone", () => {
    expect(isHiddenByBlock("DM", "b", false)).toBe(false);
  });

  test("never hides a den, however blocked anybody in it is", () => {
    // The rule, at the value that would matter most. A den is a room, not a
    // pair: revoking it because two of its ninety-nine members disagree would
    // hand every other member's access to a private disagreement.
    expect(isHiddenByBlock("DEN", "b", true)).toBe(false);
  });

  test("hides nothing when no peer resolved", () => {
    expect(isHiddenByBlock("DM", undefined, true)).toBe(false);
  });
});

describe("isBlockPairRule", () => {
  test("only a DM carries a pair for a block to apply to", () => {
    // The predicate the hot paths read BEFORE they spend a query. A den's media
    // bytes and a den's sends both skip their block probe on this answer, so it
    // has to be the same answer the full decision gives.
    expect(isBlockPairRule("DM")).toBe(true);
    expect(isBlockPairRule("DEN")).toBe(false);
  });

  test("agrees with the full decision for every combination", () => {
    // Every (type, peer present, blocked) combination, so the cheap gate and the
    // expensive answer can never be two rules.
    for (const type of ["DM", "DEN"] as const) {
      for (const peer of ["b", undefined]) {
        for (const blocked of [true, false]) {
          const hidden = isHiddenByBlock(type, peer, blocked);
          expect(hidden).toBe(
            isBlockPairRule(type) && peer !== undefined && blocked
          );
        }
      }
    }
  });
});

describe("blockedSendPeer", () => {
  test("resolves the peer of a DM, so a blocked pair cannot write", () => {
    expect(
      blockedSendPeer(
        { members: [{ userId: "a" }, { userId: "b" }], type: "DM" },
        "a"
      )
    ).toBe("b");
  });

  test("resolves nobody in a den, whoever is in it", () => {
    // The bug this pins. The send path used to ask for "somebody who is not the
    // sender", which in a den is one arbitrary member out of up to ninety-nine -
    // so whether a send was allowed depended on the order the roster came back
    // in. A room where the blocked person happened to sort first went silent for
    // everybody; a room where they sorted last did not.
    const den = {
      members: [
        { userId: "a" },
        { userId: "b" },
        { userId: "c" },
        { userId: "d" },
      ],
      type: "DEN" as const,
    };
    // Not "the first member who is not the sender" - no member at all.
    expect(blockedSendPeer(den, "a")).toBeUndefined();
    // And the same answer whichever member asks, which is the property the
    // arbitrary pick broke.
    expect(blockedSendPeer(den, "b")).toBeUndefined();
    expect(blockedSendPeer(den, "d")).toBeUndefined();
  });

  test("agrees with the hide predicate on which conversations are affected", () => {
    // The two answers are the same question asked twice, so they must not
    // disagree: a conversation the gate would hide must also be one the send path
    // refuses to write into, or a blocked pair could still post.
    for (const [type, _peer] of [
      ["DM", "b"],
      ["DEN", "b"],
    ] as const) {
      const conversation = {
        members: [{ userId: "a" }, { userId: "b" }],
        type,
      };
      const sendPeer = blockedSendPeer(conversation, "a");
      expect(isHiddenByBlock(type, sendPeer, sendPeer !== undefined)).toBe(
        type === "DM"
      );
    }
  });
});
