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
  const [{ createSecurity }, { readSecurityConfig }] = await Promise.all([
    import("./security"),
    import("./security-config"),
  ]);

  const logger = createLogger({ serviceName: "auth" });
  const securityConfig = readSecurityConfig();
  const security = createSecurity(securityConfig);

  let server: ReturnType<typeof Bun.serve> | undefined;
  let activeRequests = 0;

  const getClientIp = (request: Request): string => {
    // The web app proxies browser traffic to auth, so the real client address
    // is in x-forwarded-for. Direct callers without the internal secret are
    // rejected earlier, so trusting this header is safe here.
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() || "unknown";
    }
    const socketIp = server?.requestIP(request)?.address;
    if (socketIp) {
      return socketIp;
    }
    return request.headers.get("x-real-ip") ?? "unknown";
  };

  const handleRequest = createHttpHandler({
    authInstance: auth,
    appRouter,
    createContext,
    trpcFetchHandler: (await import("@trpc/server/adapters/fetch"))
      .fetchRequestHandler,
    logger,
    security,
    getClientIp,
  });

  server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    maxRequestBodySize: securityConfig.maxBodyBytes,
    idleTimeout: Math.min(securityConfig.requestTimeoutMs, 255_000) / 1000,
    fetch: async (request: Request) => {
      // Cap concurrent in-flight requests to shed load under a flood.
      if (activeRequests >= securityConfig.maxConcurrentRequests) {
        return new Response(JSON.stringify({ error: "too-many-requests" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }

      activeRequests += 1;
      try {
        return await handleRequest(request);
      } finally {
        activeRequests -= 1;
      }
    },
  });

  logger.info({ port }, "auth service listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down auth service");
    server?.stop();
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
