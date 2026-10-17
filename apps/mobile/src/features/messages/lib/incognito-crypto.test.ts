import { expect, test } from "bun:test";

import { deriveIncognitoRootKey } from "@asm/messages";
import { decryptMessage as decryptWebMessage } from "@asm/messages/crypto";

import { decryptMessage, encryptMessage } from "./crypto";
import { deriveNativeIncognitoRootKey } from "./incognito-crypto";

test("native incognito keys and ciphertext are compatible with web", async () => {
  const root = crypto.getRandomValues(new Uint8Array(32));
  const sessionId = crypto.randomUUID();
  const native = deriveNativeIncognitoRootKey(root, sessionId);
  const web = await deriveIncognitoRootKey(root, sessionId);
  expect(native).toEqual(web);
  const payload = { content: "Hello from incognito 🌙", type: "text" as const };
  const encrypted = await encryptMessage(
    native,
    "sender",
    3,
    sessionId,
    payload
  );
  expect(await decryptWebMessage(web, "sender", sessionId, encrypted)).toEqual(
    payload
  );
  expect(await decryptMessage(native, "sender", sessionId, encrypted)).toEqual(
    payload
  );
});
