// oxlint-disable require-await -- Async fakes implement the native adapters Promise contracts.
import { describe, expect, test } from "bun:test";

import { authorizationProxyUrl, runBrowserOAuth } from "./browser-oauth";

const callbackUrl = "asocialmedia:///login";
const authorizationUrl =
  "https://www.reddit.com/api/v1/authorize?state=test-state";

function flow(overrides: Partial<Parameters<typeof runBrowserOAuth>[0]> = {}) {
  return {
    callbackUrl,
    open: async () => ({
      type: "success",
      url: `${callbackUrl}?cookie=session-cookie`,
    }),
    persist: async () => {},
    refresh: async () => true,
    request: async () => ({ url: authorizationUrl }),
    ...overrides,
  };
}

describe("native browser OAuth", () => {
  test("finishes the HTTP request before opening the browser and stores cookies before reading the session", async () => {
    const events: string[] = [];
    const gate = Promise.withResolvers<undefined>();
    const request = runBrowserOAuth(
      flow({
        open: async (url) => {
          expect(url).toBe(authorizationUrl);
          events.push("opened");
          return {
            type: "success",
            url: `${callbackUrl}?cookie=session-cookie`,
          };
        },
        persist: async (cookie) => {
          expect(cookie).toBe("session-cookie");
          events.push("persisting");
          await gate.promise;
          events.push("persisted");
        },
        refresh: async () => {
          events.push("refreshed");
          return true;
        },
        request: async () => {
          events.push("requested");
          return { url: authorizationUrl };
        },
      })
    );
    await Bun.sleep(0);
    expect(events).toEqual(["requested", "opened", "persisting"]);
    gate.resolve();
    expect(await request).toEqual({ status: "complete" });
    expect(events).toEqual([
      "requested",
      "opened",
      "persisting",
      "persisted",
      "refreshed",
    ]);
  });

  test("receives provider errors directly from the browser result on iOS and Android", async () => {
    expect(
      await runBrowserOAuth(
        flow({
          open: async () => ({
            type: "success",
            url: `${callbackUrl}?error=state_mismatch`,
          }),
        })
      )
    ).toEqual({ code: "state_mismatch", status: "redirect-error" });
  });

  test("does not treat a cancelled browser as a successful existing session", async () => {
    expect(
      await runBrowserOAuth(
        flow({
          open: async () => ({ type: "cancel" }),
          refresh: async () => {
            throw new Error("must not check a stale session");
          },
        })
      )
    ).toEqual({ status: "cancelled" });
  });

  test("never imports cookies from an unrelated callback", async () => {
    expect(
      await runBrowserOAuth(
        flow({
          open: async () => ({
            type: "success",
            url: "other-app:///login?cookie=untrusted",
          }),
          persist: async () => {
            throw new Error("must not store untrusted cookies");
          },
        })
      )
    ).toMatchObject({ status: "failed" });
  });

  test("reports missing cookies and sessions instead of silently cancelling", async () => {
    expect(
      await runBrowserOAuth(
        flow({ open: async () => ({ type: "success", url: callbackUrl }) })
      )
    ).toEqual({ status: "missing-cookie" });
    expect(await runBrowserOAuth(flow({ refresh: async () => false }))).toEqual(
      { status: "missing-cookie" }
    );
  });

  test("keeps encrypted OAuth state for the current server and supports legacy signed-state servers", () => {
    const modern = new URL(
      authorizationProxyUrl(
        "https://social.test/api/auth",
        authorizationUrl,
        "__Secure-better-auth.oauth_state=encrypted-state==; another=value"
      )
    );
    const mobile = new URL(modern.searchParams.get("authorizationURL") ?? "");
    expect(mobile.pathname).toBe("/api/v1/authorize.compact");
    expect(mobile.searchParams.get("state")).toBe("test-state");
    expect(modern.searchParams.get("oauthState")).toBe("encrypted-state==");
    const legacy = new URL(
      authorizationProxyUrl(
        "https://social.test/api/auth/",
        authorizationUrl,
        "__Secure-better-auth.state=signed-state"
      )
    );
    expect(legacy.pathname).toBe("/api/auth/expo-authorization-proxy");
    expect(legacy.searchParams.has("oauthState")).toBe(false);
  });
});

test("linking may retain an existing cookie but must verify the linked account", async () => {
  const returned = flow({
    open: async () => ({ type: "success", url: "asocialmedia:///login" }),
    persist: async () => {
      throw new Error("no cookie should be persisted");
    },
    requireCookie: false,
  });
  expect(await runBrowserOAuth(returned)).toEqual({ status: "complete" });
  expect(
    await runBrowserOAuth({ ...returned, refresh: async () => false })
  ).toEqual({ status: "missing-cookie" });
});
