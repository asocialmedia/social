import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { restorePrismaSnapshotTypes } from "./restore-prisma-snapshot-types";

test("restores compressed declaration snapshots without overwriting existing files or JSON", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "asm-snapshot-types-"));
  try {
    const snapshot = path.join(directory, "checkpoint");
    await mkdir(snapshot);
    await writeFile(path.join(snapshot, "contract.json"), '{"immutable":true}');
    const declaration = "export interface Contract { readonly version: 1 }\n";
    await Bun.write(
      path.join(snapshot, "contract.d.ts.gz"),
      Bun.gzipSync(declaration)
    );
    expect(await restorePrismaSnapshotTypes(directory)).toBe(1);
    expect(await readFile(path.join(snapshot, "contract.d.ts"), "utf8")).toBe(
      declaration
    );
    await writeFile(
      path.join(snapshot, "contract.d.ts"),
      "existing local declaration"
    );
    expect(await restorePrismaSnapshotTypes(directory)).toBe(0);
    expect(await readFile(path.join(snapshot, "contract.d.ts"), "utf8")).toBe(
      "existing local declaration"
    );
    expect(await readFile(path.join(snapshot, "contract.json"), "utf8")).toBe(
      '{"immutable":true}'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
