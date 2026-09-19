import { prisma } from "@asm/db";
import { generateRegistrationOptions } from "@simplewebauthn/server";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  RECOVERY_RP_NAME,
  resolveRecoveryRpId,
  storeChallenge,
} from "@/lib/messages/recovery-webauthn";

// Builds the WebAuthn registration options for a messages recovery credential.
//
// The PRF extension is deliberately absent here: it is applied by the browser
// itself (the client adds `extensions.prf` before calling create), and its
// output never reaches the server. This route only supplies the challenge and
// the relying-party identity.
export async function POST() {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A resident (discoverable) credential with user verification: the PRF output
  // is the backup key, so it should require the same gesture as unlocking the
  // device. Excluding the existing credential avoids silently creating a second
  // one that the stored public key would not match.
  const existing = await prisma.messageRecoveryCredential.findUnique({
    select: { credentialId: true, transports: true },
    where: { userId: user.id },
  });

  const options = await generateRegistrationOptions({
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: existing
      ? [
          {
            id: existing.credentialId,
            ...(existing.transports
              ? {
                  transports: existing.transports.split(
                    ","
                  ) as AuthenticatorTransport[],
                }
              : {}),
          },
        ]
      : [],
    rpID: resolveRecoveryRpId(),
    rpName: RECOVERY_RP_NAME,
    userID: new TextEncoder().encode(user.id),
    userName: user.email ?? user.id,
  });

  await storeChallenge(user.id, "register", options.challenge);

  return Response.json({ options });
}
