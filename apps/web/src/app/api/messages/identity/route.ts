import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/session";

export const dynamic = "force-dynamic";

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

  const body = (await request.json()) as {
    encryptedPrivateKey?: string;
    kdfIterations?: number;
    masterKeyHash?: string;
    publicKey?: string;
    salt?: string;
  };

  if (
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
    await prisma.messageIdentity.upsert({
      create: {
        encryptedPrivateKey: body.encryptedPrivateKey,
        kdfIterations: body.kdfIterations,
        masterKeyHash: body.masterKeyHash,
        publicKey: body.publicKey,
        salt: body.salt,
        userId: user.id,
      },
      update: {
        encryptedPrivateKey: body.encryptedPrivateKey,
        kdfIterations: body.kdfIterations,
        masterKeyHash: body.masterKeyHash,
        publicKey: body.publicKey,
        salt: body.salt,
      },
      where: { userId: user.id },
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to save message identity:", error);
    return Response.json({ error: "Failed to save identity" }, { status: 500 });
  }
}
