import { beforeEach, describe, expect, mock, test } from "bun:test";

import { DEN_LIMITS } from "@asm/db/messages/dens";

import {
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  denRateLimitDouble,
} from "@/lib/messages/test-support/den-rate-limit-double";
import { asmDbMockBase } from "@/posts/test-support/asm-db-mock";

import { GET } from "./route";

// The bytes behind the join screen's den picture.
//
// The whole design rests on this NOT being `/api/media/{id}`. That route admits
// conversation members and refuses everybody else, and a reader who has not joined
// yet is nobody, so serving the picture from there would have shown a placeholder on
// every invite link for a den that has a perfectly good image - which is the bug this
// endpoint exists to fix. Minting a short-lived presigned URL instead keeps the
// storage pipeline in one place and gives the reader a URL that stops working on its
// own.
//
// So the tests here are mostly about refusals. A code that is not live, a code the
// reader can neither use nor already holds, a den whose avatar is bound to some other
// conversation, and a sweep that must learn nothing: those are the cases where this
// route could become the thing the preview is carefully built not to be.

interface Preview {
  avatarMediaId: string | null;
  expired: boolean;
  id: string;
  inviteCode: string;
  memberCount: number;
  name: string | null;
  ownerId: string | null;
}

interface MediaRow {
  id: string;
  key: string;
  mimeType: string;
  publishedKey: string | null;
  status: string;
}

let preview: Preview | null;
let media: MediaRow | null;
let session: { user: { id: string } } | null;
let membership: { leftAt: Date | null; role: string } | null;
let limiterDenies: boolean;
let signedKeys: string[];

const mockGetSession = mock(() => session);
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

const mockPreviewInvite = mock(() => Promise.resolve(preview));
const mockGetDenMembership = mock(() => Promise.resolve(membership));

// The media lookup, mocked by EVALUATING the builder rather than by returning a
// canned row.
//
// This matters more than it usually would: the `messageConversationId` binding is
// the whole reason a code cannot be used to read somebody else's upload, so a
// double that ignored the `where` would report a row for any predicate at all and
// the refusal test below would be asserting nothing. `and` is the real helper
// (spreading to an array), so recording the two `eq`s the route writes is enough to
// check that it wrote the two it meant to.
// A Map rather than a plain object: the recorder is emptied between tests, and
// clearing an object by deleting computed keys is the pattern the linter (rightly)
// rejects.
const requestedEquals = new Map<string, unknown>();
// What the route actually asked for, kept after the lookup so a test can assert the
// predicate rather than only its outcome.
let lastMediaFilter: Record<string, unknown> = {};

function fakeRow() {
  const field = (name: string) => ({
    eq: (value: unknown) => {
      requestedEquals.set(name, value);
      return { name };
    },
  });
  return {
    id: field("id"),
    messageConversationId: field("messageConversationId"),
  };
}

// Named rather than inline so `beforeEach` can put it BACK. An override that is
// never restored silently turns every later test in the file into the same test,
// which is how the quarantine and signed-out cases ended up passing for the wrong
// reason.
function defaultMediaFirst(): Promise<MediaRow | null> {
  if (!media) {
    return Promise.resolve(null);
  }
  // The route must ask for BOTH halves: the media id the den names, and that the
  // row is bound to THIS den. A predicate missing either one would read as a row
  // for anything.
  if (
    media.id !== requestedEquals.get("id") ||
    preview?.id !== requestedEquals.get("messageConversationId")
  ) {
    return Promise.resolve(null);
  }
  return Promise.resolve(media);
}

const mockMediaFirst = mock(defaultMediaFirst);

const postMediaDouble = {
  select: () => ({
    where: (build: (row: ReturnType<typeof fakeRow>) => unknown) => ({
      first: () => {
        requestedEquals.clear();
        build(fakeRow());
        lastMediaFilter = Object.fromEntries(requestedEquals);
        return mockMediaFirst();
      },
    }),
  }),
};

const prismaDouble = { orm: { public: { PostMedia: postMediaDouble } } };

mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  getDenMembership: mockGetDenMembership,
  previewInvite: mockPreviewInvite,
  prisma: prismaDouble,
}));

