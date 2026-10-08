import { describe, expect, test } from "bun:test";

import {
  decryptMessage,
  decryptWithMasterKey,
  deriveMasterKey,
  encryptMessage,
  encryptWithMasterKey,
  exportPrivateKeyJwk,
  generateAccountSecret,
  generateIdentityKeyPair,
  generateRootKey,
  hashAccountSecret,
  importPrivateKeyJwk,
  wrapRootKey,
  unwrapRootKey,
} from "./crypto";

describe("shared message crypto", () => {
  test("preserves stored-row identity recovery and the existing message wire format", async () => {
    const sender = await generateIdentityKeyPair();
    const recipient = await generateIdentityKeyPair();
    const conversationId = "shared-crypto-fixture";
    const root = generateRootKey();
    const wrapped = await wrapRootKey(
      sender.privateKey,
      recipient.publicKey,
      conversationId,
      root
    );
    const recoveredRoot = await unwrapRootKey(
      recipient.privateKey,
      sender.publicKey,
      conversationId,
      wrapped
    );
    const payload = { content: "readable after reload", type: "text" as const };
    const encrypted = await encryptMessage(
      recoveredRoot,
      "sender",
      7,
      conversationId,
      payload
    );

    expect(
      await decryptMessage(root, "sender", conversationId, encrypted)
    ).toEqual(payload);

    const secret = generateAccountSecret();
    const hash = await hashAccountSecret(secret);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const masterKey = await deriveMasterKey(hash, salt);
    const backup = await encryptWithMasterKey(
      masterKey,
      JSON.stringify(await exportPrivateKeyJwk(sender.privateKey))
    );
    const recoveredMasterKey = await deriveMasterKey(hash, salt);
    const recoveredPrivateKey = await importPrivateKeyJwk(
      JSON.parse(await decryptWithMasterKey(recoveredMasterKey, backup))
    );

    const recovered = await unwrapRootKey(
      recoveredPrivateKey,
      recipient.publicKey,
      conversationId,
      wrapped
    );
    expect([...recovered]).toEqual([...root]);
  });

  test("rejects ciphertext under another conversation or ratchet index", async () => {
    const root = generateRootKey();
    const encrypted = await encryptMessage(root, "sender", 3, "thread-a", {
      content: "private payload",
      type: "text",
    });

    await expect(
      decryptMessage(root, "sender", "thread-b", encrypted)
    ).rejects.toThrow();
    await expect(
      decryptMessage(root, "sender", "thread-a", {
        ...encrypted,
        ratchetIndex: 4,
      })
    ).rejects.toThrow();
  });
});
