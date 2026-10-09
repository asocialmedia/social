#!/usr/bin/env bun

// One-time-aware database bootstrap for `bun run docker:dev`.
//
// Previously docker:dev unconditionally ran the `init` compose profile and then
// `db:up`, which meant a throwaway extension container plus a skill sync, a
// contract emit and a `prisma db update` on every start. The Postgres volume
// persists, so on any second run all of that was a no-op that still cost real
// time.
//
// The order below matters: extensions have to exist before `db update` runs,
// because the contract depends on them.

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { intro, log, outro, spinner } from "@clack/prompts";

import {
  buildMarker,
  fingerprintContract,
  formatPrismaFailure,
  parseExtensionList,
  parseMarker,
  parsePendingMigrations,
  REQUIRED_EXTENSIONS,
  shouldEmitContract,
  shouldInstallExtensions,
  shouldRunInitProfile,
  shouldSyncSkills,
  shouldUpdateDatabase,
} from "./dev-init-lib";
import type { StepDecision } from "./dev-init-lib";

const ROOT = process.cwd();
const MARKER_FILE = path.join(ROOT, ".dev-init");
const COMPOSE_FILE = "docker/docker-compose.dev.yml";
const DB_DIR = path.join(ROOT, "packages", "db");
const CONTRACT_SOURCE = path.join(DB_DIR, "prisma", "contract.prisma");
const CONTRACT_JSON = path.join(DB_DIR, "generated", "prisma", "contract.json");
const CONTRACT_DTS = path.join(DB_DIR, "generated", "prisma", "contract.d.ts");
// The managed copy `prisma skills sync` actually writes when run from
// packages/db. The repo-root .claude/skills copy is orphaned (stuck at an old
// library_version), so gating on it re-ran the sync on every start even though
// the CLI reported "already current".
const SKILL_FILE = path.join(
  DB_DIR,
  ".claude",
  "skills",
  "prisma-8",
  "SKILL.md"
);

// Display order for `docker compose ps`. Init containers are one-shot (they
// exit 0 after creating extensions/buckets) so they sort last.
const SERVICE_ORDER = [
  "postgres-dev",
  "redis-dev",
  "asmob-dev",
  "clamav-dev",
  "openobserve-dev",
  "redis-insight",
  "postgres-init",
  "asmob-init",
];

interface ContainerInfo {
  name: string;
  ports: string;
  service: string;
  state: string;
  status: string;
}

const progress = spinner();
let failures = 0;

function start(message: string) {
  if (process.stdout.isTTY) {
    progress.start(message);
  }
}

function stop(message: string) {
  if (process.stdout.isTTY) {
    progress.stop(message);
  } else {
    process.stdout.write(`${message}\n`);
  }
}

async function runCmd(args: string[], cwd = ROOT) {
  const proc = Bun.spawn(args, { cwd, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stderr: stderr.trim(), stdout: stdout.trim() };
}

function fatal(message: string): never {
  stop("failed");
  log.error(message);
  outro(`Fix the above, then re-run \`bun run docker:dev\`.`);
  process.exit(1);
}

function parseContainerList(stdout: string): ContainerInfo[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  // podman-compose prints one JSON array; docker compose prints one object
  // per line. Accept both.
  let records: {
    Labels?: Record<string, string>;
    Names?: string[];
    Ports?: { host_port?: number; container_port?: number }[];
    Service?: string;
    State?: string;
    Status?: string;
  }[];
  try {
    if (trimmed.startsWith("[")) {
      records = JSON.parse(trimmed) as typeof records;
    } else {
      records = trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as (typeof records)[number]);
    }
  } catch {
    return [];
  }
  return records.map((raw) => {
    const service =
      raw.Service ?? raw.Labels?.["com.docker.compose.service"] ?? "unknown";
    const ports = (raw.Ports ?? [])
      .map((port) =>
        port.host_port
          ? `${port.host_port}->${port.container_port}`
          : `${port.container_port}`
      )
      .join(", ");
    return {
      name: raw.Names?.[0] ?? service,
      ports,
      service,
      state: raw.State ?? "",
      status: (raw.Status ?? "").replace(/\s+/g, " ").trim(),
    };
  });
}

function sortContainers(containers: ContainerInfo[]): ContainerInfo[] {
  const rank = new Map(SERVICE_ORDER.map((name, index) => [name, index]));
  return [...containers].toSorted((a, b) => {
    const ra = rank.get(a.service) ?? SERVICE_ORDER.length;
    const rb = rank.get(b.service) ?? SERVICE_ORDER.length;
    return ra - rb || a.service.localeCompare(b.service);
  });
}

function containerGlyph(info: ContainerInfo): string {
  if (info.state === "running") {
    if (info.status.includes("unhealthy") || info.status.includes("starting")) {
      return "!";
    }
    return "✓";
  }
  // One-shot init containers exiting 0 is the happy path, not a failure.
  if (info.state === "exited" && /exited\s*\(0\)/i.test(info.status)) {
    return "·";
  }
  return "✗";
}

