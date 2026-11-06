import { expect, test } from "bun:test";
import { createServer } from "node:net";

import { hasListenerOnPort } from "./tcp-port";

async function ipv6Available(): Promise<boolean> {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "::1", resolve);
    });
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT"].includes(
        String(error.code)
      )
    ) {
      return false;
    }
    throw error;
  } finally {
    if (probe.listening) {
      await new Promise<void>((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
}

const supportsIPv6 = await ipv6Available();
for (const host of ["127.0.0.1", "::1"]) {
  test.skipIf(host === "::1" && !supportsIPv6)(
    `detects a reachable listener on ${host} and rejects its closed port`,
    async () => {
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
}
