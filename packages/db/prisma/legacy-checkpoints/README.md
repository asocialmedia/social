# Legacy Prisma checkpoint normalization

Production checkpoint `5250d26200dc4cdf6845809e9519810e8c329a6c3dc48725e0f1d897034551f0` predates the Prisma contract serialization update. The immutable fixture comes from repository history before migration consolidation (`9c98ab02^`).

Its storage schema equals canonical checkpoint `d1e4b3353eba935e395ef107d463a1f8a0924657f3e1f7ef98743232e8f0c158`: native type names became data-type identifiers, and array cardinality gained explicit element nullability. The checkpoint test compares every storage entry after those representation changes.

The deployment upgrade recognizes only that legacy marker. Prisma's schema-verifying `db sign --contract <canonical> --no-advance-ref` must succeed before normal reviewed migrations run. It never signs the current application head or replaces pending DDL with a signature. Unknown checkpoints retain the normal migration failure behavior.

Keep this frozen fixture outside the migration graph; current Prisma cannot deserialize its obsolete contract format as a migration predecessor.
