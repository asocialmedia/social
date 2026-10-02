import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

import {
  MessagesApiError,
  addDenMembers,
  createDen,
  dissolveDen,
  fetchDen,
  fetchDenInvitePreview,
  fetchDenMembers,
  isConversationSnapshotStale,
  joinDen,
  leaveDen,
  removeDenMember,
  rotateDenInvite,
  setDenMemberRole,
  transferDenOwnership,
  updateDenDetails,
} from "./client";
import { HistoryThrottledError } from "./history-throttle";
import type { MessageConversationData } from "./types";

// Route-level tests for the den client helpers: the request each one makes, the
// shape it reads back, and the refusal it surfaces. `fetch` is mocked at the
// global, which is the only seam these helpers have (they are plain typed
// wrappers over the API), so a wrong URL or a wrong method is caught here rather
// than in a browser.

type RouteHandler = (
  url: string,
  init: RequestInit | undefined
) => Response | null;

const originalFetch = globalThis.fetch;
let route: RouteHandler = () => null;
const calls: { body: unknown; init: RequestInit | undefined; url: string }[] =
  [];

const fetchMock = mock((input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const body =
    typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ body, init, url });
  return route(url, init) ?? Response.json({}, { status: 404 });
});

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockClear();
  route = () => null;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

// A conversation exactly as the create route's mapper returns one, so the shape
// the helpers read is the shape the server actually sends.
function denConversation(overrides: Partial<MessageConversationData> = {}) {
  return {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    id: "den-1",
    keys: [],
    members: [],
    pairKey: null,
    type: "DEN",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("createDen", () => {
  test("posts the discriminator, the roster and the name to the conversations route", async () => {
    // One route for a DM and a den, discriminated by `type`, so the client lands on
    // the same conversation cache entry the thread already reads.
    route = (url) =>
      url === "/api/messages/conversations"
        ? Response.json(
            {
              conversation: denConversation({ name: "Study group" }),
              inviteCode: "abc234",
              isNew: true,
            },
            { status: 201 }
          )
        : null;

    const result = await createDen({
      description: "Weekly",
      memberIds: ["u-ada", "u-grace"],
      name: "Study group",
    });

    expect(calls[0]?.url).toBe("/api/messages/conversations");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({
      description: "Weekly",
      memberIds: ["u-ada", "u-grace"],
      name: "Study group",
      type: "DEN",
    });
    expect(result.inviteCode).toBe("abc234");
    expect(result.isNew).toBe(true);
    expect(result.conversation.type).toBe("DEN");
  });

  test("includes the avatar only when there is one", async () => {
    route = () =>
      Response.json(
        { conversation: denConversation(), inviteCode: "c", isNew: true },
        { status: 201 }
      );
    await createDen({ memberIds: ["u-ada"], name: "No picture" });
    // Sending `avatarMediaId: null` on create would read as "clear this" against a
    // row that does not exist yet, so an absent key is the only correct absence.
    expect(calls[0]?.body).toEqual({
      memberIds: ["u-ada"],
      name: "No picture",
      type: "DEN",
    });
  });

  test("surfaces the server's own refusal message, verbatim", async () => {
    // `denErrorResponse` writes every refusal for a human, and the create dialog
    // shows what it gets. A wrapper that replaced it would make the dialog's copy a
    // second thing that can only be less accurate.
    route = () =>
      Response.json(
        {
          code: "FOLLOW_REQUIRED",
          error: "You can only add people you follow",
        },
        { status: 403 }
      );

    const failure = await createDen({
      memberIds: ["u-stranger"],
      name: "Study group",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MessagesApiError);
    expect((failure as MessagesApiError).message).toBe(
      "You can only add people you follow"
    );
    expect((failure as MessagesApiError).status).toBe(403);
  });

  test("a throttled create stays a readable refusal, not a history retry", async () => {
    // The shared 429 parser throws HistoryThrottledError so a background backfill
    // can wait and retry the same page. A create is not a backfill: a person is
    // watching a button, and the denial has to read as one.
    route = () =>
      Response.json(
        { error: "You're doing that too often" },
        {
          headers: { "retry-after": "30" },
          status: 429,
        }
      );

    const failure = await createDen({
      memberIds: ["u-ada"],
      name: "Study group",
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MessagesApiError);
    // The shared parser throws HistoryThrottledError for a 429 so a background
    // history backfill can wait and retry. A den mutation has no backfill, so the
    // person watching the button has to get a message instead.
    expect(failure).not.toBeInstanceOf(HistoryThrottledError);
    expect((failure as MessagesApiError).message).toBe(
      "You're doing that too often"
    );
    expect((failure as MessagesApiError).status).toBe(429);
  });
});

describe("fetchDen", () => {
  test("reads the detail shape the details panel is built on", async () => {
    route = (url) =>
      url === "/api/messages/dens/den-1"
        ? Response.json({
            canManage: true,
            den: {
              avatarMediaId: null,
              description: "Weekly",
              // The code IS the door, so the route withholds it from anybody who is
              // not a manager. The panel only draws the invite block when it holds
              // one.
              inviteCode: "abc234",
              memberCount: 4,
              name: "Study group",
              ownerId: "u-ada",
            },
            membership: { role: "OWNER" },
          })
        : null;

    const detail = await fetchDen("den-1");
    expect(detail.canManage).toBe(true);
    expect(detail.membership.role).toBe("OWNER");
    expect(detail.den.inviteCode).toBe("abc234");
    expect(detail.den.memberCount).toBe(4);
  });

  test("a non-member gets a 403 the panel can render as a refusal", async () => {
    route = () =>
      Response.json(
        { code: "FORBIDDEN", error: "You are not a member of this den" },
        { status: 403 }
      );
    await expect(fetchDen("den-2")).rejects.toThrow(
      "You are not a member of this den"
    );
  });
});

describe("updateDenDetails", () => {
  test("PATCHes only the fields it was given", async () => {
    // Absent means "leave this alone" on the route, so a rename that also resent
    // the description could overwrite a change made elsewhere since this panel
    // loaded. Sending the patch through untouched is what keeps that impossible.
    route = (url) =>
      url === "/api/messages/dens/den-1" ? Response.json({ ok: true }) : null;

    await updateDenDetails("den-1", { name: "Renamed" });

    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({ name: "Renamed" });
  });

  test("an explicit null is sent as a clear, not dropped", async () => {
    route = () => Response.json({ ok: true });
    await updateDenDetails("den-1", { description: null });
    expect(calls[0]?.body).toEqual({ description: null });
  });
});

describe("fetchDenMembers", () => {
  test("reads the roster array out of the envelope", async () => {
    route = (url) =>
      url === "/api/messages/dens/den-1/members"
        ? Response.json({
            members: [
              {
                avatarUrl: null,
                badge: null,
                badges: [],
                displayName: "Ada",
                id: "u-ada",
                invitedById: null,
                role: "OWNER",
                username: "ada",
              },
            ],
          })
        : null;

    const members = await fetchDenMembers("den-1");
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("OWNER");
  });

  test("passes the page size only when the caller asked for one", async () => {
    route = () => Response.json({ members: [] });
    await fetchDenMembers("den-1");
    expect(calls[0]?.url).toBe("/api/messages/dens/den-1/members");
    await fetchDenMembers("den-1", DEN_LIMITS.membersMax);
    expect(calls[1]?.url).toBe(
      `/api/messages/dens/den-1/members?limit=${DEN_LIMITS.membersMax}`
    );
  });
});

describe("addDenMembers", () => {
  test("returns the ids actually added, not the ones asked for", async () => {
    // The root key has to be rotated for exactly the people who joined, so a
    // client that asked for five and got three needs to know which three.
    route = (url) =>
      url === "/api/messages/dens/den-1/members"
        ? Response.json({ added: ["u-ada"], ok: true }, { status: 201 })
        : null;

    expect(await addDenMembers("den-1", ["u-ada", "u-gone"])).toEqual([
      "u-ada",
    ]);
    expect(calls[0]?.body).toEqual({ memberIds: ["u-ada", "u-gone"] });
  });

  test("an empty answer from a server that does not report it is not a crash", async () => {
    route = () => Response.json({ ok: true });
    expect(await addDenMembers("den-1", ["u-ada"])).toEqual([]);
  });

  test("a full den surfaces the server's limit message", async () => {
    // The message is composed from DEN_LIMITS rather than written out, because
    // the server composes it that way and a test that hardcodes it would keep
    // passing after the ceiling moved - and then be asserting a string the
    // product no longer produces.
    const message = `A den can have at most ${DEN_LIMITS.membersMax} members`;
    route = () =>
      Response.json({ code: "LIMIT_REACHED", error: message }, { status: 409 });
    await expect(addDenMembers("den-1", ["u-ada"])).rejects.toThrow(message);
  });

  test("carries the refusal's code, so a caller can name which refusal it was", async () => {
    // Several codes share a status, so the status alone cannot tell the panel which
    // settled outcome it is looking at: LIMIT_REACHED and NOT_A_DEN are both 409,
    // and only the first is about a room that is too full while the second is about
    // a route aimed at a DM. The code is what lets the copy differ, and a client
    // that dropped it on the floor would show a generic failure for a settled
    // outcome.
    //
    // It used to be BLOCKED against FORBIDDEN on a 403, but there is no BLOCKED any
    // more: blocks are DM-only, so a den admits regardless of them and the panel has
    // no block copy left to choose between. 409 is where the argument lives now.
    route = () =>
      Response.json(
        {
          code: "NOT_A_DEN",
          error: "That is not a den",
        },
        { status: 409 }
      );

    const failure = await addDenMembers("den-1", ["u-ada"]).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(MessagesApiError);
    expect((failure as MessagesApiError).status).toBe(409);
    expect((failure as MessagesApiError).code).toBe("NOT_A_DEN");
  });

  test("leaves the code undefined for a refusal that carries none", async () => {
    // A DM route writes no code, so the field must be absent rather than guessed,
    // or a caller branching on it would read a name the server never chose.
    route = () => Response.json({ error: "Forbidden" }, { status: 403 });
    const failure = await addDenMembers("den-1", ["u-ada"]).catch(
      (error: unknown) => error
    );
    expect((failure as MessagesApiError).code).toBeUndefined();
  });
});

describe("removeDenMember", () => {
  test("DELETEs the member route with the id escaped", async () => {
    route = (url) =>
      url === "/api/messages/dens/den-1/members/u-ada"
        ? Response.json({ ok: true })
        : null;
    await removeDenMember("den-1", "u-ada");
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("/api/messages/dens/den-1/members/u-ada");
  });

  test("the self-action refusal is surfaced rather than swallowed", async () => {
    // The panel offers no self action, but a stale row could still produce one and
    // the message is what tells the reader what actually happened.
    route = () =>
      Response.json(
        { code: "SELF_ACTION", error: "Use leave to remove yourself" },
        { status: 409 }
      );
    await expect(removeDenMember("den-1", "u-me")).rejects.toThrow(
      "Use leave to remove yourself"
    );
  });
});

describe("setDenMemberRole", () => {
  test("posts the target and the role together", async () => {
    route = (url) =>
      url === "/api/messages/dens/den-1/role"
        ? Response.json({ ok: true, role: "ADMIN" })
        : null;
    await setDenMemberRole("den-1", "u-ada", "ADMIN");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.body).toEqual({ role: "ADMIN", userId: "u-ada" });
  });

  test("the owner-only refusal is surfaced", async () => {
    route = () =>
      Response.json(
        { code: "FORBIDDEN", error: "Only the owner can do that" },
        { status: 403 }
      );
    await expect(setDenMemberRole("den-1", "u-ada", "ADMIN")).rejects.toThrow(
      "Only the owner can do that"
    );
  });
});

describe("transferDenOwnership", () => {
  test("posts the target to its own route, not to the role route", async () => {
    // A separate route rather than a role value on the existing one: this write
    // moves two membership rows and the den's ownerId, and it must not be
    // reachable by anything that can already write a role.
    route = (url) =>
      url === "/api/messages/dens/den-1/transfer"
        ? Response.json({ ok: true })
        : null;
    await transferDenOwnership("den-1", "u-ada");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.url).toBe("/api/messages/dens/den-1/transfer");
    expect(calls[0]?.body).toEqual({ userId: "u-ada" });
  });

  test("the self-action refusal is surfaced rather than swallowed", async () => {
    // Stale row: the owner opened the panel before somebody else took the den, and
    // pressed the button on their own name. The message is what says why.
    route = () =>
      Response.json(
        { code: "SELF_ACTION", error: "You already own this den" },
        { status: 409 }
      );
    await expect(transferDenOwnership("den-1", "u-me")).rejects.toThrow(
      "You already own this den"
    );
  });
});

describe("leaveDen", () => {
  test("reports a dissolved den so the client stops rendering a room that is gone", async () => {
    route = (url) =>
      url === "/api/messages/dens/den-1/leave"
        ? Response.json({ dissolved: true, newOwnerId: null, ok: true })
        : null;
    expect(await leaveDen("den-1")).toEqual({
      dissolved: true,
      newOwnerId: null,
    });
  });

  test("reports an ownership transfer, which is a different next move", async () => {
    route = (url) =>
      url === "/api/messages/dens/den-1/leave"
        ? Response.json({ dissolved: false, newOwnerId: "u-ada", ok: true })
        : null;
    expect(await leaveDen("den-1")).toEqual({
      dissolved: false,
      newOwnerId: "u-ada",
    });
  });
});

describe("dissolveDen", () => {
  test("DELETEs the leave route, which is the dissolve verb", async () => {
    // Same path as leaving, opposite method: the route pairs them deliberately so
    // "walk out" and "destroy it" cannot drift onto two unrelated endpoints.
    route = (url) =>
      url === "/api/messages/dens/den-1/leave"
        ? Response.json({ ok: true })
        : null;
    await dissolveDen("den-1");
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.url).toBe("/api/messages/dens/den-1/leave");
  });
});

describe("rotateDenInvite", () => {
  test("returns the new code", async () => {
    // Rotation is the revocation step, so the panel replaces the link it copied
    // rather than leaving a dead one on screen.
    route = (url) =>
      url === "/api/messages/dens/den-1/invite"
        ? Response.json({ inviteCode: "new456", ok: true })
        : null;
    expect(await rotateDenInvite("den-1")).toBe("new456");
  });

  test("a response with no code is an error, not an empty link", async () => {
    // Copying an empty invite link would hand the reader a link that resolves to
    // nothing, which is the exact failure rotation exists to prevent.
    route = () => Response.json({ ok: true });
    await expect(rotateDenInvite("den-1")).rejects.toThrow(
      "The new join link did not come back"
    );
  });
});

describe("fetchDenInvitePreview", () => {
  test("reads the three-field preview", async () => {
    route = (url) =>
      url === "/api/messages/dens/join/abc234"
        ? Response.json({
            den: { id: "den-1", memberCount: 7, name: "Study group" },
            isMember: false,
          })
        : null;
    const preview = await fetchDenInvitePreview("abc234");
    expect(preview.den.memberCount).toBe(7);
    expect(preview.isMember).toBe(false);
  });

  test("escapes the code into the path", async () => {
    route = () =>
      Response.json({
        den: { id: "d", memberCount: 0, name: null },
        isMember: false,
      });
    await fetchDenInvitePreview("a b/c");
    expect(calls[0]?.url).toBe("/api/messages/dens/join/a%20b%2Fc");
  });

  test("an unknown code is a 404 the screen turns into a dead end", async () => {
    route = () =>
      Response.json({ error: "That join code is not valid" }, { status: 404 });
    await expect(fetchDenInvitePreview("nope")).rejects.toThrow(
      "That join code is not valid"
    );
  });
});

describe("joinDen", () => {
  test("a real join is a 201 and reports not-already-a-member", async () => {
    route = (url) =>
      url === "/api/messages/dens/join/abc234"
        ? Response.json(
            { alreadyMember: false, conversationId: "den-1", ok: true },
            { status: 201 }
          )
        : null;
    expect(await joinDen("abc234")).toEqual({
      alreadyMember: false,
      conversationId: "den-1",
    });
  });

  test("re-opening a link already used is a success, not a failure", async () => {
    // A 200 rather than a 201, and the client navigates without an error toast --
    // re-opening your own invite link is not a mistake.
    route = (url) =>
      url === "/api/messages/dens/join/abc234"
        ? Response.json(
            { alreadyMember: true, conversationId: "den-1", ok: true },
            { status: 200 }
          )
        : null;
    expect(await joinDen("abc234")).toEqual({
      alreadyMember: true,
      conversationId: "den-1",
    });
  });

  test("the actionable 409 keeps its message for the screen to explain", async () => {
    // The route checks the identity before writing the membership row, so nothing
    // was created and the only correct response is "turn Messages on first".
    route = () =>
      Response.json(
        { error: "Enable Messages first to join a den" },
        { status: 409 }
      );
    const failure = await joinDen("abc234").catch((error: unknown) => error);
    expect((failure as MessagesApiError).status).toBe(409);
    expect((failure as MessagesApiError).message).toBe(
      "Enable Messages first to join a den"
    );
  });

  test("a 201 with no conversation is an error rather than a blank navigation", async () => {
    route = () => Response.json({ ok: true }, { status: 201 });
    await expect(joinDen("abc234")).rejects.toThrow(
      "The den joined but no conversation came back"
    );
  });
});

describe("a membership mutation and the staleness guard", () => {
  test("a create is recorded as the server having moved the conversation forward", async () => {
    // A den create is a membership mutation, so the conversation row moves. If the
    // guard did not learn about it, the very first send in the new den would decide
    // against a snapshot the server had already overtaken.
    expect(isConversationSnapshotStale(denConversation())).toBe(false);
    route = () =>
      Response.json(
        {
          conversation: denConversation({
            id: "den-fresh",
            name: "Study group",
          }),
          inviteCode: "abc234",
          isNew: true,
        },
        { status: 201 }
      );
    const created = await createDen({
      memberIds: ["u-ada"],
      name: "Study group",
    });
    expect(isConversationSnapshotStale(created.conversation)).toBe(false);
    expect(
      isConversationSnapshotStale({
        ...created.conversation,
        updatedAt: new Date(0),
      })
    ).toBe(true);
  });
});
