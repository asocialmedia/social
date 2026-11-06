import { hasListenerOnPort } from "./tcp-port";

interface WindowsPortOwner {
  LocalAddress: string;
  LocalPort: number;
  OwningProcess: number;
  RemotePort: number;
  State: string | number | null;
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
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (record) =>
      ports.includes(record.LocalPort) &&
      Number.isInteger(record.OwningProcess) &&
      record.OwningProcess > 0 &&
      !excludePids.includes(record.OwningProcess) &&
      (["Listen", 2].includes(record.State ?? "") ||
        ((record.State === null || record.State === 0) &&
          record.RemotePort === 0))
  );
}

export function windowsListenerProbeHost(address: string): string {
  if (address === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (address === "::") {
    return "::1";
  }
  return address;
}

export async function getPlatformListeningPids(
  ports: readonly number[],
  excludePids: readonly number[],
  platform = process.platform
): Promise<number[]> {
  if (!ports.length) {
    return [];
  }
  if (
    !ports.every((port) => Number.isInteger(port) && port > 0 && port <= 65535)
  ) {
    throw new RangeError("Invalid listener port");
  }
  const command =
    platform === "win32"
      ? [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$requestedPorts = @(${ports.join(",")}); Get-NetTCPConnection -ErrorAction Stop | Where-Object { $_.RemotePort -eq 0 -and $requestedPorts -contains $_.LocalPort } | Select-Object LocalAddress,LocalPort,RemotePort,OwningProcess,@{Name='State';Expression={$_.CimInstanceProperties['State'].Value}} | ConvertTo-Json -Compress`,
        ]
      : ["lsof", "-nP", "-a", `-iTCP:${ports.join(",")}`, "-sTCP:LISTEN", "-t"];
  const proc = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
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
    const owners = await Promise.all(
      parseWindowsPortOwners(stdout, ports, excludePids).map(async (record) => {
        // Some CIM providers report zero/null even for real listeners. Probe that exact address, including LAN-only binds.
        const listening =
          ["Listen", 2].includes(record.State ?? "") ||
          (await hasListenerOnPort(record.LocalPort, [
            windowsListenerProbeHost(record.LocalAddress),
          ]));
        return listening ? record.OwningProcess : undefined;
      })
    );
    return [
      ...new Set(owners.filter((pid): pid is number => pid !== undefined)),
    ];
  }
  return [...new Set(stdout.trim().split(/\s+/).map(Number))].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && !excludePids.includes(pid)
  );
}
