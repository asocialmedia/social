import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

// Status of the messages recovery credential for the signed-in user. The client
// uses this to decide whether to offer passkey recovery and whether to try it
// before falling back to the manual secret.
export async function GET() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const credential = await prisma.messageRecoveryCredential.findUnique({
    select: { createdAt: true, credentialId: true },
    where: { userId: user.id },
  });

  return Response.json({
    credential: credential
      ? {
          createdAt: credential.createdAt.toISOString(),
          credentialId: credential.credentialId,
        }
      : null,
  });
}

// Removes the recovery credential. The PRF-encrypted backup copy is kept: it is
// harmless ciphertext, and discarding it would destroy the ability to unlock
// with that credential if it is ever re-enrolled. The caller clears
// backupMethod back to manual-secret separately.
export async function DELETE() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.$transaction([
    prisma.messageRecoveryCredential.deleteMany({ where: { userId: user.id } }),
    prisma.messageIdentity.updateMany({
      data: { backupMethod: "manual-secret" },
      where: { userId: user.id },
    }),
  ]);

  return Response.json({ ok: true });
}
