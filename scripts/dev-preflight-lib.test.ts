import { describe, expect, test } from "bun:test";

import {
  areInitJobsComplete,
  buildPreflightProgressLine,
  buildRuntimeFingerprint,
  computeCacheDigest,
  formatPreflightCheckState,
  getMissingBuckets,
  getMissingServices,
  getUnhealthyServices,
  hasOpenObserveHealth,
  hasRedisPong,
  hasSchemaTables,
  PREFLIGHT_CHECK_ORDER,
  parseServiceSnapshots,
  shouldUseSudoForPortless,
  withinTtl,
} from "./dev-preflight-lib";
import type {
  PreflightCheckKey,
  PreflightCheckState,
  ServiceSnapshot,
} from "./dev-preflight-lib";

describe("service snapshot helpers", () => {
  test("detects missing required services", () => {
    const snapshots: ServiceSnapshot[] = [
      { Health: "healthy", Service: "postgres-dev", State: "running" },
      { Health: "healthy", Service: "redis-dev", State: "running" },
    ];

    const missing = getMissingServices(snapshots, [
      "postgres-dev",
      "redis-dev",
      "asmob-dev",
    ]);

    expect(missing).toEqual(["asmob-dev"]);
  });

  test("detects unhealthy services by state and health", () => {
    const snapshots: ServiceSnapshot[] = [
      { Health: "healthy", Service: "postgres-dev", State: "running" },
      { Health: "unhealthy", Service: "redis-dev", State: "running" },
      { Health: "", Service: "openobserve-dev", State: "exited" },
    ];

    const unhealthy = getUnhealthyServices(snapshots, [
      "postgres-dev",
      "redis-dev",
      "openobserve-dev",
    ]);

    expect(unhealthy).toEqual([
      "redis-dev (unhealthy)",
      "openobserve-dev (exited)",
    ]);
  });

  test("parses newline-delimited JSON from Docker compose ps", () => {
    const output = [
      JSON.stringify({
        Health: "healthy",
        Service: "postgres-dev",
        State: "running",
      }),
      JSON.stringify({
        Health: "healthy",
        Service: "redis-dev",
        State: "running",
      }),
    ].join("\n");

    const snapshots = parseServiceSnapshots(output);
    expect(snapshots).toEqual([
      {
        Health: "healthy",
        Name: undefined,
        Service: "postgres-dev",
        State: "running",
      },
      {
        Health: "healthy",
        Name: undefined,
        Service: "redis-dev",
        State: "running",
      },
    ]);
  });

  test("parses a JSON array from podman-compose ps", () => {
    const output = JSON.stringify([
      {
        Labels: { "com.docker.compose.service": "postgres-dev" },
        Names: ["asmdb"],
        State: "running",
        Status: "Up 2 hours (healthy)",
      },
      {
        Labels: { "com.docker.compose.service": "asmob-dev" },
        Names: ["asmdev-asmob"],
        State: "stopped",
        Status: "Exited (1) 2 seconds ago",
      },
      {
        Labels: { "com.docker.compose.service": "openobserve-dev" },
        Names: ["asmdev-openobserve"],
        State: "running",
        Status: "Up 2 hours",
      },
    ]);

    const snapshots = parseServiceSnapshots(output);
    expect(snapshots).toEqual([
      {
        Health: "healthy",
        Name: "asmdb",
        Service: "postgres-dev",
        State: "running",
      },
      {
        Health: "",
        Name: "asmdev-asmob",
        Service: "asmob-dev",
        State: "stopped",
      },
      {
        Health: "",
        Name: "asmdev-openobserve",
        Service: "openobserve-dev",
        State: "running",
      },
    ]);
  });

  test("returns an empty list for empty compose ps output", () => {
    expect(parseServiceSnapshots("")).toEqual([]);
    expect(parseServiceSnapshots("   \n  ")).toEqual([]);
  });

  test("uses the top-level Service field over labels", () => {
    const output = JSON.stringify([
      {
        Labels: { "com.docker.compose.service": "ignored" },
        Names: ["custom-name"],
        Service: "postgres-dev",
        State: "running",
      },
    ]);

    const snapshots = parseServiceSnapshots(output);
    expect(snapshots[0]?.Service).toBe("postgres-dev");
  });
});

