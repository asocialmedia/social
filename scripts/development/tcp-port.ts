import { createConnection } from "node:net";

function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (connected: boolean) => {
      socket.destroy();
      resolve(connected);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(2000, () => finish(false));
  });
}

export async function hasListenerOnPort(
  port: number,
  hosts: readonly string[] = ["127.0.0.1", "::1"]
): Promise<boolean> {
  const results = await Promise.all(
    hosts.map((host) => canConnect(port, host))
  );
  return results.some(Boolean);
}
