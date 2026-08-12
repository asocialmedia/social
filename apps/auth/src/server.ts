import { loadRootEnv } from "./env-load";

if (import.meta.main) {
  loadRootEnv();

  const port = Number(process.env.PORT ?? 3001);

  const { initTelemetry, createLogger } = await import("@asm/logger");
  const telemetry = initTelemetry({ serviceName: "auth", version: "1.0.0" });

  const [{ auth }, { appRouter }, { createContext }, { createHttpHandler }] =
    await Promise.all([
      import("./auth/config"),
      import("./server/routers/app"),
      import("./server/trpc"),
      import("./http"),
    ]);

  const logger = createLogger({ serviceName: "auth" });

  const handleRequest = createHttpHandler({
    authInstance: auth,
    appRouter,
    createContext,
    trpcFetchHandler: (await import("@trpc/server/adapters/fetch"))
      .fetchRequestHandler,
    logger,
  });

  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: handleRequest,
  });

  logger.info({ port }, "auth service listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down auth service");
    server.stop();
    await telemetry.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error: unknown) => {
      logger.error({ error }, "shutdown failed");
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error: unknown) => {
      logger.error({ error }, "shutdown failed");
      process.exit(1);
    });
  });
}