describe("output validators", () => {
  test("validates postgres schema probe output", () => {
    expect(hasSchemaTables("t\n")).toBe(true);
    expect(hasSchemaTables("f")).toBe(false);
  });

  test("validates redis ping output", () => {
    expect(hasRedisPong("PONG\n")).toBe(true);
    expect(hasRedisPong("ERR invalid password")).toBe(false);
  });

  test("validates openobserve health probe output", () => {
    expect(hasOpenObserveHealth('{"status":"ok"}')).toBe(true);
    expect(hasOpenObserveHealth("")).toBe(false);
  });

  test("finds missing buckets", () => {
    const missing = getMissingBuckets(
      ["uploads", "avatars"],
      ["uploads", "avatars", "temp", "backups"]
    );

    expect(missing).toEqual(["temp", "backups"]);
  });

  test("checks one-shot init completion", () => {
    expect(
      areInitJobsComplete(
        { exists: true, status: "Exited (0) 2 minutes ago" },
        { exists: true, status: "Exited (0) 1 minute ago" }
      )
    ).toBe(true);

    expect(
      areInitJobsComplete(
        { exists: false, status: "" },
        { exists: true, status: "Exited (0) 1 minute ago" }
      )
    ).toBe(false);
  });
});

describe("cache and fingerprint helpers", () => {
  test("keeps runtime fingerprint stable for equivalent snapshots", () => {
    const a: ServiceSnapshot[] = [
      { Health: "healthy", Service: "redis-dev", State: "running" },
      { Health: "healthy", Service: "postgres-dev", State: "running" },
    ];
    const b: ServiceSnapshot[] = [
      { Health: "healthy", Service: "postgres-dev", State: "running" },
      { Health: "healthy", Service: "redis-dev", State: "running" },
    ];

    expect(buildRuntimeFingerprint(a)).toBe(buildRuntimeFingerprint(b));
  });

  test("cache digest is deterministic", () => {
    expect(computeCacheDigest("same-input")).toBe(
      computeCacheDigest("same-input")
    );
    expect(computeCacheDigest("same-input")).not.toBe(
      computeCacheDigest("different-input")
    );
  });

  test("ttl helper identifies cache freshness", () => {
    const now = Date.now();
    expect(withinTtl(now - 500, 1000)).toBe(true);
    expect(withinTtl(now - 1500, 1000)).toBe(false);
  });
});

describe("preflight ui helpers", () => {
  test("formats check states for compact status line", () => {
    expect(formatPreflightCheckState("pending")).toBe("wait");
    expect(formatPreflightCheckState("running")).toBe("...");
    expect(formatPreflightCheckState("ok")).toBe("ok");
    expect(formatPreflightCheckState("cached")).toBe("cache");
    expect(formatPreflightCheckState("failed")).toBe("fail");
  });

  test("builds compact single-line status output", () => {
    const states = new Map<PreflightCheckKey, PreflightCheckState>([
      ...PREFLIGHT_CHECK_ORDER.map((check) => [check.key, "pending"] as const),
      ["services", "ok"] as const,
      ["postgres", "running"] as const,
      ["portless", "cached"] as const,
    ]);

    expect(buildPreflightProgressLine(states)).toBe(
      "preflight svc:ok init:wait pg:... rd:wait obj:wait ozo:wait ptl:cache"
    );
  });
});

describe("portless start helpers", () => {
  test("detects sudo-required messages", () => {
    expect(shouldUseSudoForPortless("Error: Port 443 requires sudo.")).toBe(
      true
    );
    expect(shouldUseSudoForPortless("no TTY is available for sudo")).toBe(true);
    expect(
      shouldUseSudoForPortless(
        "sudo: a terminal is required to read the password"
      )
    ).toBe(true);
    expect(shouldUseSudoForPortless("Proxy started in background")).toBe(false);
  });
});
