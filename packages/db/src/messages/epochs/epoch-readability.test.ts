import { describe, expect, mock, test } from "bun:test";

import type { PrismaTransaction } from "../../prisma";
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
    const execute = mock((_plan: Parameters<PrismaTransaction["execute"]>[0]) =>
      Promise.resolve({ affectedRows: 0 })
    );
    const transaction = { execute };
    const proofs = Array.from({ length: 1101 }, (_, index) => ({
      readable: true,
      recoveryGeneration: 2,
      sourceFingerprint: messageSearchEpochFingerprint(source),
      wrapId: `wrap-${index}`,
    }));
    await persistMessageSearchEpochProofs(transaction, "conversation", [
      ...proofs,
      proofs[0],
    ]);
    expect(execute).toHaveBeenCalledTimes(12);
    for (const call of execute.mock.calls) {
      const [plan] = call;
      const values = plan.ast
        ?.collectParamRefs()
        .map((reference) =>
          "value" in reference ? reference.value : undefined
        );
      if (!Array.isArray(values) || typeof values[0] !== "string") {
        throw new TypeError("Expected serialized proof batch");
      }
      const batch: unknown = JSON.parse(values[0]);
      expect(Array.isArray(batch)).toBe(true);
      if (Array.isArray(batch)) {
        expect(batch.length).toBeLessThanOrEqual(100);
      }
    }
  });

  test("rejects invalid proofs before making any database write", async () => {
    const execute = mock((_plan: Parameters<PrismaTransaction["execute"]>[0]) =>
      Promise.resolve({ affectedRows: 0 })
    );
    const transaction = { execute };
    await expect(
      persistMessageSearchEpochProofs(transaction, "conversation", [
        {
          readable: true,
          recoveryGeneration: -1,
          sourceFingerprint: "invalid",
          wrapId: "wrap",
        },
      ])
    ).rejects.toThrow("Invalid message key epoch proof");
    expect(execute).not.toHaveBeenCalled();
  });
});
