// oxlint-disable-next-line typescript/triple-slash-reference -- Standalone deployment bundles import SQL as text.
/// <reference path="../../packages/db/sql.d.ts" />
import { Client } from "pg";

import markerSql from "../../docker/prisma-marker.sql" with { type: "text" };

export const LEGACY_PRISMA_CHECKPOINT =
  "5250d26200dc4cdf6845809e9519810e8c329a6c3dc48725e0f1d897034551f0";
export const CANONICAL_PRISMA_CHECKPOINT =
  "d1e4b3353eba935e395ef107d463a1f8a0924657f3e1f7ef98743232e8f0c158";

export async function readPrismaCheckpoint(
  query: () => Promise<{ rows: { storageHash: string }[] }>
): Promise<string | null> {
  try {
    const result = await query();
    return result.rows[0]?.storageHash ?? null;
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
    )
      return null;
    throw error;
  }
}

export async function upgradeLegacyPrismaCheckpoint(dependencies: {
  readMarker: () => Promise<string | null>;
  signVerifiedCheckpoint: (hash: string) => Promise<void>;
}): Promise<boolean> {
  if ((await dependencies.readMarker()) !== LEGACY_PRISMA_CHECKPOINT)
    return false;
  await dependencies.signVerifiedCheckpoint(CANONICAL_PRISMA_CHECKPOINT);
  return true;
}

if (import.meta.main) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const upgraded = await upgradeLegacyPrismaCheckpoint({
      readMarker: () =>
        readPrismaCheckpoint(() =>
          client.query<{ storageHash: string }>(markerSql, ["app"])
        ),
      signVerifiedCheckpoint: async (hash) => {
        const child = Bun.spawn(
          [
            process.execPath,
            "x",
            "prisma",
            "db",
            "sign",
            "--contract",
            hash,
            "--no-advance-ref",
          ],
          {
            stdout: "inherit",
            stderr: "inherit",
          }
        );
        if ((await child.exited) !== 0)
          throw new Error(
            "Legacy checkpoint schema verification failed; refusing to migrate"
          );
      },
    });
    if (upgraded)
      console.log(
        "Verified legacy Prisma serialization checkpoint normalized; pending migrations still apply normally."
      );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
