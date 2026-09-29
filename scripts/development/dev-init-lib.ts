// Pure decision logic for the dev database bootstrap.
//
// Every function here is side-effect free so the "should I run this?" rules can
// be unit tested without Docker, a database, or the Prisma CLI. The script that
// acts on these answers lives in dev-init.ts.
//
// Why any of this exists: `docker:dev` used to run the `init` compose profile
// (CREATE EXTENSION) plus `prisma skills sync`, `prisma contract emit` and
// `prisma db update` on every single invocation, including the common case where
// the database volume already exists and nothing changed. The Postgres volume
// persists across restarts, so all four steps were no-ops that still cost real
// wall-clock time. `.dev-init` records what was applied so a repeat start can
// skip straight to "ready".

import { createHash } from "node:crypto";

export const MARKER_VERSION = 2;

// Mirrors the extensions created by the `init` profile in
// docker/docker-compose.dev.yml. Kept as data so the check and the compose file
// can be asserted against each other in a test.
export const REQUIRED_EXTENSIONS = [
  "pgcrypto",
  "pg_stat_statements",
  "pg_trgm",
  "uuid-ossp",
] as const;

export interface InitMarker {
  /** Fingerprint of the contract source at the time the schema was applied. */
  contractFingerprint: string;
  initializedAt: string;
  /** Extensions observed present in pg_extension. */
  extensions: string[];
  version: number;
}

export type StepName = "compose" | "extensions" | "skills" | "emit" | "update";

export interface StepDecision {
  reason: string;
  run: boolean;
}

export interface ArtefactFacts {
  /** contract.d.ts is the artefact db update and the app both consume. */
  contractDTsMtimeMs: number;
  contractJsonMtimeMs: number;
  contractSourceMtimeMs: number;
  sourceExists: boolean;
}

export interface MarkerFacts {
  /** Raw stdout of `prisma db verify --json`, or null when it could not run. */
  verifyExitCode: number | null;
}

function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

export function fingerprintContract(source: string) {
  return `sha1:${sha1(source)}`;
}

// A missing or unparseable marker is never a reason to trust the database. It
// only means we have to check harder, so it falls through to the normal checks
// rather than short-circuiting to "skip".
export function parseMarker(raw: string | null): InitMarker | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = parsed as Partial<InitMarker>;
  if (
    candidate.version !== MARKER_VERSION ||
    typeof candidate.contractFingerprint !== "string" ||
    !Array.isArray(candidate.extensions)
  ) {
    return null;
  }

  return {
    contractFingerprint: candidate.contractFingerprint,
    extensions: candidate.extensions.filter(
      (value): value is string => typeof value === "string"
    ),
    initializedAt:
      typeof candidate.initializedAt === "string"
        ? candidate.initializedAt
        : "unknown",
    version: MARKER_VERSION,
  };
}

export function buildMarker(
  contractFingerprint: string,
  extensions: readonly string[]
): InitMarker {
  return {
    contractFingerprint,
    extensions: [...extensions].sort(),
    initializedAt: new Date().toISOString(),
    version: MARKER_VERSION,
  };
}

export function parseExtensionList(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function missingExtensions(
  present: readonly string[],
  required: readonly string[] = REQUIRED_EXTENSIONS
): string[] {
  const have = new Set(present);
  return required.filter((extension) => !have.has(extension));
}

// The extension step is driven by the live database, never by the marker alone.
// A marker that survived while the volume was recreated would otherwise skip the
// extensions and let `db update` fail on a missing extension.
export function shouldInstallExtensions(
  present: readonly string[],
  required: readonly string[] = REQUIRED_EXTENSIONS
): StepDecision {
  const missing = missingExtensions(present, required);
  return missing.length === 0
    ? { reason: "all required extensions present", run: false }
    : { reason: `missing: ${missing.join(", ")}`, run: true };
}

// `prisma skills sync` copies the agent instruction files out of the installed
// Prisma packages. Those packages only change on a dependency bump, so this is
// gated on the installed ORM version rather than run unconditionally.
export function shouldSyncSkills(
  installedOrmVersion: string,
  syncedLibraryVersion: string | null
): StepDecision {
  if (syncedLibraryVersion === installedOrmVersion) {
    return {
      reason: `skills already match ${installedOrmVersion}`,
      run: false,
    };
  }
  return {
    reason:
      syncedLibraryVersion === null
        ? "no synced skill recorded"
        : `skills at ${syncedLibraryVersion}, package at ${installedOrmVersion}`,
    run: true,
  };
}

// contract.json / contract.d.ts are derived from contract.prisma. Emitting them
// again when the source has not been touched is pure cost, so compare mtimes.
// Any artefact that is missing or older than the source is stale.
export function shouldEmitContract(facts: ArtefactFacts): StepDecision {
  if (!facts.sourceExists) {
    return { reason: "contract source missing", run: true };
  }
  if (facts.contractJsonMtimeMs === 0 || facts.contractDTsMtimeMs === 0) {
    return { reason: "emitted contract artefacts missing", run: true };
  }
  if (
    facts.contractJsonMtimeMs < facts.contractSourceMtimeMs ||
    facts.contractDTsMtimeMs < facts.contractSourceMtimeMs
  ) {
    return { reason: "contract source is newer than the artefacts", run: true };
  }
  return { reason: "emitted contract is up to date", run: false };
}

// The important one. `prisma db update` re-reads the contract, diffs it against
// the live database and applies the gap, which on an unchanged database is
// several seconds of planning for no operations.
//
// Two independent signals must both say "skip":
//   1. the contract source has not changed since we last applied it, and
//   2. `prisma db verify` reports the database still matches the contract.
//
// Signal 1 alone is not enough: someone can drift the database by hand without
// touching the contract, and then the fingerprint would still match while the
// schema is wrong. Signal 2 alone is not enough either, because verify passes
// against a stale contract. Requiring both means a manual fix-up is still
// repaired, and an unchanged database still costs one cheap verify.
export function shouldUpdateDatabase(input: {
  contractFingerprint: string;
  facts: MarkerFacts;
  marker: InitMarker | null;
}): StepDecision {
  const { contractFingerprint, facts, marker } = input;

  if (facts.verifyExitCode === null) {
    return { reason: "could not verify the database, updating", run: true };
  }
  if (facts.verifyExitCode !== 0) {
    return {
      reason: `db verify reported findings (exit ${facts.verifyExitCode})`,
      run: true,
    };
  }
  if (marker && marker.contractFingerprint !== contractFingerprint) {
    return { reason: "contract changed since the last apply", run: true };
  }

  return {
    reason: marker
      ? "database matches the contract and the contract has not changed"
      : "database matches the contract",
    run: false,
  };
}

// The init profile is only pulled in when the extension step is going to run.
// Bringing it up unconditionally meant a throwaway container spawned and exited
// on every start.
export function shouldRunInitProfile(extensions: StepDecision): StepDecision {
  return extensions.run
    ? { reason: extensions.reason, run: true }
    : { reason: "extensions already installed", run: false };
}

export function summariseDecisions(decisions: readonly StepDecision[]): string {
  return decisions
    .map((decision) => `${decision.run ? "run" : "skip"} (${decision.reason})`)
    .join("; ");
}
