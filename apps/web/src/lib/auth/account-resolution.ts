import {
  accountResolutionStore,
  assertPasswordNotPwned,
  hashPasswordWithScrypt,
  hybridSessionStore,
} from "@asm/auth/core";
import type { AccountResolutionState } from "@asm/auth/core";
import { recoveryEmail } from "@asm/auth/validation";
import type {
  AccountResolutionProfile,
  AccountResolutionReview,
} from "@asm/auth/validation";
import {
  accountCredentialFingerprint,
  AccountResolutionError,
  accountResolutionSummary,
  and,
  consumeRateLimit,
  prisma,
  readAccountResolutionState,
  resolveAccountCollision,
  toPrismaDateTime,
  userCache,
  updateAccountResolutionState,
} from "@asm/db";

import { authInternalHeaders, getAuthBaseUrl } from "./auth-internal";

export async function loadAccountReview(
  id: string,
  userId: string,
  sessionId: string
) {
  const pending = await accountResolutionStore.read(id);
  if (
    !pending ||
    pending.state.userId !== userId ||
    pending.state.sessionId !== sessionId
  ) {
    throw new AccountResolutionError(
      "This account review expired. Start again from settings."
    );
  }
  if (!pending.state.identityVerified || !pending.state.otherUserId) {
    throw new AccountResolutionError(
      "Verify access to the other account before reviewing it."
    );
  }
  return pending;
}

async function profileForReview(
  userId: string,
  state: AccountResolutionState
): Promise<AccountResolutionProfile> {
  const [user, accounts, summary, fingerprint] = await Promise.all([
    prisma.orm.public.Users.where({ id: userId }).first(),
    prisma.orm.public.Accounts.where({ userId }).all(),
    accountResolutionSummary(userId),
    accountCredentialFingerprint(userId),
  ]);
  if (!user || user.banned) {
    throw new AccountResolutionError(
      "Restricted accounts cannot be combined. Contact support."
    );
  }
  const proof = state.proofs[userId];
  return {
    avatarUrl: user.avatarUrl ?? user.image,
    displayName: user.displayName,
    email: recoveryEmail(user.email),
    emailVerified: user.emailVerified && Boolean(recoveryEmail(user.email)),
    hasPassword: accounts.some(
      (account) =>
        account.providerId === "credential" &&
        account.accountId === userId &&
        Boolean(account.password)
    ),
    id: user.id,
    protectedAccount:
      user.role !== "user" ||
      user.badge === "author" ||
      Boolean(user.badges?.includes("author")),
    providers: [
      ...new Set(
        accounts
          .filter((account) => account.providerId !== "credential")
          .map((account) => account.providerId)
      ),
    ],
    username: user.username,
    verified: Boolean(
      proof &&
      proof.fingerprint === fingerprint &&
      proof.at > Date.now() - 10 * 60_000
    ),
    ...summary,
  };
}

export async function getAccountReview(
  id: string,
  state: AccountResolutionState
): Promise<AccountResolutionReview> {
  if (!state.otherUserId) {
    throw new AccountResolutionError("The other account is unavailable.");
  }
  const [current, other] = await Promise.all([
    profileForReview(state.userId, state),
    profileForReview(state.otherUserId, state),
  ]);
  return { current, id, kind: state.kind, other };
}

export async function callIsolatedAuth(
  path: string,
  body: unknown,
  cookie = "",
  reviewId?: string
) {
  const response = await fetch(`${getAuthBaseUrl()}/api/auth${path}`, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: authInternalHeaders({
      "content-type": "application/json",
      ...(reviewId ? { "x-asm-account-resolution": reviewId } : {}),
      ...(cookie ? { cookie } : {}),
    }),
    method: "POST",
    redirect: "manual",
  });
  const data: unknown = await response.json().catch(() => null);
  const temporaryToken = stringField(data, "token");
  if (temporaryToken) {
    await hybridSessionStore.delete(temporaryToken);
  }
  return { data, response };
}

function stringField(value: unknown, name: string): string | null {
  if (value && typeof value === "object" && name in value) {
    const field = Reflect.get(value, name);
    return typeof field === "string" ? field : null;
  }
  return null;
}

