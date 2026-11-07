import { describe, expect, test } from "bun:test";

import {
  clearMentionAvatarCache,
  fetchMentionAvatar,
  resolveMentionAvatars,
} from "./mention-avatar";

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function stubFetch(handler: (url: string) => Response): void {
  (globalThis as { fetch: typeof fetch }).fetch = ((url: string) =>
    Promise.resolve(handler(url))) as typeof fetch;
}

describe("mention avatar resolution", () => {
  test("returns the avatar url on success", async () => {
    stubFetch(() => jsonResponse(200, { avatarUrl: "https://img/a.png" }));
    expect(await fetchMentionAvatar("https://api", "ada")).toBe(
      "https://img/a.png"
    );
  });

  test("401/404 resolve to null without throwing", async () => {
    stubFetch(() => jsonResponse(404, {}));
    expect(await fetchMentionAvatar("https://api", "ghost")).toBeNull();
  });

  test("other failures throw so the caller can retry later", async () => {
    stubFetch(() => jsonResponse(500, {}));
    await expect(fetchMentionAvatar("https://api", "ada")).rejects.toThrow();
    stubFetch(() => {
      throw new Error("offline");
    });
    await expect(fetchMentionAvatar("https://api", "ada")).rejects.toThrow();
  });

  test("resolved avatars are cached per session, misses are not", async () => {
    clearMentionAvatarCache();
    let calls = 0;
    const resolve = (username: string): Promise<string | null> => {
      calls += 1;
      return Promise.resolve(username === "ada" ? "https://img/a.png" : null);
    };
    expect(await resolveMentionAvatars(["ada", "ghost"], resolve)).toEqual({
      ada: "https://img/a.png",
    });
    expect(calls).toBe(2);
    expect(await resolveMentionAvatars(["ada", "ghost"], resolve)).toEqual({
      ada: "https://img/a.png",
    });
    expect(calls).toBe(2);
  });

  test("rejected lookups stay uncached and run again", async () => {
    clearMentionAvatarCache();
    let calls = 0;
    const resolve = (): Promise<string | null> => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("flaky"));
      }
      return Promise.resolve("https://img/a.png");
    };
    expect(await resolveMentionAvatars(["ada"], resolve)).toEqual({});
    expect(await resolveMentionAvatars(["ada"], resolve)).toEqual({
      ada: "https://img/a.png",
    });
    expect(calls).toBe(2);
  });

  test("usernames dedupe within one call", async () => {
    clearMentionAvatarCache();
    let calls = 0;
    const resolve = (username: string): Promise<string | null> => {
      calls += 1;
      return Promise.resolve(`https://img/${username}.png`);
    };
    expect(await resolveMentionAvatars(["ada", "ada"], resolve)).toEqual({
      ada: "https://img/ada.png",
    });
    expect(calls).toBe(1);
  });
});
