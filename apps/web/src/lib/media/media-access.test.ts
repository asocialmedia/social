import { describe, expect, test } from "bun:test";

import { decideMediaAccess, resolveOwningCommunity } from "./media-access";

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

  test("private community post media requires active community membership", () => {
    const media = {
      commentId: null,
      isPrivateCommunityPost: true,
      postId: "p-private",
      userId: "user-1",
    };

    // Guests are denied with 404
    const guest = decideMediaAccess(media, null);
    expect(guest.allowed).toBe(false);
    expect(!guest.allowed && guest.status).toBe(404);

    // Non-members are denied with 404
    const nonMember = decideMediaAccess(media, other, {
      isCommunityMember: false,
    });
    expect(nonMember.allowed).toBe(false);
    expect(!nonMember.allowed && nonMember.status).toBe(404);

    // Active community members are allowed
    const member = decideMediaAccess(media, other, {
      isCommunityMember: true,
    });
    expect(member.allowed).toBe(true);
  });

  test("comment media on a private community post is members-only", () => {
    // A comment attachment has no postId, so the private flag is derived from
    // the comment's parent post by the serving route. Without this check any
    // signed-in user could read a private community's comment media.
    const media = {
      commentId: "c-private",
      isPrivateCommunityPost: true,
      postId: null,
      userId: "user-1",
    };

    const guest = decideMediaAccess(media, null);
    expect(guest.allowed).toBe(false);
    expect(!guest.allowed && guest.status).toBe(404);

    const nonMember = decideMediaAccess(media, other, {
      isCommunityMember: false,
    });
    expect(nonMember.allowed).toBe(false);
    expect(!nonMember.allowed && nonMember.status).toBe(404);

    const member = decideMediaAccess(media, other, {
      isCommunityMember: true,
    });
    expect(member.allowed).toBe(true);
  });

  test("resolveOwningCommunity walks to the comment's parent post", () => {
    const community = { id: "comm-1", type: "PRIVATE" };
    expect(
      resolveOwningCommunity({
        post: { community },
      })
    ).toBe(community);
    expect(
      resolveOwningCommunity({
        comment: { post: { community } },
        post: null,
      })
    ).toBe(community);
    // A global post (no community) resolves to null, not a phantom community.
    expect(
      resolveOwningCommunity({ comment: { post: { community: null } } })
    ).toBeNull();
    expect(resolveOwningCommunity({})).toBeNull();
  });
});
