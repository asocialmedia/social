import { prisma } from "@asm/db";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  bytesToBase64Url,
  consumeChallenge,
  resolveRecoveryOrigin,
  resolveRecoveryRpId,
} from "@/lib/messages/recovery-webauthn";

// Verifies the attestation for a recovery credential and stores its public key.
// Only the public key, id, counter, and transports are persisted: the PRF
// output that actually derives the backup key is produced and consumed entirely
// in the browser and never crosses this boundary.
export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { response?: RegistrationResponseJSON } | null;
  try {
    body = (await request.json()) as { response?: RegistrationResponseJSON };
  } catch {
    body = null;
  }
  const response = body?.response;
  if (
    !response ||
    typeof response.id !== "string" ||
    response.id.length === 0
  ) {
    return Response.json(
      { error: "Invalid registration response" },
      { status: 400 }
    );
  }

  const expectedChallenge = await consumeChallenge(user.id, "register");
  if (!expectedChallenge) {
    return Response.json(
      { error: "Registration challenge expired, try again" },
      { status: 400 }
    );
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      expectedChallenge,
      expectedOrigin: resolveRecoveryOrigin(),
      expectedRPID: resolveRecoveryRpId(),
      requireUserVerification: true,
      response,
    });
  } catch (error) {
    console.error("Recovery credential verification failed:", error);
    return Response.json(
      { error: "Couldn't verify that passkey" },
      { status: 400 }
    );
  }

  if (!verification.verified) {
    return Response.json(
      { error: "Couldn't verify that passkey" },
      { status: 400 }
    );
  }

  const { credential } = verification.registrationInfo;
  // Upsert: re-enrolling replaces the previous credential. The client re-wraps
  // the backup under the new PRF output in the same flow, so the old credential
  // is no longer needed to recover.
  await prisma.messageRecoveryCredential.upsert({
    create: {
      counter: credential.counter,
      credentialId: credential.id,
      publicKey: bytesToBase64Url(credential.publicKey),
      transports: credential.transports?.join(",") ?? null,
      userId: user.id,
    },
    update: {
      counter: credential.counter,
      credentialId: credential.id,
      publicKey: bytesToBase64Url(credential.publicKey),
      transports: credential.transports?.join(",") ?? null,
    },
    where: { userId: user.id },
  });

  return Response.json({ ok: true });
}
