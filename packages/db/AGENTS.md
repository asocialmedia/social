# Prisma 8 database package

This package uses Prisma 8, also called Prisma Next, not Prisma 7. Treat Prisma 8 as a contract-first ORM. Do not apply Prisma 7 assumptions such as `schema.prisma`, `@prisma/client`, `prisma migrate dev`, or `db push` to this package.

## Before changing anything

- Read `packages/db/.devin/skills/prisma-8/SKILL.md` and the matching Prisma 8 reference before editing code.
- Use `prisma.config.ts` as the source of truth for paths and target configuration.
- The authored contract is `prisma/contract.prisma`; emitted artifacts belong in `generated/prisma` and must not be edited by hand.
- After editing the contract, run `bun run db:gen` from the repository root. It syncs the installed Prisma 8 skills and emits the contract artifacts.
- Treat the installed `@prisma/orm-*` version and its generated skill metadata as authoritative. If the skill version does not match the installed package, run `prisma skills sync` and reread the skill.

## Migration essentials

- Use `prisma db update` only for a local, solo development database. Preview with `--dry-run`; it does not create a replayable migration package.
- Use `prisma contract emit`, then `prisma migration plan --name <snake_slug>` for shared, staging, or production changes.
- Review the generated package with `prisma migration show` and review the pending path with `prisma db migrate --show` before applying it.
- Apply reviewed migrations with `prisma db migrate`, then run `prisma db verify` when a standalone verification is needed.
- Never use `db push`, `db update`, or `prisma migrate dev` against production. Do not replace a reviewed migration with a schema push.
- Files under `prisma/migrations/app/<timestamp>_<slug>/migration.ts` are framework-rendered. Fill only the emitted data-transform placeholders using the start and end contracts, then self-emit the migration file. Never hand-edit `ops.json` or `migration.json`; they are content-addressed generated artifacts.
- Migration hashes, graph nodes, refs, and markers are part of the migration contract. Do not delete, rewrite, reorder, or bypass applied migration packages. Diagnose hash, drift, or graph errors from the current Prisma 8 docs and the repository's migration refs.
- `BackfillMarker` and `backfill_markers` are intentional compatibility state. Do not remove or rename them without an explicit migration decision.
- `prisma db sign` is for adopting or confirming an existing database after schema verification. It is not a replacement for applying reviewed production migrations.

## Runtime and query essentials

- Query the emitted contract through the Prisma 8 `db.orm` and `db.sql` surfaces. Do not import Prisma 7 client APIs.
- Keep server-only Prisma runtime dependencies out of browser bundles. Expose browser-safe helpers through an explicit package subpath.
- Preserve transaction behavior, generated contract artifacts, migration markers, and migration graph invariants when changing runtime code.
- After changes, run `bun run check`, `bun run check-types`, the relevant tests, and `bun run db:up` when a local database change is involved.

## Current documentation

Read the latest upstream Prisma 8 migration architecture documentation before changing the migration workflow:

https://github.com/prisma/orm/blob/main/docs/architecture%20docs/subsystems/7.%20Migration%20System.md
