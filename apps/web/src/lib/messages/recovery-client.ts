"use client";

import {
  base64URLStringToBuffer,
  bufferToBase64URLString,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";

import {
  derivePrfSalt,
  extractPrfOutput,
  prfEnabled,
  webAuthnAvailable,
} from "./recovery-prf";

// Browser-side WebAuthn flow for the messages recovery credential.
//
// Written against the native `navigator.credentials` API rather than
// @simplewebauthn/browser's startRegistration/startAuthentication because those
// helpers do not forward the `extensions` field, and the PRF extension is the
// entire point of this credential. The library's base64url codecs are reused so
// the JSON handed to the server verify routes matches exactly what
// @simplewebauthn/server expects.

// Raised when the flow cannot proceed for a reason the user should see, as
// opposed to a programming error. `fallback` tells the caller to try the manual
// recovery secret instead of surfacing a hard failure.
export class RecoveryUnavailableError extends Error {
  readonly fallback: boolean;
  constructor(message: string, fallback = false) {
    super(message);
    this.fallback = fallback;
    this.name = "RecoveryUnavailableError";
  }
}

// @simplewebauthn v13 types transports with its own `AuthenticatorTransportFuture`
// (which includes newer values such as "cable") while the DOM lib still uses the
// narrower `AuthenticatorTransport`. The values are interoperable at runtime, so
// the conversion is contained in one cast rather than spread across the call
// sites.
function toCreationOptions(
  options: PublicKeyCredentialCreationOptionsJSON
): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64URLStringToBuffer(options.challenge),
    excludeCredentials: options.excludeCredentials?.map((descriptor) => ({
      ...descriptor,
      id: base64URLStringToBuffer(descriptor.id),
    })),
    // Request PRF with no eval at create time: an authenticator that supports
    // PRF reports `enabled`, and the actual bytes are obtained by a subsequent
    // get() call. Evaluating at create time has inconsistent support.
    extensions: { prf: {} },
    user: {
      ...options.user,
      id: base64URLStringToBuffer(options.user.id),
    },
  } as PublicKeyCredentialCreationOptions;
}

function toRequestOptions(
  options: PublicKeyCredentialRequestOptionsJSON,
  salt: Uint8Array<ArrayBuffer>
): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    allowCredentials: options.allowCredentials?.map((descriptor) => ({
      ...descriptor,
      id: base64URLStringToBuffer(descriptor.id),
    })),
    challenge: base64URLStringToBuffer(options.challenge),
    extensions: { prf: { eval: { first: salt } } },
  } as PublicKeyCredentialRequestOptions;
}

function serializeRegistration(
  credential: PublicKeyCredential
): RegistrationResponseJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    // Empty on purpose: the real extension results contain the PRF output,
    // which must never reach the server. Verification does not read this field.
    clientExtensionResults: {},
    id: credential.id,
    rawId: bufferToBase64URLString(credential.rawId),
    response: {
      attestationObject: bufferToBase64URLString(response.attestationObject),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      transports: response.getTransports?.() ?? [],
    } as RegistrationResponseJSON["response"],
    type: "public-key",
  };
}

function serializeAuthentication(
  credential: PublicKeyCredential
): AuthenticationResponseJSON {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    // Empty on purpose: see serializeRegistration.
    clientExtensionResults: {},
    id: credential.id,
    rawId: bufferToBase64URLString(credential.rawId),
    response: {
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      signature: bufferToBase64URLString(response.signature),
      userHandle: response.userHandle
        ? bufferToBase64URLString(response.userHandle)
        : undefined,
    },
    type: "public-key",
  };
}

async function postJson(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
    credentials: "same-origin",
    method: "POST",
  });
  if (!response.ok) {
    let message = "Request failed";
    try {
      const parsed = (await response.json()) as { error?: string };
      if (parsed.error) {
        message = parsed.error;
      }
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new RecoveryUnavailableError(message, true);
  }
  return response.json();
}

// Registers a recovery credential and returns the derived PRF output. The
// caller re-wraps the identity backup under it. Throws RecoveryUnavailableError
// with `fallback: true` when the platform cannot provide PRF, so the UI can
// tell the user their device is unsupported rather than failing silently.
export async function enrollRecoveryCredential(
  userId: string
): Promise<Uint8Array<ArrayBuffer>> {
  if (!webAuthnAvailable()) {
    throw new RecoveryUnavailableError(
      "This browser can't use passkey recovery",
      true
    );
  }

  const { options } = (await postJson(
    "/api/messages/recovery/register/options"
  )) as { options: PublicKeyCredentialCreationOptionsJSON };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: toCreationOptions(options),
    })) as PublicKeyCredential | null;
  } catch (error) {
    throw new RecoveryUnavailableError(
      error instanceof Error ? error.message : "Passkey setup was cancelled"
    );
  }
  if (!credential) {
    throw new RecoveryUnavailableError("Passkey setup was cancelled");
  }

  const results = credential.getClientExtensionResults();
  if (!prfEnabled(results)) {
    // Registration succeeded but the authenticator cannot do PRF. Do not store
    // the credential: it would be unusable for recovery and would shadow the
    // manual secret in the UI.
    throw new RecoveryUnavailableError(
      "That passkey can't encrypt your messages. Try a device passkey (Face ID, Touch ID, Windows Hello) or keep using the recovery secret.",
      true
    );
  }

  await postJson("/api/messages/recovery/register/verify", {
    response: serializeRegistration(credential),
  });

  // The create() call does not return PRF bytes, so obtain them with the
  // assertion call that will also be used on a new device. This doubles as a
  // check that the credential actually produces output before it is relied on.
  const firstSalt = await derivePrfSalt(userId);
  return await assertRecoveryPrf(firstSalt);
}

// Runs the assertion for the enrolled recovery credential and returns its PRF
// output. Used both immediately after enrollment and on a fresh device to
// recover the backup.
export async function recoverPrfOutput(
  userId: string
): Promise<Uint8Array<ArrayBuffer>> {
  return await assertRecoveryPrf(await derivePrfSalt(userId));
}

async function assertRecoveryPrf(
  salt: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  if (!webAuthnAvailable()) {
    throw new RecoveryUnavailableError(
      "This browser can't use passkey recovery",
      true
    );
  }

  const { options } = (await postJson(
    "/api/messages/recovery/authenticate/options"
  )) as { options: PublicKeyCredentialRequestOptionsJSON };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: toRequestOptions(options, salt),
    })) as PublicKeyCredential | null;
  } catch (error) {
    throw new RecoveryUnavailableError(
      error instanceof Error ? error.message : "Passkey prompt was cancelled"
    );
  }
  if (!credential) {
    throw new RecoveryUnavailableError("Passkey prompt was cancelled");
  }

  const output = extractPrfOutput(credential.getClientExtensionResults());
  if (!output) {
    throw new RecoveryUnavailableError(
      "That passkey didn't return a recovery key",
      true
    );
  }

  await postJson("/api/messages/recovery/authenticate/verify", {
    response: serializeAuthentication(credential),
  });

  return output;
}

// Removes the server-side recovery credential. The PRF-encrypted backup copy is
// left in place (harmless ciphertext, and re-enrolling the same credential
// could still read it).
export async function disableRecoveryCredential(): Promise<void> {
  const response = await fetch("/api/messages/recovery", {
    credentials: "same-origin",
    method: "DELETE",
  });
  if (!response.ok) {
    throw new RecoveryUnavailableError("Couldn't remove passkey recovery");
  }
}