async function reportContainers(stage: string): Promise<void> {
  const ps = await compose(["ps", "--format", "json"]);
  if (ps.exitCode !== 0) {
    log.warn(
      `could not list containers (${stage}): ${ps.stderr || "ps failed"}`
    );
    return;
  }
  const containers = sortContainers(parseContainerList(ps.stdout));
  if (containers.length === 0) {
    log.warn(`no containers reported (${stage})`);
    return;
  }
  for (const info of containers) {
    const ports = info.ports ? ` @ ${info.ports}` : "";
    const status = info.status ? ` — ${info.status}` : ` — ${info.state}`;
    log.info(
      `${containerGlyph(info)} ${info.service} (${info.name})${status}${ports}`
    );
  }
}

// prisma must resolve from packages/db because that is where prisma.config.ts
// lives; every command resolves paths relative to the config's directory.
// The env file is a `bun run` flag and has to precede the binary name. Passing it
// after the subcommand makes Prisma parse it as one of its own and fail with
// CLI.INVALID_ARGUMENTS, which then reads as "verify could not run" and forces
// a pointless `db update` on every start.
async function prisma(args: string[], envFile?: string) {
  const envFlag = envFile ? ["--env-file", envFile] : [];
  return runCmd(["bun", "run", ...envFlag, "prisma", ...args], DB_DIR);
}

function compose(args: string[]) {
  return runCmd(["docker", "compose", "-f", COMPOSE_FILE, ...args]);
}

async function mtimeMs(filePath: string): Promise<number> {
  try {
    const info = await stat(filePath);
    return info.mtimeMs;
  } catch {
    return 0;
  }
}

async function readInstalledOrmVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(path.join(DB_DIR, "package.json"), "utf-8")
  ) as { dependencies?: Record<string, string> };
  return pkg.dependencies?.["@prisma/orm-postgres"] ?? "unknown";
}

