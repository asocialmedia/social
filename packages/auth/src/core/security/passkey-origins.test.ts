import { describe, expect, test } from "bun:test";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoCBOR } from "@simplewebauthn/server/helpers";

import {
  apkKeyHashFromFingerprint,
  buildPasskeyOrigins,
  parseAndroidApkKeyHashes,
} from "./passkey-origins";

// Release signing cert as published in apps/web/public/.well-known/assetlinks.json.
const RELEASE_FINGERPRINT =
  "88:C2:38:F8:B9:57:0F:17:92:28:70:FA:94:38:C3:78:03:09:4E:6C:A8:6D:36:BB:0B:DE:67:AC:63:F0:07:19";
const RELEASE_HASH = "iMI4-LlXDxeSKHD6lDjDeAMJTmyobTa7C95nrGPwBxk";

function signedAssertion(origin: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) {
    throw new Error("Missing credential coordinates");
  }
  const credentialPublicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ])
  );
  const id = randomBytes(16).toString("base64url");
  const challenge = randomBytes(32).toString("base64url");
  const clientData = Buffer.from(
    JSON.stringify({
      challenge,
      crossOrigin: false,
      origin,
      type: "webauthn.get",
    })
  );
  const authenticatorData = Buffer.concat([
    createHash("sha256").update("asocialmedia.cc").digest(),
    Buffer.from([5, 0, 0, 0, 1]),
  ]);
  const signature = sign(
    "sha256",
    Buffer.concat([
      authenticatorData,
      createHash("sha256").update(clientData).digest(),
    ]),
    privateKey
  );
  return {
    credential: { counter: 0, id, publicKey: credentialPublicKey },
    expectedChallenge: challenge,
    expectedOrigin: buildPasskeyOrigins("https://asocialmedia.cc"),
    expectedRPID: "asocialmedia.cc",
    response: {
      clientExtensionResults: {},
      id,
      rawId: id,
      response: {
        authenticatorData: authenticatorData.toString("base64url"),
        clientDataJSON: clientData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
      type: "public-key" as const,
    },
  };
}

describe("native passkey signature verification", () => {
  test("accepts native credential creation for the release app", async () => {
    const assertion = signedAssertion(`android:apk-key-hash:${RELEASE_HASH}`);
    const credentialId = Buffer.from(assertion.credential.id, "base64url");
    const credentialLength = Buffer.alloc(2);
    credentialLength.writeUInt16BE(credentialId.length);
    const authenticatorData = Buffer.concat([
      createHash("sha256").update("asocialmedia.cc").digest(),
      Buffer.from([69, 0, 0, 0, 0]),
      Buffer.alloc(16),
      credentialLength,
      credentialId,
      assertion.credential.publicKey,
    ]);
    const attestation = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, never>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", authenticatorData],
      ])
    );
    const clientData = Buffer.from(
      JSON.stringify({
        challenge: assertion.expectedChallenge,
        crossOrigin: false,
        origin: `android:apk-key-hash:${RELEASE_HASH}`,
        type: "webauthn.create",
      })
    );
    const result = await verifyRegistrationResponse({
      expectedChallenge: assertion.expectedChallenge,
      expectedOrigin: assertion.expectedOrigin,
      expectedRPID: assertion.expectedRPID,
      response: {
        clientExtensionResults: {},
        id: assertion.credential.id,
        rawId: assertion.credential.id,
        response: {
          attestationObject: Buffer.from(attestation).toString("base64url"),
          clientDataJSON: clientData.toString("base64url"),
          transports: ["internal"],
        },
        type: "public-key",
      },
    });
    expect(result.verified).toBe(true);
    expect(result.registrationInfo?.credential.id).toBe(
      assertion.credential.id
    );
  });

  test("verifies a signed assertion from the release app's Android origin", async () => {
    const result = await verifyAuthenticationResponse(
      signedAssertion(`android:apk-key-hash:${RELEASE_HASH}`)
    );
    expect(result.verified).toBe(true);
    expect(result.authenticationInfo.userVerified).toBe(true);
    expect(result.authenticationInfo.newCounter).toBe(1);
  });
  test("continues to verify browser credentials", async () => {
    const result = await verifyAuthenticationResponse(
      signedAssertion("https://asocialmedia.cc")
    );
    expect(result.verified).toBe(true);
  });
  test("rejects an assertion signed for another Android app", async () => {
    await expect(
      verifyAuthenticationResponse(
        signedAssertion("android:apk-key-hash:untrusted-app")
      )
    ).rejects.toThrow("origin");
  });
});

describe("apkKeyHashFromFingerprint", () => {
  test("encodes a keytool fingerprint as base64url", () => {
    expect(apkKeyHashFromFingerprint(RELEASE_FINGERPRINT)).toBe(RELEASE_HASH);
  });

  test("rejects anything that is not a SHA-256 fingerprint", () => {
    expect(() => apkKeyHashFromFingerprint("AA:BB")).toThrow();
  });
});

describe("parseAndroidApkKeyHashes", () => {
  test("accepts digests, fingerprints and full origins", () => {
    expect(
      parseAndroidApkKeyHashes(
        ` ${RELEASE_HASH}, ${RELEASE_FINGERPRINT} ,android:apk-key-hash:abc,,`
      )
    ).toEqual([
      `android:apk-key-hash:${RELEASE_HASH}`,
      `android:apk-key-hash:${RELEASE_HASH}`,
      "android:apk-key-hash:abc",
    ]);
  });

  test("is empty when unset", () => {
    expect(parseAndroidApkKeyHashes()).toEqual([]);
    expect(parseAndroidApkKeyHashes("")).toEqual([]);
  });
});

describe("buildPasskeyOrigins", () => {
  test("accepts the published native release certificate without optional environment configuration", () => {
    expect(buildPasskeyOrigins("https://asocialmedia.cc")).toEqual([
      "https://asocialmedia.cc",
      `android:apk-key-hash:${RELEASE_HASH}`,
    ]);
    expect(buildPasskeyOrigins("https://another.example")).toEqual([
      "https://another.example",
    ]);
  });

  test("deduplicates the default certificate while retaining explicitly configured certificates", () => {
    expect(
      buildPasskeyOrigins(
        "https://asocialmedia.cc",
        `${RELEASE_FINGERPRINT},android:apk-key-hash:another-certificate`
      )
    ).toEqual([
      "https://asocialmedia.cc",
      `android:apk-key-hash:${RELEASE_HASH}`,
      "android:apk-key-hash:another-certificate",
    ]);
  });

  test("keeps the web origin first", () => {
    expect(
      buildPasskeyOrigins("https://asocialmedia.cc", RELEASE_HASH)
    ).toEqual([
      "https://asocialmedia.cc",
      `android:apk-key-hash:${RELEASE_HASH}`,
    ]);
    expect(buildPasskeyOrigins("http://localhost:3000")).toEqual([
      "http://localhost:3000",
    ]);
  });
});
