import { expect, test } from "bun:test";
import { createServer } from "node:net";

import { hasListenerOnPort } from "./tcp-port";

test.each(["127.0.0.1", "::1"])(
  "detects a reachable listener on %s and rejects its closed port",
  async (host) => {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP address");
    }
    try {
      expect(await hasListenerOnPort(address.port)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    expect(await hasListenerOnPort(address.port)).toBe(false);
  }
);
