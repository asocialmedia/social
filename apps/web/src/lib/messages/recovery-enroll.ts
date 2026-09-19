import type { MessageIdentityPayload } from "./client";
import {
  deriveBackupKeyFromPrf,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  hashPrfOutput,
} from "./crypto";

// Builds the passkey-encrypted backup copy of the identity private key, shared
// by the messages provider and the settings recovery card so the two enrollment
// entry points cannot drift.
//
// The PRF output is passed in (rather than derived here) because obtaining it
// requires a user gesture through WebAuthn, which is the caller's concern. It
// is used only as KDF input and is never persisted: this function returns
// ciphertext and a verifier hash, both of which are safe on the server.
export async function buildPasskeyBackup(params: {
  identity: Pick<
    MessageIdentityPayload,
    | "encryptedPrivateKey"
    | "kdfIterations"
    | "masterKeyHash"
    | "publicKey"
    | "salt"
  >;
  privateKey: CryptoKey;
  prfOutput: Uint8Array<ArrayBuffer>;
}): Promise<{
  backupMethod: "passkey-prf";
  prfEncryptedPrivateKey: string;
  prfVerifier: string;
}> {
  const { identity, privateKey, prfOutput } = params;
  const saltBytes = Uint8Array.from(
    atob(identity.salt),
    (char) => char.codePointAt(0) ?? 0
  );
  const prfKey = await deriveBackupKeyFromPrf(
    prfOutput,
    saltBytes,
    identity.kdfIterations
  );
  const privateKeyJwk = await exportPrivateKeyJwk(privateKey);
  const backup = await encryptWithMasterKey(
    prfKey,
    JSON.stringify(privateKeyJwk)
  );
  return {
    backupMethod: "passkey-prf",
    prfEncryptedPrivateKey: `${backup.iv}.${backup.ciphertext}`,
    prfVerifier: await hashPrfOutput(prfOutput),
  };
}
