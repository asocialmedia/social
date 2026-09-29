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
  parseExtensionList,
  parseMarker,
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
const SKILL_FILE = path.join(ROOT, ".claude", "skills", "prisma-8", "SKILL.md");

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
// stale when the installed package changes.
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
    fatal(`Could not start the dev services:\n${up.stderr || up.stdout}`);
  }
  stop("· dev services up");

  // 1. Extensions. Driven by the live database, never by the marker alone.
  const present = await listInstalledExtensions();
  const extensions = shouldInstallExtensions(present);
  report("extensions", extensions);

  if (shouldRunInitProfile(extensions).run) {
    start("installing postgres extensions");
    const init = await compose(["--profile", "init", "up", "-d", "--wait"]);
    if (init.exitCode !== 0) {
      fatal(`Extension install failed:\n${init.stderr || init.stdout}`);
    }
    stop("· extensions installed");
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
      fatal(`contract emit failed:\n${emitted.stderr || emitted.stdout}`);
    }
    stop("· contract emitted");
  }

  // 4. Apply the schema. Two independent signals have to agree before skipping.
  const marker = parseMarker(
    await readFile(MARKER_FILE, "utf-8").catch(() => null)
  );
  const source = await readFile(CONTRACT_SOURCE, "utf-8").catch(() => "");
  const contractFingerprint = fingerprintContract(source);

  const verify = await prisma(["db", "verify"], "../../.env.test");
  const update = shouldUpdateDatabase({
    contractFingerprint,
    facts: { verifyExitCode: verify.exitCode },
    marker,
  });
  report("schema", update);

  if (update.run) {
    start("applying schema");
    const applied = await prisma(
      ["db", "update", "--confirm", "asocialmedia"],
      "../../.env.test"
    );
    if (applied.exitCode !== 0) {
      fatal(`db update failed:\n${applied.stderr || applied.stdout}`);
    }
    stop("· schema applied");
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
