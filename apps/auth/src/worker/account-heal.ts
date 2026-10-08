import { prisma } from "@asm/db";

import { resolveLogger, withSpan } from "./log";
import type { WorkerLogger } from "./log";

// better-auth 1.7's canonical local-identity credential row. Sign-in resolves
// the credential account by (userId, providerId="credential", accountId=userId).
//
// Historical code paths wrote several divergent shapes for the same user:
//   - providerId="email",      issuer="email",            accountId=<email>
//   - providerId="credential", issuer="credential",       accountId=<email>
//   - providerId="credential", issuer="",                 accountId=<userId>
//   - providerId="credential", issuer="local:credential", accountId=<userId>
// The password-reset writer selected a credential row by (providerId, userId)
// with no accountId filter, so it could write the new password to one row while
// sign-in read another. Reset returned 200, the next login still 401'd.
//
// Which hash is current is decided by Users.passwordHash, not by a timestamp:
// Accounts.updatedAt is @default(now()) with no @updatedAt, so it is frozen at
// insert and cannot order writes. Every app-managed password path (signup and
// the reset router) writes Users.passwordHash in the same transaction as the
// account row, so it is the authoritative mirror of the user's current
// password. The healer converges the canonical row onto it.
export const CANONICAL_CREDENTIAL_ISSUER = "local:credential";

const PASSWORD_BEARING_PROVIDERS = ["credential", "email"] as const;

export interface AccountShape {
  accountId: string;
  id: string;
  issuer: string;
  password: string | null;
  providerId: string;
}

export interface HealDecision {
  action: "create" | "noop" | "update";
  /** Password to write onto the canonical row, when one should be adopted. */
  adoptPassword?: string;
  /** Where the adopted password came from, for logging. */
  adoptSource?: string;
  issuer?: string;
  reason: string;
}

function firstPassword(
  accounts: readonly AccountShape[]
): { source: string; value: string } | null {
  for (const account of accounts) {
    if (typeof account.password === "string" && account.password.length > 0) {
      return { source: `account:${account.id}`, value: account.password };
    }
  }
  return null;
}

// Pure decision logic so the convergence rules can be unit tested without a
// database.
export function planCredentialHeal(input: {
  accounts: readonly AccountShape[];
  userPasswordHash: string | null;
  userId: string;
}): HealDecision {
  const { accounts, userPasswordHash, userId } = input;
  const canonical = accounts.find(
    (account) =>
      account.providerId === "credential" && account.accountId === userId
  );

  // The authoritative password: Users.passwordHash when set (signup and reset
  // both write it), else the first password-bearing account row (a
  // better-auth-native write that only mirrored into the account).
  const source =
    typeof userPasswordHash === "string" && userPasswordHash.length > 0
      ? { source: "user:passwordHash", value: userPasswordHash }
      : firstPassword(accounts);

  if (!source) {
    // Pure OAuth account with no local password anywhere. Creating an empty
    // credential row would only surface "Password not found" instead of "no
    // credential account"; leave it for the user to set one via reset.
    return { action: "noop", reason: "no password-bearing source to adopt" };
  }

  if (!canonical) {
    return {
      action: "create",
      adoptPassword: source.value,
      adoptSource: source.source,
      issuer: CANONICAL_CREDENTIAL_ISSUER,
      reason: "no canonical credential row; creating one",
    };
  }

  const issuerDrifted = canonical.issuer !== CANONICAL_CREDENTIAL_ISSUER;
  const passwordDrifted =
    typeof canonical.password !== "string" ||
    canonical.password.length === 0 ||
    canonical.password !== source.value;

  if (!issuerDrifted && !passwordDrifted) {
    return {
      action: "noop",
      reason: "canonical credential row already carries the current password",
    };
  }

  return {
    action: "update",
    ...(passwordDrifted
      ? { adoptPassword: source.value, adoptSource: source.source }
      : {}),
    ...(issuerDrifted ? { issuer: CANONICAL_CREDENTIAL_ISSUER } : {}),
    reason: passwordDrifted
      ? "canonical credential row holds a stale password; adopting the current"
      : "canonical credential row carries a non-canonical issuer",
  };
}

export interface HealSummary {
  created: number;
  repaired: number;
  scanned: number;
  skipped: number;
}

interface AccountRow {
  accountId: string;
  id: string;
  issuer: string;
  password: string | null;
  providerId: string;
  userId: string;
}

