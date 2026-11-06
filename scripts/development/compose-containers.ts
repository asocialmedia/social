export interface ContainerInfo {
  name: string;
  ports: string;
  service: string;
  state: string;
  status: string;
}

interface ComposeContainer {
  Labels?: Record<string, string> | string;
  Name?: string;
  Names?: string[] | string;
  Ports?: { host_port?: number; container_port?: number }[] | string;
  Publishers?: { PublishedPort?: number; TargetPort?: number }[] | null;
  Service?: string;
  State?: string;
  Status?: string;
}

function containerPorts(raw: ComposeContainer): string {
  if (typeof raw.Ports === "string") {
    return raw.Ports;
  }
  if (Array.isArray(raw.Ports)) {
    return raw.Ports.map((port) =>
      port.host_port
        ? `${port.host_port}->${port.container_port}`
        : `${port.container_port}`
    ).join(", ");
  }
  return (raw.Publishers ?? [])
    .map((port) =>
      port.PublishedPort
        ? `${port.PublishedPort}->${port.TargetPort}`
        : `${port.TargetPort}`
    )
    .join(", ");
}

export function parseContainerList(stdout: string): ContainerInfo[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  // Compose versions and providers emit either a JSON array or JSON Lines.
  let records: ComposeContainer[];
  try {
    records = trimmed.startsWith("[")
      ? JSON.parse(trimmed)
      : trimmed
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
  return records.map((raw) => {
    const labelService =
      typeof raw.Labels === "string"
        ? raw.Labels.split(",")
            .find((label) => label.startsWith("com.docker.compose.service="))
            ?.slice("com.docker.compose.service=".length)
        : raw.Labels?.["com.docker.compose.service"];
    const service = raw.Service ?? labelService ?? "unknown";
    const name = typeof raw.Names === "string" ? raw.Names : raw.Names?.[0];
    return {
      name: raw.Name ?? name ?? service,
      ports: containerPorts(raw),
      service,
      state: raw.State ?? "",
      status: (raw.Status ?? "").replace(/\s+/g, " ").trim(),
    };
  });
}
