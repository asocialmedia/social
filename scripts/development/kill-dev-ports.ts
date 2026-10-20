#!/usr/bin/env bun
import { readdirSync, readlinkSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";

export const DEV_PORTS = [3000, 3001, 3010, 3012] as const;

/**
 * Returns all ancestor PIDs up to PID 1 to prevent self or parent termination.
 */
export function getAncestorPids(): number[] {
  const ancestors: number[] = [process.pid];
  let cur = process.ppid;
  while (cur > 1 && !ancestors.includes(cur)) {
    ancestors.push(cur);
    try {
      const stat = readFileSync(`/proc/${cur}/stat`, "utf8");
      const ppid = Number.parseInt(stat.split(" ")[3] ?? "0", 10);
      if (!ppid || ppid <= 1) {
        break;
      }
      cur = ppid;
    } catch {
      break;
    }
  }
  return ancestors;
}

/**
 * Discovers PIDs listening on the specified TCP ports using /proc/net/tcp{,6}
 * socket inode matching. Works reliably on Linux without lsof/fuser.
 */
export function getPidsFromProc(
  ports: readonly number[],
  excludePids: readonly number[] = getAncestorPids()
): number[] {
  const pids = new Set<number>();
  const hexPorts = new Set(
    ports.map((p) => p.toString(16).toUpperCase().padStart(4, "0"))
  );
  const inodes = new Set<string>();

  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) {
          continue;
        }
        const localAddr = parts[1];
        const state = parts[3];
        // 0A is TCP_LISTEN
        if (state !== "0A") {
          continue;
        }
        const portHex = localAddr?.split(":")[1];
        if (portHex && hexPorts.has(portHex)) {
          const inode = parts[9];
          if (inode && inode !== "0") {
            inodes.add(inode);
          }
        }
      }
    } catch {
      // /proc/net may not be available on non-Linux
    }
  }

  if (inodes.size === 0) {
    return [];
  }

  const excluded = new Set(excludePids);

  try {
    const entries = readdirSync("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) {
        continue;
      }
      const pid = Number.parseInt(entry, 10);
      if (excluded.has(pid)) {
        continue;
      }
      try {
        const fdDir = `/proc/${pid}/fd`;
        const fds = readdirSync(fdDir);
        for (const fd of fds) {
          try {
            const link = readlinkSync(`${fdDir}/${fd}`);
            const match = link.match(/^socket:\[(\d+)\]$/);
            if (match?.[1] && inodes.has(match[1])) {
              pids.add(pid);
              break;
            }
          } catch {
            // fd might have closed
          }
        }
      } catch {
        // process might have exited or permission denied
      }
    }
  } catch {
    // /proc iteration failure
  }

  return [...pids];
}

/**
 * Discovers PIDs listening on the specified ports using `ss -lptn`.
 */
export async function getPidsFromSs(
  ports: readonly number[],
  excludePids: readonly number[] = getAncestorPids()
): Promise<number[]> {
  const pids = new Set<number>();
  const excluded = new Set(excludePids);
  try {
    const filter = ports.map((p) => `sport = :${p}`).join(" or ");
    const proc = Bun.spawn(["ss", "-lptn", filter], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    for (const match of stdout.matchAll(/pid=(\d+)/g)) {
      const pid = Number.parseInt(match[1], 10);
      if (pid && !excluded.has(pid)) {
        pids.add(pid);
      }
    }
  } catch {
    // ss not available
  }
  return [...pids];
}

export async function findListeningPids(
  ports: readonly number[],
  excludePids: readonly number[] = getAncestorPids()
): Promise<number[]> {
  const [procPids, ssPids] = await Promise.all([
    getPidsFromProc(ports, excludePids),
    getPidsFromSs(ports, excludePids),
  ]);
  return [...new Set([...procPids, ...ssPids])];
}

export async function killStaleDevProcesses(
  ports: readonly number[] = DEV_PORTS
): Promise<void> {
  const ancestorPids = getAncestorPids();
  const excluded = new Set(ancestorPids);

  // 1. Kill discovered PIDs on the target ports with SIGTERM
  const listeningPids = await findListeningPids(ports, ancestorPids);
  for (const pid of listeningPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }

  // 2. Kill by process patterns matching target ports
  const isFullCleanup = DEV_PORTS.every((p) => ports.includes(p));
  const patterns: string[] = [];
  if (isFullCleanup || ports.includes(3000)) {
    patterns.push("next-server", "next dev");
  }
  if (isFullCleanup || ports.includes(3001)) {
    patterns.push(
      "apps/auth/src/dev",
      "bun --watch src/dev",
      "bun --watch src/server",
      "bun --watch src/worker"
    );
  }
  if (isFullCleanup || ports.includes(3010)) {
    patterns.push("apps/media-processing/src/index");
  }
  if (isFullCleanup || ports.includes(3012)) {
    patterns.push("apps/protocols/src/index");
  }

  await Promise.all(
    patterns.map(async (pattern) => {
      try {
        const proc = Bun.spawn(["pgrep", "-f", pattern], {
          stderr: "pipe",
          stdout: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const pids = stdout
          .split("\n")
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((p) => !Number.isNaN(p) && !excluded.has(p));
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    })
  );

  // 3. Force kill any listening PIDs that haven't exited
  if (listeningPids.length > 0) {
    await Bun.sleep(100);
    for (const pid of listeningPids) {
      if (!excluded.has(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ignore
        }
      }
    }
  }

  // 4. Double-check listening PIDs
  const remainingPids = await findListeningPids(ports, ancestorPids);
  for (const pid of remainingPids) {
    if (!excluded.has(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  // 5. Clean Next.js lock files if port 3000 is targeted
  if (isFullCleanup || ports.includes(3000)) {
    const repoRoot = path.resolve(import.meta.dir, "../..");
    await Promise.all(
      [
        path.join(repoRoot, "apps/web/.next/dev/lock"),
        path.join(repoRoot, "apps/web/.next/dev/lock.file"),
      ].map(async (lockPath) => {
        try {
          await unlink(lockPath);
        } catch {
          // ignore
        }
      })
    );
  }

  // Brief settle so the operating system releases the sockets
  await Bun.sleep(150);
}

if (import.meta.main) {
  const args = process.argv
    .slice(2)
    .map((a) => Number.parseInt(a, 10))
    .filter((p) => !Number.isNaN(p));
  const targetPorts = args.length > 0 ? args : DEV_PORTS;
  await killStaleDevProcesses(targetPorts);
}