function toShape(row: AccountRow): AccountShape {
  return {
    accountId: row.accountId,
    id: row.id,
    issuer: row.issuer,
    password: row.password,
    providerId: row.providerId,
  };
}

// Idempotent sweep. Safe to run on every boot and on a schedule: it only adds a
// missing canonical row or repairs its password/issuer, never deletes.
export async function healCredentialAccounts(
  logger?: WorkerLogger
): Promise<HealSummary> {
  const log = resolveLogger(logger);
  return await withSpan("job.heal-credential-accounts", async () => {
    const rows = (await prisma.orm.public.Accounts.select(
      "accountId",
      "id",
      "issuer",
      "password",
      "providerId",
      "userId"
    )
      .where((account) =>
        account.providerId.in([...PASSWORD_BEARING_PROVIDERS])
      )
      .all()) as AccountRow[];

    const byUser = new Map<string, AccountRow[]>();
    for (const row of rows) {
      const existing = byUser.get(row.userId);
      if (existing) {
        existing.push(row);
      } else {
        byUser.set(row.userId, [row]);
      }
    }

    // One query for every affected user's mirrored password, rather than a
    // read per user inside the sweep loop.
    const userIds = [...byUser.keys()];
    const userRows =
      userIds.length === 0
        ? []
        : await prisma.orm.public.Users.select("id", "passwordHash")
            .where((user) => user.id.in(userIds))
            .all();
    const passwordByUser = new Map(
      userRows.map((user) => [
        user.id,
        typeof user.passwordHash === "string" ? user.passwordHash : null,
      ])
    );

    // Build the full action list (pure) first, then run the independent writes
    // concurrently. Each write touches a distinct row, so there is no ordering
    // dependency between them.
    let skipped = 0;
    const operations: {
      apply: () => Promise<unknown>;
      decision: HealDecision;
      userId: string;
      kind: "create" | "repair";
    }[] = [];

    for (const [userId, accounts] of byUser) {
      if (!passwordByUser.has(userId)) {
        continue;
      }

      const decision = planCredentialHeal({
        accounts: accounts.map(toShape),
        userId,
        userPasswordHash: passwordByUser.get(userId) ?? null,
      });
      if (decision.action === "noop") {
        skipped += 1;
        continue;
      }

      const canonical = accounts.find(
        (account) =>
          account.providerId === "credential" && account.accountId === userId
      );

      if (decision.action === "create") {
        if (!decision.adoptPassword) {
          skipped += 1;
          continue;
        }
        operations.push({
          apply: () =>
            prisma.orm.public.Accounts.create({
              accountId: userId,
              issuer: decision.issuer ?? CANONICAL_CREDENTIAL_ISSUER,
              password: decision.adoptPassword,
              providerId: "credential",
              userId,
            }),
          decision,
          kind: "create",
          userId,
        });
        continue;
      }

      if (!canonical) {
        skipped += 1;
        continue;
      }
      const patch: { issuer?: string; password?: string } = {};
      if (decision.issuer && canonical.issuer !== decision.issuer) {
        patch.issuer = decision.issuer;
      }
      if (decision.adoptPassword) {
        patch.password = decision.adoptPassword;
      }
      if (Object.keys(patch).length === 0) {
        skipped += 1;
        continue;
      }
      operations.push({
        apply: () =>
          prisma.orm.public.Accounts.where({ id: canonical.id }).update(patch),
        decision,
        kind: "repair",
        userId,
      });
    }

    const results = await Promise.allSettled(
      operations.map((operation) => operation.apply())
    );

    let created = 0;
    let repaired = 0;
    for (const [index, result] of results.entries()) {
      const operation = operations[index];
      if (!operation) {
        continue;
      }
      if (result.status === "rejected") {
        log.error(
          {
            error: result.reason,
            kind: operation.kind,
            userId: operation.userId,
          },
          "credential account heal write failed"
        );
        continue;
      }
      if (operation.kind === "create") {
        created += 1;
      } else {
        repaired += 1;
      }
      log.info(
        {
          adoptedFrom: operation.decision.adoptSource,
          userId: operation.userId,
        },
        operation.kind === "create"
          ? "created canonical credential account"
          : "repaired canonical credential account"
      );
    }

    const summary = { created, repaired, scanned: byUser.size, skipped };
    log.info(summary, "credential account heal finished");
    return summary;
  });
}
