# Migration history

Keep the migration operations, metadata, JSON contract snapshots, and refs intact. Deployments replay the hashed operations and read the JSON snapshots; these files preserve upgrades for existing databases.

Historical `contract.d.ts` snapshots are stored as lossless `contract.d.ts.gz` archives to reduce repository size. The declaration for the current `db` ref remains unpacked for authoring the next migration. Compression does not change the migration hashes or JSON contracts.

Before editing or re-emitting an older migration, restore its declaration dependencies from the repository root:

```sh
bun scripts/maintenance/restore-prisma-snapshot-types.ts
```

Restoration leaves existing declarations and JSON snapshots untouched. Restored historical declarations are ignored by Git. Normal application type checks exclude the migration directory.
