import { readdir } from "node:fs/promises";
import path from "node:path";

export async function restorePrismaSnapshotTypes(
  snapshotsDirectory = path.resolve(
    import.meta.dir,
    "../../packages/db/prisma/migrations/snapshots"
  )
): Promise<number> {
  let restored = 0;
  for (const entry of await readdir(snapshotsDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const declarationPath = path.join(
      snapshotsDirectory,
      entry.name,
      "contract.d.ts"
    );
    const archive = Bun.file(`${declarationPath}.gz`);
    if (!(await archive.exists()) || (await Bun.file(declarationPath).exists()))
      continue;
    await Bun.write(declarationPath, Bun.gunzipSync(await archive.bytes()));
    restored += 1;
  }
  return restored;
}

if (import.meta.main) {
  console.log(
    `Restored ${await restorePrismaSnapshotTypes()} historical Prisma declaration snapshots.`
  );
}
