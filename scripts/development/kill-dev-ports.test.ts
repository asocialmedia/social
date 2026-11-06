import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";

import {
  DEV_PORTS,
  findListeningPids,
  killStaleDevProcesses,
} from "./kill-dev-ports";
import { hasListenerOnPort } from "./tcp-port";

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
      expect(
        await findListeningPids([address.port], [process.pid])
      ).not.toContain(process.pid);
    } finally {
      server.close();
    }
  });

  test("killStaleDevProcesses executes without error when ports are free", async () => {
    await expect(killStaleDevProcesses([39877])).resolves.toBeUndefined();
  });

  test("terminates a stale server and releases its port", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        'const server = Bun.serve({ port: 0, fetch: () => new Response("ok") }); console.log(server.port);',
      ],
      { stdout: "pipe", stderr: "inherit" }
    );
    try {
      let output = "";
      for await (const chunk of child.stdout) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("\n")) break;
      }
      const port = Number(output.trim());
      expect(port).toBeGreaterThan(0);
      expect(await hasListenerOnPort(port)).toBe(true);
      await killStaleDevProcesses([port]);
      await child.exited;
      expect(await hasListenerOnPort(port)).toBe(false);
    } finally {
      child.kill();
      await child.exited;
    }
  }, 10_000);
});
