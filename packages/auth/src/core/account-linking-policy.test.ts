import { describe, expect, test } from "bun:test";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { username } from "better-auth/plugins";

import {
  ACCOUNT_LINKING_POLICY,
  protectLastSignInMethod,
  validateOAuthIdentity,
} from "./account-linking-policy";
import { socialUsername } from "./social-username";

const baseURL = "http://localhost:3001";

async function fixture() {
  const rows: Record<string, Record<string, unknown>[]> = {
    account: [],
    session: [],
    user: [],
    verification: [],
  };
  const auth = betterAuth({
    account: {
      accountLinking: {
        ...ACCOUNT_LINKING_POLICY,
        trustedProviders: ["google", "reddit"],
      },
      skipStateCookieCheck: true,
    },
    baseURL,
    database: memoryAdapter(rows),
    emailAndPassword: { enabled: true, requireEmailVerification: true },
    plugins: [
      socialUsername({ isReserved: () => false }),
      username(),
      protectLastSignInMethod(),
    ],
    secret: "account-linking-policy-test-secret-at-least-32-characters",
    socialProviders: {
      google: { clientId: "fixture", clientSecret: "fixture" },
      reddit: { clientId: "fixture", clientSecret: "fixture" },
    },
    user: {
      additionalFields: { username: { required: true, type: "string" } },
      validateUserInfo: validateOAuthIdentity,
    },
  });
  const context = await auth.$context;
  let identity = {
    email: "member@example.com",
    emailVerified: true,
    id: "google-1",
    name: "Provider name",
    username: "member",
  };
  const getUserInfo = () => {
    const { id, ...user } = identity;
    return Promise.resolve({ data: { id, sub: id }, user });
  };
  for (const provider of context.socialProviders) {
    provider.validateAuthorizationCode = () =>
      Promise.resolve({ accessToken: "fixture-token", scopes: ["identity"] });
    provider.getUserInfo = getUserInfo;
  }
  const request = (path: string, body?: unknown, cookie = "") =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          "content-type": "application/json",
          cookie,
          origin: baseURL,
        },
        method: body ? "POST" : "GET",
      })
    );
  const oauth = async (provider: string, cookie = "", link = false) => {
    const started = await request(
      link ? "/link-social" : "/sign-in/social",
      {
        callbackURL: `${baseURL}/done`,
        disableRedirect: true,
        errorCallbackURL: `${baseURL}/done`,
        provider,
      },
      cookie
    );
    expect(started.status).toBe(200);
    const body = (await started.json()) as { url: string };
    const state = new URL(body.url).searchParams.get("state");
    return request(
      `/callback/${provider}?code=fixture-code&state=${state}`,
      undefined,
      cookie
    );
  };
  const credential = async (
    email = "member@example.com",
    handle = "member",
    verified = true
  ) => {
    const result = await request("/sign-up/email", {
      email,
      name: handle,
      password: "A-valid-fixture-password-123!",
      username: handle,
    });
    expect(result.status).toBe(200);
    const data = (await result.json()) as { user: { id: string } };
    await context.internalAdapter.updateUser(data.user.id, {
      emailVerified: verified,
    });
    return data.user.id;
  };
  const cookieFor = async (email = "member@example.com") => {
    const result = await request("/sign-in/email", {
      email,
      password: "A-valid-fixture-password-123!",
    });
    expect(result.status).toBe(200);
    return result.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
  };
  return {
    auth,
    context,
    cookieFor,
    credential,
    oauth,
    request,
    rows,
    setIdentity: (value: typeof identity) => {
      identity = value;
    },
  };
}

