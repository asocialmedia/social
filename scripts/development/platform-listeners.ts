import { hasListenerOnPort } from "./tcp-port";

interface WindowsPortOwner {
  LocalPort: number;
  OwningProcess: number;
}

export function parseWindowsPortOwners(
  stdout: string,
  ports: readonly number[],
  excludePids: readonly number[]
): WindowsPortOwner[] {
  if (!stdout.trim()) {
    return [];
  }
  const parsed: WindowsPortOwner | WindowsPortOwner[] = JSON.parse(stdout);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const requestedPorts = new Set(ports);
  const excluded = new Set(excludePids);
  return records.filter(
    (record) =>
      requestedPorts.has(record.LocalPort) &&
      Number.isInteger(record.OwningProcess) &&
      record.OwningProcess > 0 &&
      !excluded.has(record.OwningProcess)
  );
}

export async function getPlatformListeningPids(
  ports: readonly number[],
  excludePids: readonly number[],
  platform = process.platform
): Promise<number[]> {
  if (ports.length === 0) {
    return [];
  }
  const command =
    platform === "win32"
      ? [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.RemotePort -eq 0 } | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress",
        ]
      : ["lsof", "-nP", "-a", `-iTCP:${ports.join(",")}`, "-sTCP:LISTEN", "-t"];
  const proc = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // lsof exits 1 with no output when no matching sockets exist.
  if (
    platform !== "win32" &&
    exitCode === 1 &&
    !stdout.trim() &&
    !stderr.trim()
  ) {
    return [];
  }
  if (exitCode !== 0) {
    throw new Error(
      `Listener discovery failed: ${stderr || stdout || exitCode}`
    );
  }
  if (platform === "win32") {
    const candidates = parseWindowsPortOwners(stdout, ports, excludePids);
    const reachablePorts = new Set(
      await Promise.all(
        [...new Set(candidates.map((record) => record.LocalPort))].map(
          async (port) => ((await hasListenerOnPort(port)) ? port : undefined)
        )
      )
    );
    // The Windows table can include bound sockets, so confirm each port accepts connections.
    return [
      ...new Set(
        candidates
          .filter((record) => reachablePorts.has(record.LocalPort))
          .map((record) => record.OwningProcess)
      ),
    ];
  }
  return [...new Set(stdout.trim().split(/\s+/).map(Number))].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && !excludePids.includes(pid)
  );
}