// The skill frontmatter carries the Prisma version it was published with, which
// is exactly the comparison `prisma skills sync` cares about: the copy only goes
// stale when the installed package changes. Read the managed copy under
// packages/db (see SKILL_FILE), not the orphaned repo-root copy.
async function readSyncedSkillVersion(): Promise<string | null> {
  try {
    const raw = await readFile(SKILL_FILE, "utf-8");
    const match = raw.match(/^\s*library_version:\s*["']?([^"'\n]+)["']?\s*$/m);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

async function listInstalledExtensions(): Promise<string[]> {
  const result = await compose([
    "exec",
    "-T",
    "postgres-dev",
    "psql",
    "-U",
    "postgres",
    "-d",
    "asocialmedia",
    "-At",
    "-c",
    "SELECT extname FROM pg_extension ORDER BY extname;",
  ]);
  if (result.exitCode !== 0) {
    return [];
  }
  return parseExtensionList(result.stdout);
}

function report(label: string, decision: StepDecision) {
  stop(`${decision.run ? "→" : "·"} ${label}: ${decision.reason}`);
}

async function main() {
  intro("asmdev database bootstrap");

  // Always bring the stack up. The services are declared with
  // `restart: unless-stopped`, so this is a no-op once they are running. The
  // `init` profile is deliberately NOT passed here: it spawns a throwaway
  // container, and step 1 only wants it when an extension is genuinely missing.
  // The `studio` profile (RedisInsight) stays on, matching the previous
  // behaviour of `docker:dev`.
  start("starting dev services");
  const up = await compose([
    "--profile",
    "studio",
    "up",
    "-d",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  if (up.exitCode !== 0) {
    stop("dev services failed to start");
    await reportContainers("after failed up");
    const detail = [up.stdout, up.stderr].filter(Boolean).join("\n");
    fatal(
      `Could not start the dev services:\n${detail || "no output captured"}`
    );
  }
  stop("· dev services up");
  await reportContainers("current state");

  // 1. Extensions. Driven by the live database, never by the marker alone.
  const present = await listInstalledExtensions();
  const extensions = shouldInstallExtensions(present);
  report("extensions", extensions);

  if (shouldRunInitProfile(extensions).run) {
    start("installing postgres extensions");
    const init = await compose(["--profile", "init", "up", "-d", "--wait"]);
    if (init.exitCode !== 0) {
      const detail = [init.stdout, init.stderr].filter(Boolean).join("\n");
      fatal(`Extension install failed:\n${detail || "no output captured"}`);
    }
    stop("· extensions installed");
    await reportContainers("after extension install");
  }

  // 2. Agent skills. Only stale on a Prisma dependency bump.
  const installedVersion = await readInstalledOrmVersion();
  const skills = shouldSyncSkills(
    installedVersion,
    await readSyncedSkillVersion()
  );
  report("skills", skills);
  if (skills.run) {
    start("syncing prisma skills");
    const sync = await prisma(["skills", "sync"]);
    if (sync.exitCode !== 0) {
      // Not fatal. The skills are agent instructions, not build input, and
      // `postinstall` re-syncs them anyway.
      failures += 1;
      stop("! skills sync failed, run `bun run db:gen` to retry");
      log.warn(formatPrismaFailure(sync.stdout, sync.stderr, sync.exitCode));
    } else {
      stop("· skills synced");
    }
  }

  // 3. Emit the contract. Derivable output, gated on the source mtime.
  const emit = shouldEmitContract({
    contractDTsMtimeMs: await mtimeMs(CONTRACT_DTS),
    contractJsonMtimeMs: await mtimeMs(CONTRACT_JSON),
    contractSourceMtimeMs: await mtimeMs(CONTRACT_SOURCE),
    sourceExists: (await mtimeMs(CONTRACT_SOURCE)) > 0,
  });
  report("contract", emit);
  if (emit.run) {
    start("emitting contract");
    const emitted = await prisma(["contract", "emit"]);
    if (emitted.exitCode !== 0) {
      fatal(
        `contract emit failed:\n${formatPrismaFailure(emitted.stdout, emitted.stderr, emitted.exitCode)}`
      );
    }
    stop("· contract emitted");
  }

  // 4. Apply the schema. Two independent signals have to agree before skipping:
  // the marker fingerprint (cheap) and `db verify` against the live database.
  // Verify exit codes are load-bearing: 0 = matches, 4 = drift/marker finding,
  // 2 = could not run (DB unreachable, missing contract). Only 0 may skip.
  const marker = parseMarker(
    await readFile(MARKER_FILE, "utf-8").catch(() => null)
  );
  const source = await readFile(CONTRACT_SOURCE, "utf-8").catch(() => "");
  const contractFingerprint = fingerprintContract(source);

  start("verifying schema");
  const verify = await prisma(["db", "verify"], "../../.env.test");
  if (verify.exitCode === 0) {
    stop("· verify: database matches the contract");
  } else if (verify.exitCode === 4) {
    stop("! verify: drift or marker finding (exit 4), schema update needed");
  } else {
    stop(
      `! verify could not run (exit ${verify.exitCode}), will attempt update`
    );
    log.warn(
      formatPrismaFailure(verify.stdout, verify.stderr, verify.exitCode)
    );
  }
  const update = shouldUpdateDatabase({
    contractFingerprint,
    facts: { verifyExitCode: verify.exitCode },
    marker,
  });
  report("schema", update);

  if (update.run) {
    // Prefer the formal path when an authored migration is already waiting:
    // `db update` re-plans from the contract diff and fails on planner
    // conflicts (FK rewrites, data transforms), while `db migrate` applies the
    // reviewed package that already resolves them. `db migrate --show` is
    // read-only, so checking it first costs nothing.
    const show = await prisma(["db", "migrate", "--show"], "../../.env.test");
    const pending = parsePendingMigrations(show.stdout);

    if (pending.length > 0) {
      start(`applying ${pending.length} pending migration(s)`);
      log.info(`pending: ${pending.join(", ")}`);
      const migrated = await prisma(
        ["db", "migrate", "--advance-ref", "db"],
        "../../.env.test"
      );
      if (migrated.exitCode !== 0) {
        fatal(
          `db migrate failed:\n${formatPrismaFailure(migrated.stdout, migrated.stderr, migrated.exitCode)}`
        );
      }
      stop("· migrations applied");
    } else {
      start("applying schema");
      const applied = await prisma(
        ["db", "update", "--confirm", "asocialmedia"],
        "../../.env.test"
      );
      if (applied.exitCode !== 0) {
        const failure = formatPrismaFailure(
          applied.stdout,
          applied.stderr,
          applied.exitCode
        );
        // `db update` is the quick dev-only path: it plans from the contract
        // diff and cannot author data transforms or resolve planner conflicts.
        // A PLANNING_FAILED here means the change needs a real migration, not a
        // retry of this command.
        fatal(
          `db update failed:\n${failure}\n\n` +
            `Next steps:\n` +
            `- preview the plan: bun run --cwd packages/db --env-file=../../.env.test prisma db update --dry-run\n` +
            `- author a migration: bun run --cwd packages/db prisma migration plan --name <snake_slug>\n` +
            `- then: bun run --cwd packages/db prisma db migrate --db $DATABASE_URL`
        );
      }
      stop("· schema applied");
    }
  }

  // Record what the database now holds so the next start can trust it.
  await writeFile(
    MARKER_FILE,
    `${JSON.stringify(
      buildMarker(
        contractFingerprint,
        await listInstalledExtensions().then((list) =>
          list.length > 0 ? list : REQUIRED_EXTENSIONS
        )
      ),
      null,
      2
    )}\n`
  );

  outro(
    failures > 0
      ? "Infra ready, with warnings above"
      : "Infra ready. `bun run dev` next."
  );
}

(async () => {
  try {
    await main();
  } catch (error: unknown) {
    fatal(error instanceof Error ? error.message : String(error));
  }
})();
