import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DenError as DenErrorClass } from "@asm/db";
import { DEN_LIMITS } from "@asm/db/messages/dens";

import {
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET, POST } from "./route";

// This is the widest door in the product: the URL is shareable and anybody
// holding it can present it. The preview is therefore the surface under the most
// scrutiny here - it must not become a way to enumerate who is in a den, and it
// must not disclose membership to somebody signed out - and the join must refuse
// a member with no message identity before writing anything at all.

class DenError extends Error {
  code: DenErrorClass["code"];
  constructor(code: DenErrorClass["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "DenError";
  }
}

interface Preview {
  id: string;
  inviteCode: string;
  memberCount: number;
  name: string | null;
}

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "newcomer" } }));

let preview: Preview | null = {
  id: "den-1",
  inviteCode: "code-abcdefghijk",
  memberCount: 4,
  name: "game night",
};
const mockPreviewInvite = mock((_code: string) => Promise.resolve(preview));

let membership: { role: string } | null = null;
const mockGetDenMembership = mock((_conversationId: string, _userId: string) =>
  Promise.resolve(membership)
);

let joinResult = { alreadyMember: false, id: "den-1" };
const mockJoinDenByInviteCode = mock((_code: string, _userId: string) =>
  Promise.resolve(joinResult)
);

// Defaults to true, so a test only has to say the one identity it is missing.
const mockHasMessageIdentity = mock((userId: string) =>
  Promise.resolve(userId !== "no-identity")
);

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

let limiterDenies = false;
// Which rule each call was handed, so a test can say WHICH budget an operation
// spends rather than only that a limiter was consulted.
const chargedRules: { bucket: string; identifier: string }[] = [];
const mockConsumeDenRateLimit = mock(
  (rule: { bucket: string }, identifier: string) => {
    chargedRules.push({ bucket: rule.bucket, identifier });
    return Promise.resolve(
      limiterDenies
        ? Response.json({ error: "slow down" }, { status: 429 })
        : null
    );
  }
);
mock.module("@/lib/messages/den-rate-limit", () =>
  denRateLimitDouble(mockConsumeDenRateLimit)
);

mock.module("@/lib/messages/server", () => ({
  hasMessageIdentity: mockHasMessageIdentity,
}));

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  DenError,
  getDenMembership: mockGetDenMembership,
  joinDenByInviteCode: mockJoinDenByInviteCode,
  previewInvite: mockPreviewInvite,
}));

function previewRequest(code = "code-abcdefghijk", session: Session = null) {
  mockGetSession.mockReturnValue(session);
  return GET(
    new Request(`http://localhost:3000/api/messages/dens/join/${code}`),
    { params: Promise.resolve({ code }) }
  );
}

function join(code = "code-abcdefghijk", session: Session = null) {
  mockGetSession.mockReturnValue(session);
  return POST(
    new Request(`http://localhost:3000/api/messages/dens/join/${code}`, {
      method: "POST",
    }),
    { params: Promise.resolve({ code }) }
  );
}

