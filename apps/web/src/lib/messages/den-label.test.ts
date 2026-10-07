import { describe, expect, test } from "bun:test";

import type { ConversationType } from "@asm/db/messages/dens";

import {
  DEN_LIST_FILTERS,
  conversationDisplayName,
  countConversationsByType,
  denAvatarFaces,
  denConversationPath,
  denDisplayName,
  denFallbackNames,
  denMemberCountLabel,
  denPreviewLine,
  filterConversationsByType,
} from "./den-label";
import type { DenLabelMember } from "./den-label";

function member(
  id: string,
  displayName: string,
  role?: string
): DenLabelMember & { role?: string } {
  return {
    avatarUrl: null,
    displayName,
    id,
    role,
    username: `${id}-handle`,
  };
}

describe("denDisplayName", () => {
  const ada = member("u-ada", "Ada");
  const grace = member("u-grace", "Grace");
  const alan = member("u-alan", "Alan");
  const me = member("u-me", "Me");

  test("prefers the stored name", () => {
    expect(
      denDisplayName(
        { members: [me, ada, grace], name: "Study group", type: "DEN" },
        "u-me"
      )
    ).toBe("Study group");
  });

  test("treats a name of whitespace as no name at all", () => {
    // A name of spaces and a null name would render identically in the list, so
    // they must resolve identically rather than one of them showing spaces.
    expect(
      denDisplayName({ members: [me, ada], name: "   ", type: "DEN" }, "u-me")
    ).toBe("Ada");
  });

  test("falls back to the member names, and never the reader's own", () => {
    expect(
      denDisplayName(
        { members: [me, ada, grace], name: null, type: "DEN" },
        "u-me"
      )
    ).toBe("Ada and Grace");
    // Two people with no name is a den with exactly one other member, so the
    // label must not read as a bare conjunction.
    expect(denDisplayName({ members: [me, ada], type: "DEN" }, "u-me")).toBe(
      "Ada"
    );
  });

  test("caps the fallback at three names and counts the rest", () => {
    const many = [
      me,
      ada,
      grace,
      alan,
      member("u-edsger", "Edsger"),
      member("u-barbara", "Barbara"),
      member("u-linus", "Linus"),
    ];
    // Six others is more than a row can hold, so it reads as two names and a
    // count rather than as a roster.
    expect(denDisplayName({ members: many, type: "DEN" }, "u-me")).toBe(
      "Ada, Grace and 4 more"
    );
  });

  test("says something rather than rendering an empty heading", () => {
    // A solo den cannot be created, but a dissolved or not-yet-loaded roster can
    // render, and a row with an empty heading reads as a broken list.
    expect(denDisplayName({ members: [me], type: "DEN" }, "u-me")).toBe("Den");
    expect(denDisplayName({ members: [], type: "DEN" }, "u-me")).toBe("Den");
  });

  test("skips a member whose every display field is empty", () => {
    const nameless = {
      avatarUrl: null,
      displayName: "",
      id: "u-x",
      username: "",
    };
    expect(
      denDisplayName({ members: [me, nameless, ada], type: "DEN" }, "u-me")
    ).toBe("Ada");
  });
});

describe("denFallbackNames", () => {
  test("excludes the reader", () => {
    expect(
      denFallbackNames([member("u-me", "Me"), member("u-ada", "Ada")], "u-me")
    ).toEqual(["Ada"]);
  });

  test("prefers a display name and falls back to the handle", () => {
    expect(
      denFallbackNames(
        [
          { avatarUrl: null, displayName: "", id: "u-a", username: "ada" },
          { avatarUrl: null, displayName: "Grace", id: "u-b", username: "g" },
        ],
        "u-me"
      )
    ).toEqual(["ada", "Grace"]);
  });
});

