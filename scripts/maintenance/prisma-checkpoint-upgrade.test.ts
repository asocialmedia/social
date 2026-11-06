import { expect, mock, test } from "bun:test";

import {
  CANONICAL_PRISMA_CHECKPOINT,
  LEGACY_PRISMA_CHECKPOINT,
  upgradeLegacyPrismaCheckpoint,
} from "./prisma-checkpoint-upgrade";

function normalizeStorage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStorage);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "storageHash" && key !== "nativeType")
      .map(([key, child]) => [key, normalizeStorage(child)])
  );
  if (typeof record.nativeType === "string") {
    const parameters = record.typeParams;
    const enumName =
      parameters && typeof parameters === "object" && "typeName" in parameters
        ? parameters.typeName
        : null;
    normalized.dataType =
      record.nativeType === enumName ? "pg/enum" : `pg/${record.nativeType}`;
  }
  if (normalized.many === true) normalized.many = { elementNullable: false };
  return normalized;
}

test("the legacy production marker and canonical checkpoint describe the same storage schema", async () => {
  const legacy = await Bun.file(
    new URL(
      "../../packages/db/prisma/legacy-checkpoints/5250d262.contract.json",
      import.meta.url
    )
  ).json();
  const canonical = await Bun.file(
    new URL(
      `../../packages/db/prisma/migrations/snapshots/${CANONICAL_PRISMA_CHECKPOINT}/contract.json`,
      import.meta.url
    )
  ).json();
  expect(legacy.storage.storageHash).toBe(LEGACY_PRISMA_CHECKPOINT);
  expect(canonical.storage.storageHash).toBe(CANONICAL_PRISMA_CHECKPOINT);
  expect(normalizeStorage(legacy.storage)).toEqual(
    normalizeStorage(canonical.storage)
  );
});

test.each([null, CANONICAL_PRISMA_CHECKPOINT, "unknown-checkpoint"])(
  "does not adopt an unrelated or already normalized marker: %s",
  async (marker) => {
    const signVerifiedCheckpoint = mock(() => Promise.resolve());
    expect(
      await upgradeLegacyPrismaCheckpoint({
        readMarker: () => Promise.resolve(marker),
        signVerifiedCheckpoint,
      })
    ).toBe(false);
    expect(signVerifiedCheckpoint).not.toHaveBeenCalled();
  }
);

test("normalization signs only the verified equivalent checkpoint, never the pending head", async () => {
  const signVerifiedCheckpoint = mock(() => Promise.resolve());
  expect(
    await upgradeLegacyPrismaCheckpoint({
      readMarker: () => Promise.resolve(LEGACY_PRISMA_CHECKPOINT),
      signVerifiedCheckpoint,
    })
  ).toBe(true);
  expect(signVerifiedCheckpoint).toHaveBeenCalledTimes(1);
  expect(signVerifiedCheckpoint).toHaveBeenCalledWith(
    CANONICAL_PRISMA_CHECKPOINT
  );
});

test("failed schema verification stops normalization and the following migration", async () => {
  await expect(
    upgradeLegacyPrismaCheckpoint({
      readMarker: () => Promise.resolve(LEGACY_PRISMA_CHECKPOINT),
      signVerifiedCheckpoint: () =>
        Promise.reject(new Error("schema verification failed")),
    })
  ).rejects.toThrow("schema verification failed");
});