export async function verifyAccountForResolution(
  id: string,
  pending: Awaited<ReturnType<typeof loadAccountReview>>,
  side: "current" | "other",
  input: {
    password?: string;
    code?: string;
    method?: "totp" | "backup-code" | "otp" | "send-otp";
  }
) {
  const { state } = pending;
  const userId = side === "current" ? state.userId : state.otherUserId;
  if (!userId || state.attempts >= 20) {
    throw new AccountResolutionError(
      "Too many attempts. Start a new account review."
    );
  }
  const profile = await profileForReview(userId, state);
  if (!profile.emailVerified || !profile.hasPassword || !profile.email) {
    throw new AccountResolutionError(
      "Set up a verified email and password for this account first."
    );
  }
  const next = { ...state, attempts: state.attempts + 1 };
  if (!(await accountResolutionStore.update(id, pending.serialized, next))) {
    throw new AccountResolutionError("This review changed. Try again.");
  }
  const challenge = state.challenges[userId];
  const path = input.method
    ? `/two-factor/${input.method === "send-otp" ? "send-otp" : `verify-${input.method}`}`
    : "/sign-in/email";
  if (input.method && (!challenge || challenge.at < Date.now() - 300_000)) {
    throw new AccountResolutionError(
      "The two-factor challenge expired. Enter your password again."
    );
  }
  const limit = await consumeRateLimit({
    bucket: "account-resolution-proof",
    identifier: userId,
    limit: 10,
    windowSeconds: 300,
  });
  if (!limit.allowed) {
    throw new AccountResolutionError(
      "Too many attempts for this account. Wait a few minutes."
    );
  }
  const fingerprintBefore = await accountCredentialFingerprint(userId);
  const { response, data } = await callIsolatedAuth(
    path,
    input.method
      ? { code: input.code, trustDevice: false }
      : { email: profile.email, password: input.password, rememberMe: false },
    input.method ? challenge?.cookie : undefined,
    id
  );
  if (!response.ok) {
    throw new AccountResolutionError(
      "The password or verification code is incorrect. Try again."
    );
  }
  const latest = await accountResolutionStore.read(id);
  if (!latest || latest.state.attempts !== next.attempts) {
    throw new AccountResolutionError("This review changed. Try again.");
  }
  if (
    data &&
    typeof data === "object" &&
    "twoFactorRedirect" in data &&
    data.twoFactorRedirect === true
  ) {
    const cookie = response.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
    if (!cookie) {
      throw new AccountResolutionError(
        "Could not start two-factor verification."
      );
    }
    const updated = {
      ...latest.state,
      challenges: {
        ...latest.state.challenges,
        [userId]: { at: Date.now(), cookie },
      },
    };
    if (
      !(await accountResolutionStore.update(id, latest.serialized, updated))
    ) {
      throw new AccountResolutionError("This review changed. Try again.");
    }
    return { twoFactorRequired: true };
  }
  if (input.method === "send-otp") {
    return { sent: true, twoFactorRequired: true };
  }
  const token = stringField(data, "token");
  const returnedUser =
    data && typeof data === "object" && "user" in data
      ? stringField(data.user, "id")
      : null;
  // Never install this temporary login in the browser or leave it as a usable session.
  if (token) {
    await hybridSessionStore.delete(token);
  }
  if (!token || returnedUser !== userId) {
    throw new AccountResolutionError("The account could not be verified.");
  }
  const fingerprint = await accountCredentialFingerprint(userId);
  // Backup-code verification legitimately consumes a code, changing the 2FA fingerprint.
  if (
    !fingerprint ||
    (input.method !== "backup-code" && fingerprint !== fingerprintBefore)
  ) {
    throw new AccountResolutionError(
      "Sign-in details changed. Verify this account again."
    );
  }
  const updated = {
    ...latest.state,
    challenges: { ...latest.state.challenges },
    proofs: {
      ...latest.state.proofs,
      [userId]: { at: Date.now(), fingerprint },
    },
  };
  updated.challenges = Object.fromEntries(
    Object.entries(updated.challenges).filter(([key]) => key !== userId)
  );
  if (!(await accountResolutionStore.update(id, latest.serialized, updated))) {
    throw new AccountResolutionError("This review changed. Try again.");
  }
  return { verified: true };
}