const mockConsumeDenRateLimit = mock(
  (_rule: { bucket: string }, _identifier: string) =>
    Promise.resolve(
      limiterDenies
        ? Response.json({ error: "slow down" }, { status: 429 })
        : null
    )
);
mock.module("@/lib/messages/den-rate-limit", () =>
  denRateLimitDouble(mockConsumeDenRateLimit)
);

const mockGeneratePresignedUrl = mock((key: string) => {
  signedKeys.push(key);
  return Promise.resolve(`https://objects.test/${key}?sig=abc`);
});
mock.module("@/lib/media/object-storage", () => ({
  generatePresignedUrl: mockGeneratePresignedUrl,
}));

const CODE = "code-abcdefghijk";

function avatarRequest(code = CODE) {
  return GET(
    new Request(`http://localhost:3000/api/messages/dens/join/${code}/avatar`),
    {
      params: Promise.resolve({ code }),
    }
  );
}

describe("GET /api/messages/dens/join/:code/avatar", () => {
  beforeEach(() => {
    preview = {
      avatarMediaId: "media-1",
      expired: false,
      id: "den-1",
      inviteCode: CODE,
      memberCount: 4,
      name: "game night",
      ownerId: "owner-1",
    };
    media = {
      id: "media-1",
      key: "dens/den-1/avatar.png",
      mimeType: "image/png",
      publishedKey: "dens/den-1/avatar.published.png",
      status: "READY",
    };
    requestedEquals.clear();
    lastMediaFilter = {};
    session = { user: { id: "newcomer" } };
    membership = null;
    limiterDenies = false;
    signedKeys = [];
    mockConsumeDenRateLimit.mockClear();
    mockGetSession.mockClear();
    mockPreviewInvite.mockClear();
    mockMediaFirst.mockClear();
    mockMediaFirst.mockImplementation(defaultMediaFirst);
    mockGeneratePresignedUrl.mockClear();
    mockGetDenMembership.mockClear();
  });

  test("a live joinable code gets a short-lived url for the den's picture", async () => {
    const res = await avatarRequest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      avatarUrl: "https://objects.test/dens/den-1/avatar.published.png?sig=abc",
    });
    // The pipeline's published original wins over the legacy key, exactly as the
    // media route resolves it.
    expect(signedKeys).toEqual(["dens/den-1/avatar.published.png"]);
  });

  // No-store on the response: the URL in it is a credential for one object, and a
  // shared cache must not be handed it.
  test("the url is never cached", async () => {
    const res = await avatarRequest();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("a den with no image answers null rather than a refusal", async () => {
    // The screen draws its placeholder for a null and for a 404 identically, so
    // this must not look like an error to the caller.
    preview = { ...preview, avatarMediaId: null };
    const res = await avatarRequest();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatarUrl: null });
    expect(mockGeneratePresignedUrl).not.toHaveBeenCalled();
  });

  // The product decision this route exists to enforce: the picture rides on a code
  // that still works, and on nothing else.
  test("a retired code gets no picture at all", async () => {
    preview = { ...preview, avatarMediaId: null, expired: true };
    const res = await avatarRequest();
    expect(res.status).toBe(404);
    expect(mockGeneratePresignedUrl).not.toHaveBeenCalled();
  });

  test("a code that does not resolve gets no picture", async () => {
    preview = null;
    const res = await avatarRequest();
    expect(res.status).toBe(404);
    expect(mockGeneratePresignedUrl).not.toHaveBeenCalled();
  });

  // The "joinable" half of "live joinable dens only". A full den's screen offers no
  // join button, so a picture of the room would be showing somebody a thing they
  // cannot walk into.
  test("a full den the reader is not inside of gets no picture", async () => {
    preview = { ...preview, memberCount: DEN_LIMITS.membersMax };
    const res = await avatarRequest();
    expect(res.status).toBe(404);
    expect(mockGeneratePresignedUrl).not.toHaveBeenCalled();
  });

  test("a member of a full den still sees the room they are in", async () => {
    preview = { ...preview, memberCount: DEN_LIMITS.membersMax };
    membership = { leftAt: null, role: "MEMBER" };
    const res = await avatarRequest();
    expect(res.status).toBe(200);
  });

  // Being inside is not the same as still being able to act, so a row that carries
  // a departure is not a membership for this purpose.
  test("somebody who left a full den gets no picture", async () => {
    preview = { ...preview, memberCount: DEN_LIMITS.membersMax };
    membership = { leftAt: new Date(), role: "MEMBER" };
    const res = await avatarRequest();
    expect(res.status).toBe(404);
  });

  // The refusal that stops this endpoint being a way to read an arbitrary upload.
  // The conversation names a media id, and a code holder must not be able to walk
  // that id over to somebody else's attachment - which is only true if the lookup is
  // bound to the den, so the predicate itself is asserted and not just its outcome.
  test("the lookup is bound to the den, so a media id names nothing on its own", async () => {
    const res = await avatarRequest();
    expect(res.status).toBe(200);
    expect(lastMediaFilter).toEqual({
      id: "media-1",
      messageConversationId: "den-1",
    });
  });

  test("an avatar bound to another conversation is refused", async () => {
    mockMediaFirst.mockImplementation(() => Promise.resolve(null));
    const res = await avatarRequest();
    expect(res.status).toBe(404);
    expect(mockGeneratePresignedUrl).not.toHaveBeenCalled();
  });

  test("a quarantined object is not served", async () => {
    media = { ...media, status: "REJECTED" };
    const res = await avatarRequest();
    expect(res.status).toBe(404);
    expect(mockGeneratePresignedUrl).not.toHaveBeenCalled();
  });

  test("a row with no object key at all is not served", async () => {
    media = { ...media, key: "", publishedKey: null };
    const res = await avatarRequest();
    expect(res.status).toBe(404);
  });

  // A sweep over this endpoint must teach nothing a sweep over the preview did not
  // already teach, so every refusal is the same bytes.
  test("every refusal is byte-identical", async () => {
    preview = null;
    const unknown = await avatarRequest("nope-nope-nope");
    const expired = await (() => {
      preview = {
        avatarMediaId: "media-1",
        expired: true,
        id: "den-1",
        inviteCode: CODE,
        memberCount: 4,
        name: "game night",
        ownerId: "owner-1",
      };
      return avatarRequest();
    })();
    expect(expired.status).toBe(unknown.status);
    expect(await expired.json()).toEqual(await unknown.json());
  });

  test("it spends the preview's budget, not the join's", async () => {
    await avatarRequest();
    expect(mockConsumeDenRateLimit).toHaveBeenCalledTimes(1);
    const [[rule]] = mockConsumeDenRateLimit.mock.calls as [
      [{ bucket: string }],
      string,
    ];
    expect(rule.bucket).toBe(DEN_JOIN_PREVIEW_RATE_LIMIT.bucket);
  });

  test("a throttled request is refused before anything is read", async () => {
    limiterDenies = true;
    const res = await avatarRequest();
    expect(res.status).toBe(429);
    expect(mockPreviewInvite).not.toHaveBeenCalled();
  });

  test("a signed-out reader can see the picture of a joinable den", async () => {
    // The join screen renders for somebody who has not signed in, so a session may
    // not be the gate on the picture - for LINK codes.
    session = null;
    const res = await avatarRequest();
    expect(res.status).toBe(200);
  });

  // The short-code half of the session gate: an anonymous sweep over the
  // 6-character space must not be able to mint presigned images of the rooms
  // it is hunting. Byte-identical refusal to a dead code, so the gate itself
  // is not an oracle, and it runs before the limiter so the sweep spends
  // nothing.
  test("a signed-out picture request for a 6-character code is refused like a dead code", async () => {
    session = null;
    preview = null;
    const dead = await avatarRequest("nope-nope-nope");
    preview = {
      avatarMediaId: "media-1",
      expired: false,
      id: "den-1",
      inviteCode: "ABC123",
      memberCount: 4,
      name: "game night",
      ownerId: "owner-1",
    };
    const gated = await avatarRequest("ABC123");
    expect(gated.status).toBe(404);
    expect(await gated.text()).toBe(await dead.text());
    expect(mockGeneratePresignedUrl).not.toHaveBeenCalled();
  });

  test("a signed-in picture request for a 6-character code works", async () => {
    preview = {
      avatarMediaId: "media-1",
      expired: false,
      id: "den-1",
      inviteCode: "ABC123",
      memberCount: 4,
      name: "game night",
      ownerId: "owner-1",
    };
    const res = await avatarRequest("ABC123");
    expect(res.status).toBe(200);
    expect(mockGeneratePresignedUrl).toHaveBeenCalledWith(
      "dens/den-1/avatar.published.png"
    );
  });
});
