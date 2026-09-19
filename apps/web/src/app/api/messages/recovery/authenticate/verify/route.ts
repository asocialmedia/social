import { prisma } from "@asm/db";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  base64UrlToBytes,
  consumeChallenge,
  resolveRecoveryOrigin,
  resolveRecoveryRpId,
} from "@/lib/messages/recovery-webauthn";

// Verifies an assertion from the recovery credential and advances its counter.
//
// The counter is the one piece of replay defence WebAuthn offers for a
// credential like this: a signature captured on the wire must not be reusable
// later. A `newCounter` that did not increase is rejected by the library unless
// the authenticator reports zero (a multi-device credential may not implement a
// counter at all), which is why the stored value is persisted verbatim rather
// than incremented locally.
export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { response?: AuthenticationResponseJSON } | null;
  try {
    body = (await request.json()) as { response?: AuthenticationResponseJSON };
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
      { error: "Invalid assertion response" },
      { status: 400 }
    );
  }

  const stored = await prisma.messageRecoveryCredential.findUnique({
    where: { userId: user.id },
  });
  if (!stored) {
    return Response.json(
      { error: "No recovery passkey is enrolled" },
      { status: 404 }
    );
  }
  // The assertion must be for the credential we enrolled for this user, never
  // an arbitrary credential id supplied by the caller.
  if (response.id !== stored.credentialId) {
    return Response.json({ error: "Unknown credential" }, { status: 400 });
  }

  const expectedChallenge = await consumeChallenge(user.id, "authenticate");
  if (!expectedChallenge) {
    return Response.json(
      { error: "Unlock challenge expired, try again" },
      { status: 400 }
    );
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      credential: {
        counter: stored.counter,
        id: stored.credentialId,
        publicKey: base64UrlToBytes(stored.publicKey),
        ...(stored.transports
          ? {
              transports: stored.transports.split(
                ","
              ) as AuthenticatorTransport[],
            }
          : {}),
      },
      expectedChallenge,
      expectedOrigin: resolveRecoveryOrigin(),
      expectedRPID: resolveRecoveryRpId(),
      requireUserVerification: true,
      response,
    });
  } catch (error) {
    console.error("Recovery assertion verification failed:", error);
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

  await prisma.messageRecoveryCredential.update({
    data: { counter: verification.authenticationInfo.newCounter },
    where: { userId: user.id },
  });

  return Response.json({ ok: true });
}
