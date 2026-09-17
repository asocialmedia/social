import { describe, expect, test } from "bun:test";

import { decideMediaAccess } from "./media-access";

const viewer = { id: "user-1" };
const other = { id: "user-2" };

describe("decideMediaAccess", () => {
  test("post-linked media is public to everyone including guests", () => {
    const media = { commentId: null, postId: "p1", userId: "user-1" };
    expect(decideMediaAccess(media, null).allowed).toBe(true);
    expect(decideMediaAccess(media, other).allowed).toBe(true);
  });

  test("comment media requires a session but not ownership", () => {
    const media = { commentId: "c1", postId: null, userId: "someone-else" };
    const denied = decideMediaAccess(media, null);
    expect(denied.allowed).toBe(false);
    expect(!denied.allowed && denied.status).toBe(401);
    expect(decideMediaAccess(media, other).allowed).toBe(true);
  });

  test("unlinked media (abandoned drafts) is owner-only", () => {
    const media = { commentId: null, postId: null, userId: "user-1" };
    const guest = decideMediaAccess(media, null);
    expect(guest.allowed).toBe(false);
    expect(!guest.allowed && guest.status).toBe(401);

    expect(decideMediaAccess(media, other).allowed).toBe(false);
    expect(decideMediaAccess(media, viewer).allowed).toBe(true);
  });

  test("message-linked media admits conversation members, not strangers", () => {
    const media = {
      commentId: null,
      messageConversationId: "convo-1",
      postId: null,
      userId: "user-1",
    };
    const guest = decideMediaAccess(media, null, {
      isConversationMember: false,
    });
    expect(guest.allowed).toBe(false);
    // Guests get 404 too: a 401 here would confirm the id exists.
    expect(!guest.allowed && guest.status).toBe(404);

    // The owner/sender is always a member; strangers (even signed in) 404.
    expect(
      decideMediaAccess(media, viewer, { isConversationMember: true }).allowed
    ).toBe(true);
    expect(
      decideMediaAccess(media, other, { isConversationMember: true }).allowed
    ).toBe(true);
    const denied = decideMediaAccess(media, other, {
      isConversationMember: false,
    });
    expect(denied.allowed).toBe(false);
    expect(!denied.allowed && denied.status).toBe(404);
  });

  test("ownerless unlinked rows are invisible to everyone", () => {
    const media = { commentId: null, postId: null, userId: null };
    const result = decideMediaAccess(media, viewer);
    expect(result.allowed).toBe(false);
    expect(!result.allowed && result.status).toBe(404);
  });
});
