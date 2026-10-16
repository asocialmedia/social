import { describe, expect, test } from "bun:test";

import { followingGustAvatars } from "@asm/ui/lib/gust-header";

import { fetchFollowingGustPreview } from "./following-gust-preview";

const people = ["first", "second", "third", "fourth"].map((id) => ({
  avatarUrl: `/avatars/${id}.png`,
  id,
  username: id,
}));

function server(gusts: unknown, status = 200) {
  const requests: string[] = [];
  const baseFetch = Object.assign(
    (url: string | URL | Request) => {
      const path = String(url);
      requests.push(path);
      return Promise.resolve(
        path.includes("following-list")
          ? Response.json(people)
          : Response.json(gusts, { status })
      );
    },
    { preconnect() {} }
  ) satisfies typeof fetch;
  return { baseFetch, requests };
}

describe("Following Gust header preview", () => {
  test("keeps source order and amplifier avatars without a second profile request", async () => {
    const { baseFetch, requests } = server({
      mode: "following",
      posts: [
        { followingSources: [people[1]], id: "one", userId: "outsider" },
        { followingSources: [people[0]], id: "two", userId: "first" },
      ],
    });
    const preview = await fetchFollowingGustPreview("viewer", {
      apiBase: "https://example.invalid",
      baseFetch,
    });
    expect(
      followingGustAvatars(preview.data?.posts ?? []).map((p) => p.id)
    ).toEqual(["second", "first"]);
    expect(preview.fallbackAvatars).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  test("uses followed profiles on old servers without treating their global feed as Following", async () => {
    const { baseFetch, requests } = server({
      posts: [{ id: "unrelated", userId: "outsider" }],
    });
    const preview = await fetchFollowingGustPreview("viewer", {
      apiBase: "https://example.invalid",
      baseFetch,
    });
    expect(preview.data).toBeNull();
    expect(preview.fallbackAvatars).toEqual(people.slice(0, 3));
    expect(requests[1]).toEndWith("/api/users/viewer/following-list");
  });

  test("shows followed profiles even when none have a playable Gust yet", async () => {
    const { baseFetch } = server({ mode: "following", posts: [] });
    const preview = await fetchFollowingGustPreview("viewer", {
      apiBase: "https://example.invalid",
      baseFetch,
    });
    expect(preview.data?.posts).toEqual([]);
    expect(preview.fallbackAvatars).toEqual(people.slice(0, 3));
  });

  test("does not issue another authenticated request after session expiry", async () => {
    const { baseFetch, requests } = server({ error: "Unauthorized" }, 401);
    await expect(
      fetchFollowingGustPreview("viewer", {
        apiBase: "https://example.invalid",
        baseFetch,
      })
    ).rejects.toMatchObject({ status: 401 });
    expect(requests).toHaveLength(1);
  });
});
