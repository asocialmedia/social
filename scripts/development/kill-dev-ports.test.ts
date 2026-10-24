import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";

import {
  DEV_PORTS,
  findListeningPids,
  killStaleDevProcesses,
} from "./kill-dev-ports";

describe("kill-dev-ports", () => {
  test("defines the expected development ports", () => {
    expect(DEV_PORTS).toContain(3000);
    expect(DEV_PORTS).toContain(3001);
    expect(DEV_PORTS).toContain(3010);
    expect(DEV_PORTS).toContain(3012);
  });

  test("detects a running server pid on a custom port", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a listening TCP port");
      }
      const pids = await findListeningPids([address.port], []);
      expect(pids).toContain(process.pid);
    } finally {
      server.close();
    }
  });

  test("killStaleDevProcesses executes without error when ports are free", async () => {
    await expect(killStaleDevProcesses([39877])).resolves.toBeUndefined();
  });
});