export async function setupAccountForResolution(
  id: string,
  pending: Awaited<ReturnType<typeof loadAccountReview>>,
  side: "current" | "other",
  password?: string
) {
  const { state } = pending;
  const userId = side === "current" ? state.userId : state.otherUserId;
  const email = state.setupEmails[side];
  if (!userId || !email) {
    throw new AccountResolutionError(
      "Verify this account's recovery email first."
    );
  }
  if (password) {
    await assertPasswordNotPwned(password);
  }
  const hash = password ? await hashPasswordWithScrypt(password) : null;
  const next = { ...state, setupEmails: { ...state.setupEmails } };
  next.setupEmails = Object.fromEntries(
    Object.entries(next.setupEmails).filter(([key]) => key !== side)
  );
  await prisma.transaction(async (transaction) => {
    if (
      (await readAccountResolutionState(id, transaction)) !== pending.serialized
    ) {
      throw new AccountResolutionError(
        "This review changed. Refresh to continue."
      );
    }
    // A no-op update takes the same user lock as final resolution and serializes credential setup.
    await transaction.orm.public.Users.where({ id: userId }).updateAndCount({
      updatedAt: toPrismaDateTime(new Date()),
    });
    const user = await transaction.orm.public.Users.where({
      id: userId,
    }).first();
    if (
      !user ||
      user.banned ||
      (recoveryEmail(user.email) && user.email?.toLowerCase() !== email)
    ) {
      throw new AccountResolutionError("This account changed. Start again.");
    }
    const owner = await transaction.orm.public.Users.where((row) =>
      row.email.ilike(email.replaceAll(/[\\%_]/g, "\\$&"))
    ).first();
    if (owner && owner.id !== userId) {
      throw new AccountResolutionError(
        "This email is already used by another account."
      );
    }
    const credential = await transaction.orm.public.Accounts.where((row) =>
      and(
        row.userId.eq(userId),
        row.providerId.eq("credential"),
        row.accountId.eq(userId)
      )
    ).first();
    if (credential?.password && hash) {
      throw new AccountResolutionError(
        "This account already has a password. Verify it to continue."
      );
    }
    if (!credential?.password && !hash) {
      throw new AccountResolutionError("Choose a password for this account.");
    }
    if (hash) {
      await (credential
        ? transaction.orm.public.Accounts.where({
            id: credential.id,
          }).updateAndCount({ password: hash })
        : transaction.orm.public.Accounts.create({
            accountId: userId,
            issuer: "local:credential",
            password: hash,
            providerId: "credential",
            userId,
          }));
    }
    await transaction.orm.public.Users.where({ id: userId }).updateAndCount({
      email,
      emailVerified: true,
      emailVerifiedAt: toPrismaDateTime(new Date()),
      ...(hash ? { passwordHash: hash } : {}),
    });
    if (
      !(await updateAccountResolutionState(
        id,
        pending.serialized,
        JSON.stringify(next),
        transaction
      ))
    ) {
      throw new AccountResolutionError("This review expired. Start again.");
    }
  });
}

export async function finishAccountResolution(
  id: string,
  pending: Awaited<ReturnType<typeof loadAccountReview>>,
  input: { keepUserId: string; mode: "merge" | "discard"; confirmation: string }
) {
  const { state } = pending;
  const review = await getAccountReview(id, state);
  if (
    !review.current.verified ||
    !review.other.verified ||
    !state.otherUserId
  ) {
    throw new AccountResolutionError(
      "Verify both accounts with their passwords and two-factor codes before continuing."
    );
  }
  const result = await resolveAccountCollision({
    currentUserId: state.userId,
    expectedState: pending.serialized,
    fingerprints: Object.fromEntries(
      Object.entries(state.proofs).map(([userId, proof]) => [
        userId,
        proof.fingerprint,
      ])
    ),
    id,
    otherUserId: state.otherUserId,
    sessionId: state.sessionId,
    ...input,
    ...(state.provider && state.providerAccountId
      ? {
          provider: {
            accountId: state.providerAccountId,
            expectedOwner: state.providerOwnerId,
            id: state.provider,
          },
        }
      : {}),
  });
  await Promise.allSettled(
    [state.userId, state.otherUserId].map(async (userId) => {
      await hybridSessionStore.deleteByUserId(userId);
      await userCache.invalidateAllUserCaches(userId);
    })
  );
  return result;
}
