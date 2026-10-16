import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";

import {
  accountResolutionStore,
  newAccountResolutionState,
} from "@asm/auth/core";
import { prisma, toPrismaDateTime } from "@asm/db";

import {
  loadAccountReview,
  setupAccountForResolution,
  verifyAccountForResolution,
} from "./account-resolution";

const users: string[] = [];
const originalFetch = globalThis.fetch;

beforeAll(() => {
  if (
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DATABASE_URL ?? "http://invalid").hostname
    )
  ) {
    throw new Error("Local test database required");
  }
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
afterAll(async () => {
  await prisma.orm.public.Users.where((row) =>
    row.id.in(users)
  ).deleteAndCount();
});

async function fixture() {
  const current = crypto.randomUUID();
  const other = crypto.randomUUID();
  const id = crypto.randomUUID();
  users.push(current, other);
  await prisma.orm.public.Users.createAll(
    [current, other].map((userId) => ({
      displayName: "Proof fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      id: userId,
      username: `proof_${userId}`,
    }))
  );
  await prisma.orm.public.Accounts.createAll(
    [current, other].map((userId) => ({
      accountId: userId,
      password: "existing-hash",
      providerId: "credential",
      userId,
    }))
  );
  const session = await prisma.orm.public.Sessions.create({
    expiresAt: toPrismaDateTime(new Date(Date.now() + 60_000)),
    token: crypto.randomUUID(),
    userId: current,
  });
  await accountResolutionStore.create(id, {
    ...newAccountResolutionState(current, session.id, {
      kind: "oauth",
      provider: "reddit",
    }),
    identityVerified: true,
    otherUserId: other,
  });
  const pending = () => loadAccountReview(id, current, session.id);
  return { current, id, other, pending, session };
}

async function allowRecoveryEmail(
  f: Awaited<ReturnType<typeof fixture>>,
  email: string
) {
  const pending = await f.pending();
  expect(
    await accountResolutionStore.update(f.id, pending.serialized, {
      ...pending.state,
      setupEmails: { other: email },
    })
  ).toBe(true);
}

test("missing credentials can be set up after inbox verification and the email proof is consumed", async () => {
  const f = await fixture();
  await prisma.orm.public.Accounts.where({ userId: f.other }).deleteAndCount();
  await prisma.orm.public.Users.where({ id: f.other }).updateAndCount({
    email: `${f.other}@reddit.placeholder.invalid`,
    emailVerified: false,
  });
  const email = `recovery-${f.other}@example.test`;
  await expect(
    setupAccountForResolution(
      f.id,
      await f.pending(),
      "other",
      "Unique-setup-fixture-password-123!"
    )
  ).rejects.toThrow("Verify this account's recovery email first");
  await allowRecoveryEmail(f, email);
  globalThis.fetch = Object.assign(() => new Response("", { status: 200 }), {
    preconnect: originalFetch.preconnect,
  });
  await setupAccountForResolution(
    f.id,
    await f.pending(),
    "other",
    "Unique-setup-fixture-password-123!"
  );
  const account = await prisma.orm.public.Accounts.where({
    accountId: f.other,
    providerId: "credential",
    userId: f.other,
  }).first();
  const user = await prisma.orm.public.Users.where({ id: f.other }).first();
  expect(account?.password).toBeTruthy();
  expect(account?.password).not.toBe("Unique-setup-fixture-password-123!");
  expect(user?.email).toBe(email);
  expect(user?.emailVerified).toBe(true);
  const latest = await f.pending();
  expect(latest.state.setupEmails.other).toBeUndefined();
  expect(latest.state.proofs[f.other]).toBeUndefined();
  await expect(
    setupAccountForResolution(f.id, latest, "other")
  ).rejects.toThrow("Verify this account's recovery email first");
});

test("credential setup never replaces an existing password", async () => {
  const f = await fixture();
  await allowRecoveryEmail(f, `${f.other}@example.test`);
  globalThis.fetch = Object.assign(() => new Response("", { status: 200 }), {
    preconnect: originalFetch.preconnect,
  });
  await expect(
    setupAccountForResolution(
      f.id,
      await f.pending(),
      "other",
      "New-fixture-password-123!"
    )
  ).rejects.toThrow("already has a password");
  const account = await prisma.orm.public.Accounts.where({
    providerId: "credential",
    userId: f.other,
  }).first();
  expect(account?.password).toBe("existing-hash");
});

test("temporary verification sessions are removed while the initiating session survives", async () => {
  const f = await fixture();
  const temporary = await prisma.orm.public.Sessions.create({
    expiresAt: toPrismaDateTime(new Date(Date.now() + 60_000)),
    token: crypto.randomUUID(),
    userId: f.other,
  });
  globalThis.fetch = Object.assign(
    () => Response.json({ token: temporary.token, user: { id: f.other } }),
    { preconnect: originalFetch.preconnect }
  );
  await expect(
    verifyAccountForResolution(f.id, await f.pending(), "other", {
      password: "fixture",
    })
  ).resolves.toEqual({ verified: true });
  expect(
    await prisma.orm.public.Sessions.where({ id: temporary.id }).first()
  ).toBeNull();
  expect(
    await prisma.orm.public.Sessions.where({ id: f.session.id }).first()
  ).not.toBeNull();
  const latest = await f.pending();
  expect(latest.state.proofs[f.other]?.fingerprint).toBeTruthy();
});

test("a two-factor challenge does not count as proof and expired challenges cannot verify", async () => {
  const f = await fixture();
  globalThis.fetch = Object.assign(
    () =>
      Response.json(
        { twoFactorRedirect: true },
        {
          headers: { "set-cookie": "better-auth.two_factor=fixture; HttpOnly" },
        }
      ),
    { preconnect: originalFetch.preconnect }
  );
  await expect(
    verifyAccountForResolution(f.id, await f.pending(), "other", {
      password: "fixture",
    })
  ).resolves.toEqual({ twoFactorRequired: true });
  const pending = await f.pending();
  expect(pending.state.proofs[f.other]).toBeUndefined();
  expect(pending.state.challenges[f.other]?.cookie).toBe(
    "better-auth.two_factor=fixture"
  );
  await accountResolutionStore.update(f.id, pending.serialized, {
    ...pending.state,
    challenges: { [f.other]: { at: Date.now() - 300_001, cookie: "fixture" } },
  });
  await expect(
    verifyAccountForResolution(f.id, await f.pending(), "other", {
      code: "123456",
      method: "totp",
    })
  ).rejects.toThrow("challenge expired");
});

test("account reviews cannot be loaded by a different user or session", async () => {
  const f = await fixture();
  await expect(loadAccountReview(f.id, f.other, f.session.id)).rejects.toThrow(
    "review expired"
  );
  await expect(
    loadAccountReview(f.id, f.current, crypto.randomUUID())
  ).rejects.toThrow("review expired");
});