describe("GET /api/messages/dens/join/:code", () => {
  beforeEach(() => {
    preview = {
      id: "den-1",
      inviteCode: "code-abcdefghijk",
      memberCount: 4,
      name: "game night",
    };
    membership = null;
    limiterDenies = false;
    chargedRules.length = 0;
    mockConsumeDenRateLimit.mockClear();
    mockGetDenMembership.mockClear();
    mockGetSession.mockClear();
    mockPreviewInvite.mockClear();
    mockPreviewInvite.mockImplementation(() => Promise.resolve(preview));
  });

  test("404s a code that does not resolve", async () => {
    // The `code` field is part of the answer on purpose: a caller branching on
    // it must not be able to tell this from a full den, and it cannot, because
    // a full den is answered with these same bytes.
    preview = null;
    const res = await previewRequest();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "NOT_FOUND",
      error: "That join code is not valid",
    });
  });

  test("answers a rotated-away code the same way as one that never existed", async () => {
    // Otherwise this endpoint can be used to test whether a guessed code was
    // ever valid, which turns a 12-character secret into a probe.
    preview = null;
    const neverExisted = await previewRequest("nope-nope-nope");
    const rotatedAway = await previewRequest("old-code-old-c");
    expect(rotatedAway.status).toBe(neverExisted.status);
    expect(await rotatedAway.json()).toEqual(await neverExisted.json());
  });

  test("reads without a session", async () => {
    // The join screen has to render for somebody who has not signed in yet, so
    // this route is the one den endpoint that does not require a session.
    const res = await previewRequest();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      den: { id: string; memberCount: number; name: string | null };
      isMember: boolean;
    };
    expect(body.den).toEqual({
      id: "den-1",
      memberCount: 4,
      name: "game night",
    });
    expect(body.isMember).toBe(false);
  });

  test("never discloses the roster or a member identity", async () => {
    // Possession of a code is not a reason to enumerate who is in a den, so the
    // whole payload is asserted rather than a few keys of it.
    const res = await previewRequest();
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual(["den", "isMember"]);
    expect(Object.keys(body.den as Record<string, unknown>).toSorted()).toEqual(
      ["id", "memberCount", "name"]
    );
    expect(JSON.stringify(body)).not.toContain("inviteCode");
  });

  test("does not even look up membership for a signed-out viewer", async () => {
    // A leaked code then tells an outsider nothing about whether its owner is
    // still inside the den.
    await previewRequest();
    expect(mockGetDenMembership).not.toHaveBeenCalled();
  });

  test("spends the preview's own budget, not the join's", async () => {
    // The gap this pins. A preview is a read, so it looked harmless to leave
    // unmetered while the join beside it was capped - but the preview is the
    // half that needs no session, and its 200-versus-404 answer is the half a
    // sweep would be reading. Unmetered, it was an open, anonymous, per-request
    // database lookup whose only cost was a comparison.
    await previewRequest();
    expect(chargedRules).toHaveLength(1);
    expect(chargedRules[0]?.bucket).toBe(DEN_JOIN_PREVIEW_RATE_LIMIT.bucket);
    // And the buckets are not the same, so neither can exhaust the other.
    expect(DEN_JOIN_PREVIEW_RATE_LIMIT.bucket).not.toBe(
      DEN_JOIN_RATE_LIMIT.bucket
    );
  });

  test("a refused preview never reaches the database", async () => {
    // Metered before the lookup, so a denied request costs no query at all. A
    // limiter that ran after the read would have already paid for the read it was
    // meant to prevent.
    limiterDenies = true;
    const res = await previewRequest();
    expect(res.status).toBe(429);
    expect(mockPreviewInvite).not.toHaveBeenCalled();
  });

  test("a signed-in previewer is metered per account, a stranger per address", async () => {
    // Two different keys, so a signed-out sweep cannot spend a signed-in
    // account's budget and vice versa. The address half is asserted by its kind
    // rather than its value: it is a keyed hash of whatever the ingress reported,
    // and pinning the digest here would test the HMAC instead of the routing.
    await previewRequest("code-abcdefghijk", { user: { id: "member-1" } });
    expect(chargedRules.at(-1)?.identifier).toBe("u:member-1");
    await previewRequest();
    expect(chargedRules.at(-1)?.identifier).toMatch(/^a:.+/u);
    expect(chargedRules.at(-1)?.identifier).not.toBe("u:member-1");
  });

  test("tells a signed-in member they are already inside", async () => {
    membership = { role: "MEMBER" };
    const res = await previewRequest("code-abcdefghijk", {
      user: { id: "member-1" },
    });
    const body = (await res.json()) as { isMember: boolean };
    expect(res.status).toBe(200);
    expect(body.isMember).toBe(true);
    expect(mockGetDenMembership).toHaveBeenCalledWith("den-1", "member-1");
  });

  test("tells a signed-in stranger they are not inside", async () => {
    const res = await previewRequest("code-abcdefghijk", {
      user: { id: "stranger" },
    });
    const body = (await res.json()) as { isMember: boolean };
    expect(body.isMember).toBe(false);
    expect(mockGetDenMembership).toHaveBeenCalled();
  });
});

