// Workers need a writable connection; the HTTP health server can start while Redis reconnects.
export async function waitForStorageReady(
  connection: {
    status: string;
    on: (event: "ready", listener: () => void) => unknown;
    off: (event: "ready", listener: () => void) => unknown;
  },
  signal: AbortSignal
): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }
  if (connection.status === "ready") {
    return true;
  }
  // oxlint-disable-next-line promise/avoid-new -- adapt ioredis readiness and shutdown into one cancellable wait.
  return await new Promise<boolean>((resolve) => {
    const finish = () => {
      connection.off("ready", finish);
      signal.removeEventListener("abort", finish);
      resolve(!signal.aborted && connection.status === "ready");
    };
    connection.on("ready", finish);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted || connection.status === "ready") {
      finish();
    }
  });
}
