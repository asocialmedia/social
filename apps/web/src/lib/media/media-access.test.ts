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

  test("unlinked media (message attachments) is owner-only", () => {
    const media = { commentId: null, postId: null, userId: "user-1" };
    const guest = decideMediaAccess(media, null);
    expect(guest.allowed).toBe(false);
    expect(!guest.allowed && guest.status).toBe(401);

    expect(decideMediaAccess(media, other).allowed).toBe(false);
    expect(decideMediaAccess(media, viewer).allowed).toBe(true);
  });

  test("ownerless unlinked rows are invisible to everyone", () => {
    const media = { commentId: null, postId: null, userId: null };
    const result = decideMediaAccess(media, viewer);
    expect(result.allowed).toBe(false);
    expect(!result.allowed && result.status).toBe(404);
  });
});
