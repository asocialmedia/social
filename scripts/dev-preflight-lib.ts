import { createHash } from "node:crypto";

export interface ServiceSnapshot {
  Health?: string;
  Name?: string;
  Service?: string;
  State?: string;
}

export interface OneShotStatus {
  exists: boolean;
  status: string;
}

export interface CacheShape {
  checks: Record<
    string,
    {
      key: string;
      timestamp: number;
    }
  >;
  version: number;
}

export interface PreflightConfig {
  requiredBuckets: string[];
  requiredServices: string[];
}

export type PreflightCheckKey =
  | "services"
  | "init-jobs"
  | "postgres"
  | "redis"
  | "asmob"
  | "openobserve"
  | "portless";

export type PreflightCheckState =
  | "pending"
  | "running"
  | "ok"
  | "cached"
  | "failed";

export const PREFLIGHT_CHECK_ORDER: Array<{
  key: PreflightCheckKey;
  label: string;
}> = [
  { key: "services", label: "svc" },
  { key: "init-jobs", label: "init" },
  { key: "postgres", label: "pg" },
  { key: "redis", label: "rd" },
  { key: "asmob", label: "obj" },
  { key: "openobserve", label: "ozo" },
  { key: "portless", label: "ptl" },
];

export const DEFAULT_PREFLIGHT_CONFIG: PreflightConfig = {
  requiredBuckets: ["uploads", "avatars", "temp", "backups"],
  requiredServices: [
    "postgres-dev",
    "redis-dev",
    "asmob-dev",
    "openobserve-dev",
  ],
};

export function hasOpenObserveHealth(output: string) {
  return output.includes("ok");
}

export function hash(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

export function withinTtl(timestamp: number, ttlMs: number) {
  return Date.now() - timestamp < ttlMs;
}

export function computeCacheDigest(checkInput: string) {
  return hash(checkInput);
}

export function getMissingServices(
  snapshots: ServiceSnapshot[],
  requiredServices: string[]
) {
  const byService = new Set(
    snapshots.map((snapshot) => snapshot.Service).filter(Boolean) as string[]
  );

  return requiredServices.filter((service) => !byService.has(service));
}

export interface RawContainerStatus {
  Health?: string;
  Labels?: Record<string, string>;
  Names?: string[];
  Service?: string;
  State?: string;
  Status?: string;
}

const HEALTH_STATUS_PATTERN = /\((healthy|unhealthy|starting)\)/;

export function parseContainerSnapshot(
  raw: RawContainerStatus
): ServiceSnapshot {
  const state = raw.State || "";
  const health =
    raw.Health || raw.Status?.match(HEALTH_STATUS_PATTERN)?.[1] || "";
  const service =
    raw.Service ||
    raw.Labels?.["com.docker.compose.service"] ||
    raw.Names?.[0] ||
    "";

  return {
    Health: health,
    Name: raw.Names?.[0],
    Service: service,
    State: state,
  };
}

export function parseServiceSnapshots(stdout: string): ServiceSnapshot[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  let rawRecords: RawContainerStatus[];
  if (trimmed.startsWith("[")) {
    rawRecords = JSON.parse(trimmed) as RawContainerStatus[];
  } else {
    rawRecords = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RawContainerStatus);
  }

  return rawRecords.map(parseContainerSnapshot);
}

export function getUnhealthyServices(
  snapshots: ServiceSnapshot[],
  requiredServices: string[]
) {
  const byService = new Map<string, ServiceSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.Service) {
      byService.set(snapshot.Service, snapshot);
    }
  }

  const unhealthy: string[] = [];

  for (const service of requiredServices) {
    const snapshot = byService.get(service);
    if (!snapshot) {
      continue;
    }

    const state = snapshot.State ?? "";
    if (state !== "running") {
      unhealthy.push(`${service} (${state || "unknown"})`);
      continue;
    }

    const hasHealth =
      typeof snapshot.Health === "string" && snapshot.Health.length > 0;
    if (hasHealth && snapshot.Health !== "healthy") {
      unhealthy.push(`${service} (${snapshot.Health})`);
    }
  }

  return unhealthy;
}

export function hasSchemaTables(output: string) {
  return output.trim() === "t";
}

export function hasRedisPong(output: string) {
  return output.trim() === "PONG";
}

export function getMissingBuckets(
  buckets: string[],
  requiredBuckets: string[]
) {
  return requiredBuckets.filter((bucket) => !buckets.includes(bucket));
}

export function areInitJobsComplete(
  schemaInit: OneShotStatus,
  objectInit: OneShotStatus
) {
  if (!(schemaInit.exists && objectInit.exists)) {
    return false;
  }

  return (
    schemaInit.status.startsWith("Exited (0)") &&
    objectInit.status.startsWith("Exited (0)")
  );
}

export function buildRuntimeFingerprint(snapshots: ServiceSnapshot[]) {
  return hash(
    JSON.stringify(
      snapshots
        .map((item) => ({
          Health: item.Health ?? "",
          Service: item.Service ?? "",
          State: item.State ?? "",
        }))
        .sort((a, b) => a.Service.localeCompare(b.Service))
    )
  );
}

export function formatPreflightCheckState(state: PreflightCheckState) {
  if (state === "running") {
    return "...";
  }
  if (state === "ok") {
    return "ok";
  }
  if (state === "cached") {
    return "cache";
  }
  if (state === "failed") {
    return "fail";
  }
  return "wait";
}

export function buildPreflightProgressLine(
  states: ReadonlyMap<PreflightCheckKey, PreflightCheckState>
) {
  const body = PREFLIGHT_CHECK_ORDER.map(
    (item) =>
      `${item.label}:${formatPreflightCheckState(
        states.get(item.key) ?? "pending"
      )}`
  ).join(" ");

  return `preflight ${body}`;
}

export function shouldUseSudoForPortless(output: string) {
  return (
    output.includes("requires sudo") ||
    output.includes("no TTY") ||
    output.includes("a terminal is required")
  );
}
