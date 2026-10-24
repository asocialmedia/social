import { describe, expect, test } from "bun:test";

import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { username } from "better-auth/plugins";

import { accountCollisionProtection } from "./account-collision";
import {
  ACCOUNT_LINKING_POLICY,
  protectLastSignInMethod,
} from "./account-linking-policy";
import { accountResolutionCodes } from "./account-resolution-codes";
import { newAccountResolutionState } from "./account-resolution-state";
import type {
  AccountResolutionState,
  AccountResolutionStore,
} from "./account-resolution-state";
import { socialUsername } from "./social-username";

const baseURL = "http://localhost:3001";

async function fixture() {
  const intents = new Map<string, AccountResolutionState>();
  const sentCodes = new Map<string, string>();
  const store: AccountResolutionStore = {
    create(id, state) {
      intents.set(id, structuredClone(state));
    },
    read(id) {
      const state = intents.get(id);
      return state
        ? { serialized: JSON.stringify(state), state: structuredClone(state) }
        : null;
    },
    update(id, previous, state) {
      const existing = intents.get(id);
      if (!existing || JSON.stringify(existing) !== previous) {
        return false;
      }
      intents.set(id, structuredClone(state));
      return true;
    },
  };
  const collision = accountCollisionProtection(store);
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
      collision.plugin,
      accountResolutionCodes(({ email, otp }) => {
        sentCodes.set(email, otp);
      }, store),
    ],
    secret: "account-linking-policy-test-secret-at-least-32-characters",
    socialProviders: {
      google: { clientId: "fixture", clientSecret: "fixture" },
      reddit: { clientId: "fixture", clientSecret: "fixture" },
    },
    user: {
      additionalFields: { username: { required: true, type: "string" } },
      validateUserInfo: collision.validate,
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
    return Promise.resolve({
      data: {
        email: identity.email,
        email_verified: identity.emailVerified,
        id,
        sub: id,
      },
      user,
    });
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
    intents,
    oauth,
    request,
    rows,
    sentCodes,
    setIdentity: (value: typeof identity) => {
      identity = value;
    },
  };
}