describe("account identity across password, Google and Reddit", () => {
  test("verified Google email links to the existing verified password user without replacing their profile", async () => {
    const f = await fixture();
    const userId = await f.credential();
    const callback = await f.oauth("google");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${baseURL}/done`);
    expect(f.rows.user).toHaveLength(1);
    expect(
      f.rows.account?.find((row) => row.providerId === "google")
    ).toMatchObject({ userId });
    expect(f.rows.user?.[0]).toMatchObject({
      id: userId,
      name: "member",
      username: "member",
    });
    const passwordSignIn = await f.request("/sign-in/username", {
      password: "A-valid-fixture-password-123!",
      username: "member",
    });
    expect(passwordSignIn.status).toBe(200);
  });

  test("same-email OAuth cannot take an unverified local account", async () => {
    const f = await fixture();
    await f.credential("member@example.com", "member", false);
    const callback = await f.oauth("google");
    expect(callback.headers.get("location")).toContain(
      "error=account_not_linked"
    );
    expect(
      f.rows.account?.filter((row) => row.providerId === "google")
    ).toHaveLength(0);
  });

  test("unverified Google provider email cannot link even to a verified local user", async () => {
    const f = await fixture();
    await f.credential();
    f.setIdentity({
      email: "member@example.com",
      emailVerified: false,
      id: "unverified-google",
      name: "Unverified",
      username: "member",
    });
    const callback = await f.oauth("google");
    expect(callback.headers.get("location")).toContain(
      "error=oauth_email_not_verified"
    );
    expect(
      f.rows.account?.filter((row) => row.providerId === "google")
    ).toHaveLength(0);
  });

  test("explicit Reddit linking preserves the existing user despite a different placeholder email and colliding username", async () => {
    const f = await fixture();
    const userId = await f.credential();
    f.setIdentity({
      email: "reddit-1@reddit.placeholder.invalid",
      emailVerified: true,
      id: "reddit-1",
      name: "Reddit name",
      username: "member",
    });
    const callback = await f.oauth("reddit", await f.cookieFor(), true);
    expect(callback.headers.get("location")).toBe(`${baseURL}/done`);
    expect(f.rows.user).toHaveLength(1);
    expect(f.rows.user?.[0]).toMatchObject({
      email: "member@example.com",
      id: userId,
      username: "member",
    });
    expect(
      f.rows.account?.find((row) => row.providerId === "reddit")
    ).toMatchObject({ accountId: "reddit-1", userId });
    const returning = await f.oauth("reddit");
    expect(returning.headers.get("location")).toBe(`${baseURL}/done`);
    expect(f.rows.user).toHaveLength(1);
  });

  test("Google-only users can connect Reddit without adding a password", async () => {
    const f = await fixture();
    const google = await f.oauth("google");
    const cookie = google.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
    const userId = f.rows.user?.[0]?.id;
    f.setIdentity({
      email: "reddit-1@reddit.placeholder.invalid",
      emailVerified: true,
      id: "reddit-1",
      name: "Reddit",
      username: "member",
    });
    const reddit = await f.oauth("reddit", cookie, true);
    expect(reddit.headers.get("location")).toBe(`${baseURL}/done`);
    expect(f.rows.user).toHaveLength(1);
    expect(f.rows.account?.map((row) => row.userId)).toEqual([userId, userId]);
  });

  test("a provider already owned by another user cannot be transferred", async () => {
    const f = await fixture();
    const owner = await f.credential("owner@example.com", "owner");
    f.setIdentity({
      email: "reddit-1@reddit.placeholder.invalid",
      emailVerified: true,
      id: "reddit-1",
      name: "Reddit",
      username: "owner",
    });
    const linked = await f.oauth(
      "reddit",
      await f.cookieFor("owner@example.com"),
      true
    );
    expect(linked.status).toBe(302);
    await f.credential("other@example.com", "other");
    const conflict = await f.oauth(
      "reddit",
      await f.cookieFor("other@example.com"),
      true
    );
    expect(conflict.headers.get("location")).toContain(
      "error=account_already_linked_to_different_user"
    );
    expect(
      f.rows.account?.find((row) => row.providerId === "reddit")?.userId
    ).toBe(owner);
    expect(f.rows.user).toHaveLength(2);
  });

  test("an empty credential row cannot make it safe to unlink the only provider", async () => {
    const f = await fixture();
    const google = await f.oauth("google");
    const userId = String(f.rows.user?.[0]?.id);
    await f.context.internalAdapter.createAccount({
      accountId: userId,
      password: null,
      providerId: "credential",
      userId,
    });
    const target = f.rows.account?.find((row) => row.providerId === "google");
    const cookie = google.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
    const unlink = await f.request(
      "/unlink-account",
      { accountId: target?.id },
      cookie
    );
    expect(unlink.status).toBe(400);
    expect(await unlink.json()).toMatchObject({
      code: "cannot_unlink_last_method",
    });
    expect(f.rows.account?.some((row) => row.providerId === "google")).toBe(
      true
    );
  });
});

test("an existing provider identity wins over a changed email matching another ASM user", async () => {
  const f = await fixture();
  await f.oauth("google");
  const owner = f.rows.user?.[0]?.id;
  await f.credential("other@example.com", "other");
  f.setIdentity({
    email: "other@example.com",
    emailVerified: true,
    id: "google-1",
    name: "Changed provider",
    username: "other",
  });
  const callback = await f.oauth("google");
  expect(callback.headers.get("location")).toBe(`${baseURL}/done`);
  expect(
    f.rows.account?.find((row) => row.providerId === "google")?.userId
  ).toBe(owner);
  expect(f.rows.user?.find((row) => row.id === owner)).toMatchObject({
    email: "member@example.com",
    username: "member",
  });
  expect(f.rows.user).toHaveLength(2);
});

test("native Google ID-token sign-in links to the same verified password identity", async () => {
  const f = await fixture();
  const owner = await f.credential();
  const google = f.context.socialProviders.find(
    (provider) => provider.id === "google"
  );
  if (!google) {
    throw new Error("Missing Google fixture");
  }
  google.options = {
    ...google.options,
    verifyIdToken: () => Promise.resolve(true),
  };
  const response = await f.request("/sign-in/social", {
    callbackURL: `${baseURL}/done`,
    idToken: { token: "fixture-id-token" },
    provider: "google",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ user: { id: owner } });
  expect(f.rows.user).toHaveLength(1);
  expect(
    f.rows.account?.find((row) => row.providerId === "google")?.userId
  ).toBe(owner);
});

test("password signup cannot overwrite an existing OAuth account", async () => {
  const f = await fixture();
  await f.oauth("google");
  const owner = f.rows.user?.[0]?.id;
  await f.request("/sign-up/email", {
    email: "member@example.com",
    name: "Replacement",
    password: "A-valid-fixture-password-123!",
    username: "different",
  });
  expect(f.rows.user).toHaveLength(1);
  expect(f.rows.user?.[0]).toMatchObject({
    id: owner,
    name: "Provider name",
    username: "member",
  });
  expect(
    f.rows.account?.filter((account) => account.providerId === "credential")
  ).toHaveLength(0);
});
