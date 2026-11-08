import { describe, expect, test } from "bun:test";

import {
  cancelCommunityRequest,
  fetchCommunityPreview,
  parseCommunityPreview,
} from "./communities-api";
import type { CommunityPreview } from "./communities-api";
import {
  PENDING_PREVIEW_POLL_MS,
  previewPollInterval,
  privateLandingMode,
  privateLandingView,
} from "./community-private-access";

const API = "https://api.test";

function stubFetch(
  handler: (url: string, init?: RequestInit) => Response
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as unknown as typeof fetch;
}

const payload = {
  community: {
    accentColor: "violet",
    avatarUrl: null,
    bannerUrl: "/banners/secret.png",
    description: "Members talk here",
    id: "community-1",
    mature: false,
    memberCount: 3,
    name: "Secret",
    slug: "secret",
    topics: ["chat", 4],
    type: "PRIVATE",
  },
  membership: null,
  permissions: {
    banned: false,
    canModerate: false,
    canReadChat: false,
    canReadContent: false,
    canRequest: true,
  },
};

function previewWith(
  overrides: Partial<Pick<CommunityPreview, "membership">> & {
    banned?: boolean;
  }
): CommunityPreview {
  const parsed = parseCommunityPreview(payload);
  if (!parsed) {
    throw new Error("fixture did not parse");
  }
  return {
    ...parsed,
    membership:
      overrides.membership === undefined
        ? parsed.membership
        : overrides.membership,
    permissions: {
      ...parsed.permissions,
      banned: overrides.banned ?? false,
    },
  };
}

const pendingMembership = { role: "PARTICIPANT", status: "PENDING" };

describe("parseCommunityPreview", () => {
  test("keeps the public identity and the permissions block", () => {
    const preview = parseCommunityPreview(payload);
    expect(preview?.community).toEqual({
      ...payload.community,
      topics: ["chat"],
    });
    expect(preview?.permissions.canReadContent).toBe(false);
    expect(preview?.permissions.canRequest).toBe(true);
    expect(preview?.membership).toBeNull();
  });

  test("reads a pending membership", () => {
    const preview = parseCommunityPreview({
      ...payload,
      membership: { ...pendingMembership, userId: "u1" },
    });
    expect(preview?.membership).toEqual(pendingMembership);
  });

  test("rejects a body without a community or permissions", () => {
    expect(parseCommunityPreview({ error: "Community not found" })).toBeNull();
    expect(parseCommunityPreview({ community: payload.community })).toBeNull();
    expect(parseCommunityPreview(null)).toBeNull();
  });
});

describe("fetchCommunityPreview", () => {
  test("reads the preview route for the encoded slug", async () => {
    let requested = "";
    const preview = await fetchCommunityPreview("a/b", {
      apiBase: API,
      baseFetch: stubFetch((url) => {
        requested = url;
        return Response.json(payload);
      }),
    });
    expect(requested).toBe(`${API}/api/communities/a%2Fb/preview`);
    expect(preview?.community.slug).toBe("secret");
  });

  test("answers null for a missing community", async () => {
    const preview = await fetchCommunityPreview("gone", {
      apiBase: API,
      baseFetch: stubFetch(() =>
        Response.json({ error: "Community not found" }, { status: 404 })
      ),
    });
    expect(preview).toBeNull();
  });

  test("throws on a server failure so the caller can retry", async () => {
    await expect(
      fetchCommunityPreview("secret", {
        apiBase: API,
        baseFetch: stubFetch(() => new Response("", { status: 500 })),
      })
    ).rejects.toThrow("Community preview request failed (500)");
  });
});

describe("cancelCommunityRequest", () => {
  test("deletes the membership with the pending flag", async () => {
    let requested = "";
    let method = "";
    const result = await cancelCommunityRequest("secret", {
      apiBase: API,
      baseFetch: stubFetch((url, init) => {
        requested = url;
        method = init?.method ?? "";
        return Response.json({
          canModerate: false,
          membership: null,
          subscribed: false,
        });
      }),
    });
    expect(requested).toBe(
      `${API}/api/communities/secret/membership?pending=1`
    );
    expect(method).toBe("DELETE");
    expect(result.kind).toBe("success");
  });

  test("surfaces the server's error copy", async () => {
    const result = await cancelCommunityRequest("secret", {
      apiBase: API,
      baseFetch: stubFetch(() =>
        Response.json({ error: "No pending request" }, { status: 409 })
      ),
    });
    expect(result).toEqual({
      kind: "error",
      message: "No pending request",
      status: 409,
    });
  });
});

describe("privateLandingView", () => {
  test("invites a member to request access", () => {
    const view = privateLandingView({
      busy: false,
      isLoggedIn: true,
      preview: previewWith({}),
    });
    expect(view.mode).toBe("request");
    expect(view.requestLabel).toBe("Request to join");
    expect(view.description).toBe(
      "Join to read posts and take part in community chat. The owner or a moderator reviews each request."
    );
  });

  test("sends a guest to sign in", () => {
    const view = privateLandingView({
      busy: false,
      isLoggedIn: false,
      preview: previewWith({}),
    });
    expect(view.requestLabel).toBe("Sign in to request access");
  });

  test("shows the busy labels while a write is in flight", () => {
    const view = privateLandingView({
      busy: true,
      isLoggedIn: true,
      preview: previewWith({ membership: pendingMembership }),
    });
    expect(view.requestLabel).toBe("Sending…");
    expect(view.cancelLabel).toBe("Cancelling…");
  });

  test("explains a pending request", () => {
    const view = privateLandingView({
      busy: false,
      isLoggedIn: true,
      preview: previewWith({ membership: pendingMembership }),
    });
    expect(view.mode).toBe("pending");
    expect(view.cancelLabel).toBe("Cancel request");
    expect(view.description).toBe(
      "The owner or a moderator will review your request. Once approved, you can read posts and join community chat."
    );
  });

  test("a ban outranks a pending request", () => {
    const preview = previewWith({
      banned: true,
      membership: pendingMembership,
    });
    expect(privateLandingMode(preview)).toBe("banned");
    expect(
      privateLandingView({ busy: false, isLoggedIn: true, preview }).description
    ).toBe("You cannot request access to this community.");
  });
});

describe("previewPollInterval", () => {
  test("polls only while a request is pending", () => {
    expect(
      previewPollInterval(previewWith({ membership: pendingMembership }))
    ).toBe(PENDING_PREVIEW_POLL_MS);
    expect(PENDING_PREVIEW_POLL_MS).toBe(30_000);
    expect(previewPollInterval(previewWith({}))).toBeNull();
    expect(previewPollInterval(null)).toBeNull();
  });
});
