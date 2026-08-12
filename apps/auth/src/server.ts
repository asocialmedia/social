import { loadRootEnv } from "./env-load";

if (import.meta.main) {
  loadRootEnv();

  const port = Number(process.env.PORT ?? 3001);

  const [{ auth }, { appRouter }, { createContext }, { createHttpHandler }] =
    await Promise.all([
      import("./auth/config"),
      import("./server/routers/app"),
      import("./server/trpc"),
      import("./http"),
    ]);

  const handleRequest = createHttpHandler({
    authInstance: auth,
    appRouter,
    createContext,
    trpcFetchHandler: (await import("@trpc/server/adapters/fetch"))
      .fetchRequestHandler,
  });

  Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: handleRequest,
  });

  console.log(`Auth service listening on http://0.0.0.0:${port}`);
}
