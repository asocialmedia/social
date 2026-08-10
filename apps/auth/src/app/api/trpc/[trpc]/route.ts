import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers/app";
import { createContext } from "@/server/trpc";

export const dynamic = "force-dynamic";

const handler = async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin":
          process.env.NODE_ENV === "production"
            ? process.env.NEXT_PUBLIC_URL || "https://asocialmedia.cc"
            : "https://social.localhost",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext,
    onError({
      error,
      path,
      input,
    }: {
      error: Error;
      path?: string;
      input: unknown;
    }) {
      console.error("tRPC error", {
        path,
        message: error.message,
        input,
      });
    },
  });

  const corsHeaders = {
    "Access-Control-Allow-Origin":
      process.env.NODE_ENV === "production"
        ? process.env.NEXT_PUBLIC_URL || "https://asocialmedia.cc"
        : "https://social.localhost",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };

  const corsResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers),
      ...corsHeaders,
    },
  });

  return corsResponse;
};

export { handler as GET, handler as POST, handler as OPTIONS };
