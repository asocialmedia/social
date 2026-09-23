import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  isUniqueConstraintViolation,
  parseJsonBody,
} from "@/lib/messages/server";

export interface MessageIdentityPayload {
  createdAt: string;
  encryptedPrivateKey: string;
  kdfIterations: number;
  masterKeyHash: string;
  publicKey: string;
  salt: string;
  updatedAt: string;
}

export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const identity = await prisma.messageIdentity.findUnique({
    where: { userId: user.id },
  });
  if (!identity || !identity.masterKeyHash) {
    return Response.json({ identity: null });
  }

  const payload: MessageIdentityPayload = {
    createdAt: identity.createdAt.toISOString(),
    encryptedPrivateKey: identity.encryptedPrivateKey,
    kdfIterations: identity.kdfIterations,
    masterKeyHash: identity.masterKeyHash,
    publicKey: identity.publicKey,
    salt: identity.salt,
    updatedAt: identity.updatedAt.toISOString(),
  };
  return Response.json({ identity: payload });
}

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  const body = parsed as {
    encryptedPrivateKey?: string;
    kdfIterations?: number;
    masterKeyHash?: string;
    publicKey?: string;
    salt?: string;
  } | null;

  if (
    body === null ||
    typeof body.publicKey !== "string" ||
    body.publicKey.length === 0 ||
    typeof body.encryptedPrivateKey !== "string" ||
    body.encryptedPrivateKey.length === 0 ||
    typeof body.masterKeyHash !== "string" ||
    body.masterKeyHash.length < 32 ||
    typeof body.salt !== "string" ||
    body.salt.length === 0 ||
    typeof body.kdfIterations !== "number" ||
    body.kdfIterations < 100_000 ||
    body.kdfIterations > 5_000_000
  ) {
    return Response.json(
      { error: "Invalid identity payload" },
      { status: 400 }
    );
  }

  try {
    // Create-only: an existing identity owns its public key. Re-provisioning
    // with a different keypair must never replace the stored one, which would
    // orphan every existing conversation key for it; a reset is the explicit
    // path for replacing a keypair.
    const existing = await prisma.messageIdentity.findUnique({
      select: { publicKey: true },
      where: { userId: user.id },
    });
    if (existing) {
      return Response.json(
        { error: "Identity already exists" },
        { status: 409 }
      );
    }

    await prisma.messageIdentity.create({
      data: {
        encryptedPrivateKey: body.encryptedPrivateKey,
        kdfIterations: body.kdfIterations,
        masterKeyHash: body.masterKeyHash,
        publicKey: body.publicKey,
        salt: body.salt,
        userId: user.id,
      },
    });

    return Response.json({ ok: true });
  } catch (error) {
    // Two tabs (or a retried POST) can pass the create-only check above
    // concurrently; the row's primary key then rejects the loser. Treat that as
    // the same conflict the pre-check returns, not a 500.
    if (isUniqueConstraintViolation(error)) {
      return Response.json(
        { error: "Identity already exists" },
        { status: 409 }
      );
    }
    console.error("Failed to save message identity:", error);
    return Response.json({ error: "Failed to save identity" }, { status: 500 });
  }
}

// Re-provisions a lost identity. This is the recovery path when a device can no
// longer read the stored backup: start a new keypair. The reset is strictly
// self-scoped:
//
//   - Only the caller's identity row is deleted (`where.userId = user.id`).
//   - Only the caller's own conversation-key wraps are deleted. The peer's wraps
//     are left untouched, so the other member keeps reading the full history.
//   - Messages are never touched. The caller's pre-reset history becomes
//     unreadable to them (the root keys its wraps held are gone), which the UI
//     discloses before confirming; the peer's copy is unaffected.
//
// The next bootstrap sees no identity and provisions a fresh one, and
// ensureConversationKeys rotates to a new epoch on the next send.
export async function DELETE() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [, keys] = await prisma.$transaction([
      prisma.messageIdentity.deleteMany({ where: { userId: user.id } }),
      // Both conditions are required: the owner filter keeps other members'
      // wraps, and the conversationId foreign key means a wrap without a live
      // conversation is already gone via cascade.
      prisma.messageConversationKey.deleteMany({
        where: { ownerUserId: user.id },
      }),
    ]);

    return Response.json({ ok: true, removedKeys: keys.count });
  } catch (error) {
    console.error("Failed to reset message identity:", error);
    return Response.json(
      { error: "Failed to reset identity" },
      { status: 500 }
    );
  }
}
