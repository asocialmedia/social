import {
  assertPasswordNotPwned,
  hashPasswordWithScrypt,
  PasswordSafetyError,
} from "@asm/auth/core";
import { prisma } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(256, "Password must be at most 256 characters"),
  })
  .strict();

const LOCAL_CREDENTIAL_ISSUER = "local:credential";

class PasswordAlreadySetError extends Error {
  constructor() {
    super("A password is already set for this account");
    this.name = "PasswordAlreadySetError";
  }
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

// OAuth-only accounts can add a credential login method after proving that
// they control a verified recovery email. The account row shape exactly matches
// Better Auth 1.7's local credential contract.
export async function POST(request: Request): Promise<Response> {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => {
    /* empty */
  });
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid password" },
      { status: 400 }
    );
  }

  const currentUser = await prisma.user.findUnique({
    select: { email: true, emailVerified: true },
    where: { id: session.user.id },
  });
  if (!currentUser?.email || !currentUser.emailVerified) {
    return Response.json(
      {
        error:
          "Verify an email address before adding a password to this account",
      },
      { status: 400 }
    );
  }

  try {
    await assertPasswordNotPwned(parsed.data.password);
    const passwordHash = await hashPasswordWithScrypt(parsed.data.password);

    await prisma.$transaction(async (transaction) => {
      const freshUser = await transaction.user.findUnique({
        select: { email: true, emailVerified: true },
        where: { id: session.user.id },
      });
      if (!freshUser?.email || !freshUser.emailVerified) {
        throw new Error("Email verification is required");
      }

      const credential = await transaction.account.findFirst({
        select: { id: true, password: true },
        where: {
          providerId: "credential",
          userId: session.user.id,
        },
      });
      if (credential?.password) {
        throw new PasswordAlreadySetError();
      }

      await (credential
        ? transaction.account.update({
            data: { password: passwordHash },
            where: { id: credential.id },
          })
        : transaction.account.create({
            data: {
              accountId: session.user.id,
              issuer: LOCAL_CREDENTIAL_ISSUER,
              password: passwordHash,
              providerId: "credential",
              userId: session.user.id,
            },
          }));

      // Keep the legacy user column consistent while Better Auth authenticates
      // against the credential account row.
      await transaction.user.update({
        data: { passwordHash },
        where: { id: session.user.id },
      });
    });
  } catch (error) {
    if (error instanceof PasswordSafetyError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof PasswordAlreadySetError || isUniqueConflict(error)) {
      return Response.json(
        { error: "A password is already set for this account" },
        { status: 409 }
      );
    }
    return Response.json(
      { error: "Couldn't add a password. Please try again." },
      { status: 500 }
    );
  }

  return Response.json({ success: true });
}
