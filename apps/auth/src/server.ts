import { loadRootEnv } from "./env";

if (import.meta.main) {
  loadRootEnv();

  const port = Number(process.env.PORT ?? 3001);

  const { initTelemetry, createLogger } = await import("@asm/logger");
  const telemetry = initTelemetry({ serviceName: "auth", version: "1.0.0" });

  const [{ auth }, { appRouter }, { createContext }, { createHttpHandler }] =
    await Promise.all([
      import("./auth/config"),
      import("./server/app"),
      import("./server/trpc"),
      import("./http"),
    ]);
  const [{ createSecurity }, { readSecurityConfig }] = await Promise.all([
    import("./security"),
    import("./security/config"),
  ]);
  const { getClientIpFromHeaders } = await import("./security/client-ip");

  const logger = createLogger({ serviceName: "auth" });
  const securityConfig = readSecurityConfig();

  // Keep per-IP rate-limit budgets in Redis when available so they survive
  // restarts and deploys; fall back to the in-memory store otherwise.
  let securityStore;
  if (process.env.REDIS_URL) {
    const { createRedisRateLimitStore } =
      await import("./security/redis-store");
    const { getRedisClient } = await import("@asm/db");
    securityStore = createRedisRateLimitStore(getRedisClient);
    logger.info("security: using redis-backed rate limit store");
  }
  const security = createSecurity(securityConfig, securityStore);

  let activeRequests = 0;

  const getClientIp = (request: Request): string => {
    // Trusted-ingress policy: Cloudflare-provided headers first (set for every
    // request Cloudflare forwards), then the LAST x-forwarded-for entry, which
    // the web app's internal proxy sets from ITS trusted ingress. Only fall
    // back to the socket address for direct callers.
    const trusted = getClientIpFromHeaders(request.headers);
    if (trusted !== "unknown") {
      return trusted;
    }
    const socketIp = server?.requestIP(request)?.address;
    if (socketIp) {
      return socketIp;
    }
    return "unknown";
  };

  const { fetchRequestHandler: trpcFetchHandler } =
    await import("@trpc/server/adapters/fetch");

  const handleRequest = createHttpHandler({
    appRouter,
    authInstance: auth,
    createContext,
    getClientIp,
    logger,
    security,
    trpcFetchHandler,
  });

  const server = Bun.serve({
    fetch: async (request: Request) => {
      // Cap concurrent in-flight requests to shed load under a flood.
      if (activeRequests >= securityConfig.maxConcurrentRequests) {
        return Response.json(
          { error: "too-many-requests" },
          {
            headers: { "content-type": "application/json" },
            status: 429,
          }
        );
      }

      activeRequests += 1;
      try {
        return await handleRequest(request);
      } finally {
        activeRequests -= 1;
      }
    },
    hostname: "0.0.0.0",
    idleTimeout: Math.min(securityConfig.requestTimeoutMs, 255_000) / 1000,
    maxRequestBodySize: securityConfig.maxBodyBytes,
    port,
  });

  logger.info({ port }, "auth service listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down auth service");
    server?.stop();
    await telemetry.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void (async () => {
      try {
        await shutdown("SIGINT");
      } catch (error: unknown) {
        logger.error({ error }, "shutdown failed");
        process.exit(1);
      }
    })();
  });
  process.on("SIGTERM", () => {
    void (async () => {
      try {
        await shutdown("SIGTERM");
      } catch (error: unknown) {
        logger.error({ error }, "shutdown failed");
        process.exit(1);
      }
    })();
  });
}