describe("conversationDisplayName", () => {
  test("names a DM after the peer, never the reader", () => {
    expect(
      conversationDisplayName(
        {
          members: [member("u-me", "Me"), member("u-ada", "Ada")],
          name: null,
          type: "DM",
        },
        "u-me"
      )
    ).toBe("Ada");
  });

  test("falls back to the handle, then to a generic label", () => {
    expect(
      conversationDisplayName(
        {
          members: [
            { avatarUrl: null, displayName: "", id: "u-me", username: "me" },
            { avatarUrl: null, displayName: "", id: "u-a", username: "ada" },
          ],
          type: "DM",
        },
        "u-me"
      )
    ).toBe("ada");
    expect(conversationDisplayName({ members: [], type: "DM" }, "u-me")).toBe(
      "Conversation"
    );
  });

  test("a den with a name ignores the roster entirely", () => {
    expect(
      conversationDisplayName(
        {
          members: [member("u-me", "Me"), member("u-ada", "Ada")],
          name: "Study group",
          type: "DEN",
        },
        "u-me"
      )
    ).toBe("Study group");
  });
});

describe("denPreviewLine", () => {
  const conversation = {
    members: [
      member("u-me", "Me"),
      member("u-ada", "Ada"),
      member("u-grace", "Grace"),
    ],
    name: "Study group",
    type: "DEN" as ConversationType,
  };

  test("prefixes a den preview with who sent it", () => {
    expect(
      denPreviewLine({
        conversation,
        lastSenderId: "u-ada",
        myUserId: "u-me",
        preview: "See you at seven",
      })
    ).toBe("Ada: See you at seven");
  });

  test("does not add a second You prefix to the reader's own message", () => {
    // `conversationPreviewText` already wrote "You: ", so prefixing here would
    // render "You: You: ".
    expect(
      denPreviewLine({
        conversation,
        lastSenderId: "u-me",
        myUserId: "u-me",
        preview: "You: See you at seven",
      })
    ).toBe("You: See you at seven");
  });

  test("leaves a DM preview exactly as it was", () => {
    expect(
      denPreviewLine({
        conversation: { ...conversation, type: "DM" },
        lastSenderId: "u-ada",
        myUserId: "u-me",
        preview: "See you at seven",
      })
    ).toBe("See you at seven");
  });

  test("leaves an unattributable preview alone rather than prefixing nothing", () => {
    // No preview at all, or no sender to attribute: "Ada: " over an empty string
    // would read as a conversation with a message.
    expect(
      denPreviewLine({
        conversation,
        lastSenderId: "u-ada",
        myUserId: "u-me",
        preview: "",
      })
    ).toBe("");
    expect(
      denPreviewLine({
        conversation,
        lastSenderId: null,
        myUserId: "u-me",
        preview: "Shared an image",
      })
    ).toBe("Shared an image");
    // A sender who is not on the roster any more: the message still has content,
    // and the byline is the part that is missing.
    expect(
      denPreviewLine({
        conversation,
        lastSenderId: "u-gone",
        myUserId: "u-me",
        preview: "Shared an image",
      })
    ).toBe("Shared an image");
  });

  test("uses a handle when the sender has no display name", () => {
    expect(
      denPreviewLine({
        conversation: {
          ...conversation,
          members: [
            member("u-me", "Me"),
            { avatarUrl: null, displayName: "", id: "u-ada", username: "ada" },
          ],
        },
        lastSenderId: "u-ada",
        myUserId: "u-me",
        preview: "hello",
      })
    ).toBe("ada: hello");
  });
});

