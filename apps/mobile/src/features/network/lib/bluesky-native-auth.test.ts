import { describe, expect, test } from "bun:test";

import {
  authorizeNativeBluesky,
  BLUESKY_NATIVE_RETURN,
} from "./bluesky-native-auth";

function scenario(result: (state: string) => { type: string; url?: string }) {
  const calls: Record<string, unknown>[] = [];
  let sequence = 0;
  let state = "";
  const transport = {
    digest: (verifier: string) => Promise.resolve(`sha256:${verifier}`),
    openBrowser: (_url: string, returnUrl: string) => {
      expect(returnUrl).toBe(BLUESKY_NATIVE_RETURN);
      return Promise.resolve(result(state));
    },
    randomId: () => `random-${(sequence += 1)}`,
    request: (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push(body);
      if (typeof body.state === "string") {
        ({ state } = body);
        return Promise.resolve({
          url: "https://asm.test/authorize?ticket=opaque",
        });
      }
      return Promise.resolve({ handle: "alice.bsky.social" });
    },
  };
  return { calls, transport };
}

describe("native Bluesky browser handoff", () => {
  test("completes only after a matching native return and exchanges the verifier", async () => {
    const run = scenario((state) => ({
      type: "success",
      url: `${BLUESKY_NATIVE_RETURN}?state=${state}&code=opaque&bluesky=authorized`,
    }));
    expect(
      await authorizeNativeBluesky(" alice.bsky.social ", run.transport)
    ).toBe("alice.bsky.social");
    expect(run.calls).toEqual([
      {
        challenge: "sha256:random-1random-2",
        handle: "alice.bsky.social",
        state: "random-3",
      },
      { code: "opaque", verifier: "random-1random-2" },
    ]);
    expect(run.calls[0]).not.toHaveProperty("verifier");
  });
  test.each(["cancel", "dismiss"])(
    "%s never exchanges a code",
    async (type) => {
      const run = scenario(() => ({ type }));
      expect(
        await authorizeNativeBluesky("alice.test", run.transport)
      ).toBeNull();
      expect(run.calls).toHaveLength(1);
    }
  );
  test.each([
    "asocialmedia://settings?state=wrong&code=opaque&bluesky=authorized",
    "https://attacker.test/settings?state=random-3&code=opaque&bluesky=authorized",
    "asocialmedia://other?state=random-3&code=opaque&bluesky=authorized",
    "asocialmedia://settings?state=random-3&bluesky=error",
  ])("rejects an invalid authorization return: %s", async (url) => {
    const run = scenario(() => ({ type: "success", url }));
    await expect(
      authorizeNativeBluesky("alice.test", run.transport)
    ).rejects.toBeInstanceOf(Error);
    expect(run.calls).toHaveLength(1);
  });
});