describe("account identity across password, Google and Reddit", () => {
  test("same-email OAuth requires an explicit link rather than combining accounts during sign-in", async () => {
    const f = await fixture();
    const userId = await f.credential();
    const callback = await f.oauth("google");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain(
      "error=account_not_linked"
    );
    expect(f.rows.user).toHaveLength(1);
    expect(
      f.rows.account?.find((row) => row.providerId === "google")
    ).toBeUndefined();
    const explicit = await f.oauth("google", await f.cookieFor(), true);
    expect(explicit.headers.get("location")).toBe(`${baseURL}/done`);
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
    const callback = await f.oauth("google", await f.cookieFor(), true);
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
      "error=account_collision"
    );
    const id = new URL(conflict.headers.get("location") ?? "").searchParams.get(
      "account_collision"
    );
    expect(id).toBeTruthy();
    expect(f.intents.get(id ?? "")).toMatchObject({
      identityVerified: true,
      otherUserId: owner,
      provider: "reddit",
      providerAccountId: "reddit-1",
    });
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

test("an existing provider identity wins over a changed email matching another asocialmedia user", async () => {
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

test("native Google ID-token sign-in cannot implicitly take the same-email password identity", async () => {
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
  expect(response.ok).toBe(false);
  expect(f.rows.user).toHaveLength(1);
  expect(
    f.rows.account?.find((row) => row.providerId === "google")?.userId
  ).toBeUndefined();
  expect(f.rows.user?.[0]?.id).toBe(owner);
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

test("a newly connected Google identity matching another account's email requires review", async () => {
  const f = await fixture();
  const other = await f.credential("owner@example.com", "owner");
  await f.credential("current@example.com", "current");
  f.setIdentity({
    email: "owner@example.com",
    emailVerified: true,
    id: "new-google",
    name: "Owner",
    username: "owner",
  });
  const result = await f.oauth(
    "google",
    await f.cookieFor("current@example.com"),
    true
  );
  expect(result.headers.get("location")).toContain("error=account_collision");
  const id =
    new URL(result.headers.get("location") ?? "").searchParams.get(
      "account_collision"
    ) ?? "";
  expect(f.intents.get(id)).toMatchObject({
    identityVerified: true,
    otherUserId: other,
    providerAccountId: "new-google",
    providerOwnerId: null,
  });
  expect(f.rows.user).toHaveLength(2);
  expect(
    f.rows.account?.find((row) => row.providerId === "google")
  ).toBeUndefined();
});

test("a Reddit-only account can connect verified Google without a usable current email", async () => {
  const f = await fixture();
  f.setIdentity({
    email: "reddit@reddit.placeholder.invalid",
    emailVerified: true,
    id: "reddit-only",
    name: "Reddit",
    username: "reddit",
  });
  const signup = await f.oauth("reddit");
  const cookie = signup.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  f.setIdentity({
    email: "google@example.com",
    emailVerified: true,
    id: "google-new",
    name: "Google",
    username: "google",
  });
  const linked = await f.oauth("google", cookie, true);
  expect(linked.headers.get("location")).toBe(`${baseURL}/done`);
  expect(f.rows.user).toHaveLength(1);
  expect(f.rows.account).toHaveLength(2);
});

test("collision email proofs are session-bound, consume their code, and never change an account email", async () => {
  const f = await fixture();
  const current = await f.credential();
  const other = await f.credential("other@example.com", "other");
  const cookie = await f.cookieFor();
  const sessionResponse = await f.request("/get-session", undefined, cookie);
  const session = (await sessionResponse.json()) as { session: { id: string } };
  const id = crypto.randomUUID();
  f.intents.set(
    id,
    newAccountResolutionState(current, session.session.id, {
      email: "other@example.com",
      kind: "email",
      otherUserId: other,
    })
  );
  const body = { email: "other@example.com", id, side: "collision" };
  const unrelatedCookie = await f.cookieFor("other@example.com");
  const unrelatedResponse = await f.request(
    "/account-resolution/code",
    body,
    unrelatedCookie
  );
  expect(unrelatedResponse.status).toBe(401);
  const codeResponse = await f.request(
    "/account-resolution/code",
    body,
    cookie
  );
  expect(codeResponse.status).toBe(200);
  const otp = f.sentCodes.get("other@example.com");
  expect(otp).toMatch(/^\d{6}$/);
  expect(f.intents.get(id)?.identityVerified).toBe(false);
  const verificationResponse = await f.request(
    "/account-resolution/code",
    { ...body, otp },
    cookie
  );
  expect(verificationResponse.status).toBe(200);
  expect(f.intents.get(id)?.identityVerified).toBe(true);
  expect(f.intents.get(id)?.codes.collision).toBeUndefined();
  const replayResponse = await f.request(
    "/account-resolution/code",
    { ...body, otp },
    cookie
  );
  expect(replayResponse.ok).toBe(false);
  expect(f.rows.user?.find((row) => row.id === current)?.email).toBe(
    "member@example.com"
  );
  expect(f.rows.user?.find((row) => row.id === other)?.email).toBe(
    "other@example.com"
  );
});

test("three incorrect merge email codes exhaust the challenge", async () => {
  const f = await fixture();
  const current = await f.credential();
  const other = await f.credential("other@example.com", "other");
  const cookie = await f.cookieFor();
  const sessionResponse = await f.request("/get-session", undefined, cookie);
  const session = (await sessionResponse.json()) as { session: { id: string } };
  const id = crypto.randomUUID();
  f.intents.set(
    id,
    newAccountResolutionState(current, session.session.id, {
      email: "other@example.com",
      kind: "email",
      otherUserId: other,
    })
  );
  const body = { email: "other@example.com", id, side: "collision" };
  await f.request("/account-resolution/code", body, cookie);
  const otp = f.sentCodes.get("other@example.com");
  const wrong = otp === "000000" ? "111111" : "000000";
  await f.request("/account-resolution/code", { ...body, otp: wrong }, cookie);
  await f.request("/account-resolution/code", { ...body, otp: wrong }, cookie);
  await f.request("/account-resolution/code", { ...body, otp: wrong }, cookie);
  const replayResponse = await f.request(
    "/account-resolution/code",
    { ...body, otp },
    cookie
  );
  expect(replayResponse.ok).toBe(false);
  expect(f.intents.get(id)?.identityVerified).toBe(false);
  expect(f.rows.user).toHaveLength(2);
});

test("missing-email setup only verifies an unused inbox for the intended profile", async () => {
  const f = await fixture();
  const current = await f.credential();
  const other = await f.credential(
    "placeholder@reddit.placeholder.invalid",
    "reddit"
  );
  const cookie = await f.cookieFor();
  const sessionResponse = await f.request("/get-session", undefined, cookie);
  const session = (await sessionResponse.json()) as { session: { id: string } };
  const id = crypto.randomUUID();
  const state = newAccountResolutionState(current, session.session.id, {
    kind: "oauth",
    provider: "reddit",
  });
  f.intents.set(id, { ...state, identityVerified: true, otherUserId: other });
  const occupiedResponse = await f.request(
    "/account-resolution/code",
    { email: "member@example.com", id, side: "other" },
    cookie
  );
  expect(occupiedResponse.status).toBe(409);
  const body = { email: "new@example.com", id, side: "other" };
  const codeResponse = await f.request(
    "/account-resolution/code",
    body,
    cookie
  );
  expect(codeResponse.status).toBe(200);
  const otp = f.sentCodes.get("new@example.com");
  const verificationResponse = await f.request(
    "/account-resolution/code",
    { ...body, otp },
    cookie
  );
  expect(verificationResponse.status).toBe(200);
  expect(f.intents.get(id)?.setupEmails.other).toBe("new@example.com");
  expect(f.rows.user?.find((row) => row.id === other)?.email).toBe(
    "placeholder@reddit.placeholder.invalid"
  );
});