describe("denAvatarFaces", () => {
  test("includes all members and leads with the owner", () => {
    const faces = denAvatarFaces(
      [
        member("u-me", "Me", "ADMIN"),
        member("u-ada", "Ada", "OWNER"),
        member("u-grace", "Grace", "MEMBER"),
        member("u-alan", "Alan", "ADMIN"),
      ],
      "u-me"
    );
    expect(faces.map((face) => face.id)).toEqual(["u-ada", "u-me", "u-alan"]);
  });

  test("caps at three faces", () => {
    const faces = denAvatarFaces(
      [
        member("u-me", "Me"),
        member("u-a", "A"),
        member("u-b", "B"),
        member("u-c", "C"),
        member("u-d", "D"),
      ],
      "u-me"
    );
    expect(faces).toHaveLength(3);
  });

  test("keeps join order within one role rather than reshuffling it", () => {
    // Two admins whose arrival order is what distinguishes them; a sort that
    // treated them as equal could reorder them between renders.
    const faces = denAvatarFaces(
      [
        member("u-second", "Second", "ADMIN"),
        member("u-first", "First", "ADMIN"),
      ],
      "u-me"
    );
    expect(faces.map((face) => face.id)).toEqual(["u-second", "u-first"]);
  });

  test("treats a missing role as a plain member", () => {
    const faces = denAvatarFaces(
      [member("u-a", "A", "OWNER"), member("u-b", "B"), member("u-c", "C")],
      "u-me"
    );
    expect(faces.map((face) => face.id)).toEqual(["u-a", "u-b", "u-c"]);
  });

  test("an empty roster draws no faces", () => {
    expect(denAvatarFaces([], "u-me")).toEqual([]);
  });

  test("single member roster includes the member", () => {
    expect(denAvatarFaces([member("u-me", "Me")], "u-me")).toEqual([
      member("u-me", "Me"),
    ]);
  });
});

describe("denMemberCountLabel", () => {
  test("pluralises", () => {
    expect(denMemberCountLabel(1)).toBe("1 member");
    expect(denMemberCountLabel(2)).toBe("2 members");
    expect(denMemberCountLabel(0)).toBe("0 members");
  });

  test("never renders a negative or fractional count", () => {
    // A count arriving as NaN (an unresolved aggregate) would render "NaN
    // members", so it degrades to zero rather than to nonsense.
    expect(denMemberCountLabel(-4)).toBe("0 members");
    expect(denMemberCountLabel(3.7)).toBe("3 members");
    expect(denMemberCountLabel(Number.NaN)).toBe("0 members");
  });
});

describe("filterConversationsByType", () => {
  const items = [
    { conversation: { type: "DM" as ConversationType }, id: "a" },
    { conversation: { type: "DEN" as ConversationType }, id: "b" },
    { conversation: { type: "DM" as ConversationType }, id: "c" },
  ];

  test("ALL keeps everything, in order", () => {
    expect(
      filterConversationsByType(items, "ALL").map((item) => item.id)
    ).toEqual(["a", "b", "c"]);
  });

  test("each tab keeps only its own kind", () => {
    expect(
      filterConversationsByType(items, "DM").map((item) => item.id)
    ).toEqual(["a", "c"]);
    expect(
      filterConversationsByType(items, "DEN").map((item) => item.id)
    ).toEqual(["b"]);
  });

  test("returns a copy rather than the caller's array", () => {
    // The list renders straight from this, so handing back the query's own array
    // would let a render order the cache believes in.
    const source = [...items];
    expect(filterConversationsByType(source, "ALL")).not.toBe(source);
  });

  test("the filter set is exactly the three tabs the list draws", () => {
    expect([...DEN_LIST_FILTERS]).toEqual(["ALL", "DM", "DEN"]);
  });
});

describe("countConversationsByType", () => {
  const items = [
    { conversation: { type: "DM" as ConversationType }, id: "a" },
    { conversation: { type: "DEN" as ConversationType }, id: "b" },
    { conversation: { type: "DM" as ConversationType }, id: "c" },
  ];

  test("counts each tab from the same array the rows come from", () => {
    expect(countConversationsByType(items)).toEqual({ ALL: 3, DEN: 1, DM: 2 });
  });

  test("an empty list counts zero everywhere rather than NaN", () => {
    expect(countConversationsByType([])).toEqual({ ALL: 0, DEN: 0, DM: 0 });
  });

  test("ALL is the total of the two tabs", () => {
    // A tab badge that disagreed with the rows beneath it would be worse than no
    // badge, so the invariant is asserted rather than assumed.
    const counts = countConversationsByType(items);
    expect(counts.ALL).toBe(counts.DM + counts.DEN);
  });
});

describe("denConversationPath", () => {
  test("escapes the id rather than interpolating it raw", () => {
    expect(denConversationPath("a b&c")).toBe("/messages?c=a%20b%26c");
  });
});
