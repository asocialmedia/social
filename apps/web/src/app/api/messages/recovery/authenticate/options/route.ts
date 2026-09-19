import { prisma } from "@asm/db";
import { generateAuthenticationOptions } from "@simplewebauthn/server";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  resolveRecoveryRpId,
  storeChallenge,
} from "@/lib/messages/recovery-webauthn";

// Assertion options for the recovery credential. `allowCredentials` is scoped
// to the signed-in user's own credential, so this route cannot be used to
// enumerate or invoke anyone else's authenticator.
export async function POST() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stored = await prisma.messageRecoveryCredential.findUnique({
    select: { credentialId: true, transports: true },
    where: { userId: user.id },
  });
  if (!stored) {
    return Response.json(
      { error: "No recovery passkey is enrolled" },
      { status: 404 }
    );
  }

  const options = await generateAuthenticationOptions({
    allowCredentials: [
      {
        id: stored.credentialId,
        ...(stored.transports
          ? {
              transports: stored.transports.split(
                ","
              ) as AuthenticatorTransport[],
            }
          : {}),
      },
    ],
    rpID: resolveRecoveryRpId(),
    userVerification: "required",
  });

  await storeChallenge(user.id, "authenticate", options.challenge);

  return Response.json({ options });
}
