import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../prisma/migrations");
interface Edge {
  from: string | null;
  to: string;
}
interface Snapshot {
  storage: { storageHash: string };
}
async function readSnapshot(file: string): Promise<Snapshot> {
  return JSON.parse(await readFile(file, "utf-8")) as Snapshot;
}

test("the retained migration chain and refs reach the current contract with complete snapshots", async () => {
  const folders = await readdir(path.join(root, "app"), {
    withFileTypes: true,
  });
  const edges = await Promise.all(
    folders
      .filter((folder) => folder.isDirectory() && folder.name !== "refs")
      .map(
        async (folder) =>
          JSON.parse(
            await readFile(
              path.join(root, "app", folder.name, "migration.json"),
              "utf-8"
            )
          ) as Edge
      )
  );
  const referenced = new Set(
    edges
      .flatMap((edge) => [edge.from, edge.to])
      .filter((hash): hash is string => hash !== null)
  );
  await Promise.all(
    [...referenced].map(async (hash) => {
      const snapshot = await readSnapshot(
        path.join(root, "snapshots", hash, "contract.json")
      );
      expect(snapshot.storage.storageHash).toBe(hash);
    })
  );
  const contract = await readSnapshot(
    path.resolve(root, "../../generated/prisma/contract.json")
  );
  const refFiles = await readdir(path.join(root, "app/refs"));
  const refs = await Promise.all(
    refFiles.map(
      async (file) =>
        JSON.parse(
          await readFile(path.join(root, "app/refs", file), "utf-8")
        ) as { hash: string }
    )
  );
  for (const ref of refs) {
    expect(edges.some((edge) => edge.to === ref.hash)).toBe(true);
  }
  for (const origin of [null, ...refs.map((ref) => ref.hash)]) {
    const reached = new Set<string | null>([origin]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        if (reached.has(edge.from) && !reached.has(edge.to)) {
          reached.add(edge.to);
          changed = true;
        }
      }
    }
    expect(reached.has(contract.storage.storageHash)).toBe(true);
  }
  for (const snapshot of await readdir(path.join(root, "snapshots"))) {
    expect(referenced.has(snapshot)).toBe(true);
  }
});
