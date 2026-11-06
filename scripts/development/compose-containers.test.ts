import { describe, expect, test } from "bun:test";

import { parseContainerList } from "./compose-containers";

describe("parseContainerList", () => {
  test("reads Docker JSON Lines with string ports and container names", () => {
    const stdout = [
      JSON.stringify({
        Labels: "com.docker.compose.service=postgres-dev",
        Name: "asmdev-postgres",
        Names: "asmdev-postgres",
        Ports: "0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp",
        Service: "postgres-dev",
        State: "running",
        Status: " Up 5 minutes  (healthy) ",
      }),
      "",
      JSON.stringify({
        Names: "asmdev-redis",
        Ports: "",
        Service: "redis-dev",
      }),
    ].join("\r\n");

    expect(parseContainerList(stdout)).toEqual([
      {
        name: "asmdev-postgres",
        ports: "0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp",
        service: "postgres-dev",
        state: "running",
        status: "Up 5 minutes (healthy)",
      },
      {
        name: "asmdev-redis",
        ports: "",
        service: "redis-dev",
        state: "",
        status: "",
      },
    ]);
  });

  test("preserves Podman JSON arrays with structured ports and labels", () => {
    const stdout = JSON.stringify([
      {
        Labels: { "com.docker.compose.service": "postgres-dev" },
        Names: ["asmdev-postgres"],
        Ports: [
          { container_port: 5432, host_port: 5433 },
          { container_port: 5434 },
        ],
        State: "running",
        Status: "Up 5 minutes",
      },
    ]);

    expect(parseContainerList(stdout)).toEqual([
      {
        name: "asmdev-postgres",
        ports: "5433->5432, 5434",
        service: "postgres-dev",
        state: "running",
        status: "Up 5 minutes",
      },
    ]);
  });

  test("reads Docker JSON arrays with Name and Publishers fields", () => {
    expect(
      parseContainerList(
        JSON.stringify([
          {
            Name: "asmdev-postgres",
            Publishers: [{ PublishedPort: 5433, TargetPort: 5432 }],
            Service: "postgres-dev",
          },
          { Name: "asmdev-init", Publishers: null, Service: "postgres-init" },
        ])
      ).map(({ name, ports }) => ({ name, ports }))
    ).toEqual([
      { name: "asmdev-postgres", ports: "5433->5432" },
      { name: "asmdev-init", ports: "" },
    ]);
  });

  test("reads string labels when the service field is absent", () => {
    expect(
      parseContainerList(
        JSON.stringify({
          Labels: "other=value,com.docker.compose.service=redis-dev,last=value",
          Names: "asmdev-redis",
        })
      )[0]?.service
    ).toBe("redis-dev");
  });

  test("falls back to the service name and tolerates missing fields", () => {
    expect(parseContainerList('{"Service":"postgres-init"}\n{}')).toEqual([
      {
        name: "postgres-init",
        ports: "",
        service: "postgres-init",
        state: "",
        status: "",
      },
      { name: "unknown", ports: "", service: "unknown", state: "", status: "" },
    ]);
  });

  test("returns no containers for empty or invalid JSON output", () => {
    for (const stdout of ["", " \r\n ", "[]", "not json", "{}\ninvalid"]) {
      expect(parseContainerList(stdout)).toEqual([]);
    }
  });
});