describe("POST /api/messages/dens/join/:code", () => {
  beforeEach(() => {
    joinResult = { alreadyMember: false, id: "den-1" };
    limiterDenies = false;
    mockConsumeDenRateLimit.mockClear();
    mockGetSession.mockClear();
    mockHasMessageIdentity.mockClear();
    mockHasMessageIdentity.mockImplementation((userId: string) =>
      Promise.resolve(userId !== "no-identity")
    );
    mockJoinDenByInviteCode.mockClear();
    mockJoinDenByInviteCode.mockImplementation(() =>
      Promise.resolve(joinResult)
    );
  });

  test("requires auth", async () => {
    const res = await join();
    expect(res.status).toBe(401);
    expect(mockJoinDenByInviteCode).not.toHaveBeenCalled();
  });

  test("refuses a member with no message identity before writing anything", async () => {
    // Checked BEFORE the join rather than after: a member with nothing to unwrap
    // a root key with would be left in a den they can see the name of and read
    // none of. Refusing first means the membership row is never written.
    const res = await join("code-abcdefghijk", {
      user: { id: "no-identity" },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Enable Messages first to join a den",
    });
    expect(mockJoinDenByInviteCode).not.toHaveBeenCalled();
    // The limiter is not spent on a request that was never going to happen.
    expect(mockConsumeDenRateLimit).not.toHaveBeenCalled();
  });

  test("answers 429 without joining when the limiter denies", async () => {
    limiterDenies = true;
    const res = await join("code-abcdefghijk", { user: { id: "newcomer" } });
    expect(res.status).toBe(429);
    expect(mockJoinDenByInviteCode).not.toHaveBeenCalled();
  });

  test("201s a real join", async () => {
    const res = await join("code-abcdefghijk", { user: { id: "newcomer" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      alreadyMember: false,
      conversationId: "den-1",
      ok: true,
    });
    expect(mockJoinDenByInviteCode).toHaveBeenCalledWith(
      "code-abcdefghijk",
      "newcomer"
    );
  });

  test("200s a re-opened link the caller already joined through", async () => {
    // Not an error: a client re-opening the link it already used should navigate
    // rather than show a failure toast. 200 rather than 201 because nothing new
    // was created.
    joinResult = { alreadyMember: true, id: "den-1" };
    const res = await join("code-abcdefghijk", { user: { id: "member-1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      alreadyMember: true,
      conversationId: "den-1",
      ok: true,
    });
  });

  test("skips the follow gate, which is what a link is for", async () => {
    // A non-follower arriving through a link is the whole point of one, so the
    // join must not consult anything the add route would have consulted. The
    // only precondition here is a message identity, asserted above.
    await join("code-abcdefghijk", { user: { id: "nobody-follows-them" } });
    expect(mockJoinDenByInviteCode).toHaveBeenCalledWith(
      "code-abcdefghijk",
      "nobody-follows-them"
    );
  });

  test("404s a code that does not resolve", async () => {
    mockJoinDenByInviteCode.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "That join code is not valid")
    );
    const res = await join("nope-nope-nope", { user: { id: "newcomer" } });
    expect(res.status).toBe(404);
  });

  test("a full den is refused exactly as a dead code is", async () => {
    // A full den used to answer 409 LIMIT_REACHED while a dead code answered
    // 404, so the difference between the two statuses was a validity oracle for
    // anybody sweeping codes. It is now the same 404 and the same body, and the
    // screen learns the den is full from the preview's member count instead -
    // which it was given either way.
    mockJoinDenByInviteCode.mockRejectedValueOnce(
      new DenError(
        "LIMIT_REACHED",
        `This den is full (${DEN_LIMITS.membersMax} members)`
      )
    );
    const res = await join("code-abcdefghijk", { user: { id: "newcomer" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "NOT_FOUND",
      error: "That join code is not valid",
    });
  });

  test("a dead code and a full den are byte-identical answers", async () => {
    mockJoinDenByInviteCode.mockRejectedValueOnce(
      new DenError("NOT_FOUND", "That join code is not valid")
    );
    const dead = await join("code-abcdefghijk", {
      user: { id: "newcomer" },
    });
    mockJoinDenByInviteCode.mockRejectedValueOnce(
      new DenError(
        "LIMIT_REACHED",
        `This den is full (${DEN_LIMITS.membersMax} members)`
      )
    );
    const full = await join("code-abcdefghijk", { user: { id: "newcomer" } });
    // Not merely the same status: the same body, so there is nothing in the
    // response shape to tell the two apart either.
    expect(full.status).toBe(dead.status);
    expect(await full.text()).toBe(await dead.text());
  });

  test("500s on a failure that is not a domain outcome", async () => {
    mockJoinDenByInviteCode.mockRejectedValueOnce(new Error("boom"));
    const res = await join("code-abcdefghijk", { user: { id: "newcomer" } });
    expect(res.status).toBe(500);
  });
});
