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

export async function findWindowsListeningPids(
  stdout: string,
  ports: readonly number[],
  excludePids: readonly number[],
  probe: (port: number, host: string) => Promise<boolean> = (port, host) =>
    hasListenerOnPort(port, [host])
): Promise<number[]> {
  const records = parseWindowsPortOwners(stdout, ports, excludePids);
  const endpoints = new Map<
    string,
    {
      host: string;
      port: number;
      listening: boolean;
      owners: Set<number>;
      needsProbe: boolean;
    }
  >();
  for (const record of records) {
    if (
      typeof record.LocalAddress !== "string" ||
      !record.LocalAddress.trim()
    ) {
      continue;
    }
    const host = windowsListenerProbeHost(record.LocalAddress);
    const key = JSON.stringify([host, record.LocalPort]);
    const endpoint = endpoints.get(key) ?? {
      host,
      port: record.LocalPort,
      listening: false,
      owners: new Set<number>(),
      needsProbe: false,
    };
    endpoint.owners.add(record.OwningProcess);
    endpoint.needsProbe ||= !["Listen", 2].includes(record.State ?? "");
    endpoints.set(key, endpoint);
  }
  // A successful connect cannot prove which process owns an ambiguous endpoint.
  const pending = [...endpoints.values()].filter(
    (endpoint) => endpoint.needsProbe && endpoint.owners.size === 1
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length) {
        const endpoint = pending[next];
        next += 1;
        if (endpoint) {
          endpoint.listening = await probe(endpoint.port, endpoint.host).catch(
            () => false
          );
        }
      }
    })
  );
  return [
    ...new Set(
      records
        .filter(
          (record) =>
            ["Listen", 2].includes(record.State ?? "") ||
            (typeof record.LocalAddress === "string" &&
              endpoints.get(
                JSON.stringify([
                  windowsListenerProbeHost(record.LocalAddress),
                  record.LocalPort,
                ])
              )?.listening === true)
        )
        .map((record) => record.OwningProcess)
    ),
  ];
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
    // Unknown CIM states require an exact-address probe, including LAN-only binds.
    return await findWindowsListeningPids(stdout, ports, excludePids);
  }
  return [...new Set(stdout.trim().split(/\s+/).map(Number))].filter(
    (pid) => Number.isInteger(pid) && pid > 0 && !excludePids.includes(pid)
  );
}
