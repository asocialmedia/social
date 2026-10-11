import { describe, expect, mock, test } from "bun:test";

import {
  messageSearchEpochFingerprint,
  persistMessageSearchEpochProofs,
} from "./epoch-readability";

const source = {
  identity: {
    encryptedPrivateKey: "encrypted-backup",
    kdfIterations: 210_000,
    masterKeyHash: "a".repeat(64),
    publicKey: "owner-public",
    salt: "identity-salt",
  },
  resolvedWrapperPublicKey: "wrapper-public",
  wrap: {
    encryptedKey: "wrapped-root",
    iv: "wrap-iv",
    wrapperPublicKey: "wrapper-public",
    wrapperUserId: "wrapper",
  },
};

describe("message epoch proof storage", () => {
  test("fingerprints every cryptographic source field and resolved legacy wrapper", () => {
    const expected = messageSearchEpochFingerprint(source);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
    for (const field of [
      "encryptedPrivateKey",
      "masterKeyHash",
      "publicKey",
      "salt",
    ] as const) {
      expect(
        messageSearchEpochFingerprint({
          ...source,
          identity: { ...source.identity, [field]: "changed" },
        })
      ).not.toBe(expected);
    }
    for (const field of [
      "encryptedKey",
      "iv",
      "wrapperPublicKey",
      "wrapperUserId",
    ] as const) {
      expect(
        messageSearchEpochFingerprint({
          ...source,
          wrap: { ...source.wrap, [field]: "changed" },
        })
      ).not.toBe(expected);
    }
    expect(
      messageSearchEpochFingerprint({
        ...source,
        identity: { ...source.identity, kdfIterations: 210_001 },
      })
    ).not.toBe(expected);
    expect(
      messageSearchEpochFingerprint({
        ...source,
        resolvedWrapperPublicKey: "different-wrapper",
      })
    ).not.toBe(expected);
    expect(
      messageSearchEpochFingerprint({
        ...source,
        resolvedWrapperPublicKey: null,
      })
    ).not.toBe(
      messageSearchEpochFingerprint({ ...source, resolvedWrapperPublicKey: "" })
    );
  });

  test("deduplicates proofs and bounds each write without limiting epoch history", async () => {
    const query = mock((_statement: string, _values: string[]) =>
      Promise.resolve()
    );
    const client = { query };
    const proofs = Array.from({ length: 1101 }, (_, index) => ({
      readable: true,
      recoveryGeneration: 2,
      sourceFingerprint: messageSearchEpochFingerprint(source),
      wrapId: `wrap-${index}`,
    }));
    await persistMessageSearchEpochProofs(client, "conversation", [
      ...proofs,
      proofs[0],
    ]);
    expect(query).toHaveBeenCalledTimes(12);
    for (const call of query.mock.calls) {
      const [, values] = call;
      if (!Array.isArray(values) || typeof values[1] !== "string") {
        throw new TypeError("Expected serialized proof batch");
      }
      const batch: unknown = JSON.parse(values[1]);
      expect(Array.isArray(batch)).toBe(true);
      if (Array.isArray(batch)) {
        expect(batch.length).toBeLessThanOrEqual(100);
      }
    }
  });

  test("rejects invalid proofs before making any database write", async () => {
    const query = mock((_statement: string, _values: string[]) =>
      Promise.resolve()
    );
    const client = { query };
    await expect(
      persistMessageSearchEpochProofs(client, "conversation", [
        {
          readable: true,
          recoveryGeneration: -1,
          sourceFingerprint: "invalid",
          wrapId: "wrap",
        },
      ])
    ).rejects.toThrow("Invalid message key epoch proof");
    expect(query).not.toHaveBeenCalled();
  });
});
