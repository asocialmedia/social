import type { AnyRouter } from "@trpc/server";
import type {
  FetchCreateContextFn,
  fetchRequestHandler,
} from "@trpc/server/adapters/fetch";

export interface AuthInstance {
  api: {
    getSession: (opts: { headers: Headers }) => Promise<unknown>;
  };
  handler: (request: Request) => Promise<Response>;
}

export interface HttpHandlerDeps {
  appRouter: AnyRouter;
  authInstance: AuthInstance;
  createContext: FetchCreateContextFn<AnyRouter>;
  trpcFetchHandler: typeof fetchRequestHandler;
}

const TRPC_AUTH_PATHS = [
  "/api/auth/pending-signup",
  "/api/auth/pending-verify",
  "/api/auth/pending-resend",
];

export function getAllowedOrigin(): string {
  return process.env.NODE_ENV === "production"
    ? process.env.APP_URL || "https://asocialmedia.cc"
    : "https://social.localhost";
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cache-Control",
    "Access-Control-Allow-Credentials": "true",
  };
}

function addCorsHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

function isTrpcPath(pathname: string): boolean {
  return TRPC_AUTH_PATHS.some((path) => pathname.endsWith(path));
}

export function createHttpHandler(deps: HttpHandlerDeps) {
  const { authInstance, appRouter, createContext, trpcFetchHandler } = deps;

  async function handleTrpc(
    request: Request,
    endpoint: string
  ): Promise<Response> {
    const response = await trpcFetchHandler({
      endpoint,
      req: request,
      router: appRouter,
      createContext,
      onError({ error, path, input }) {
        console.error("tRPC error", { path, message: error.message, input });
      },
    });
    return addCorsHeaders(response);
  }

  async function handleGetSession(request: Request): Promise<Response> {
    const session = await authInstance.api.getSession({
      headers: request.headers,
    });
    return new Response(JSON.stringify(session), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        ...corsHeaders(),
      },
    });
  }

  return async function handleRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (pathname === "/api/auth/get-session") {
      return handleGetSession(request);
    }

    if (pathname.startsWith("/api/trpc")) {
      return handleTrpc(request, "/api/trpc");
    }

    if (pathname.startsWith("/api/auth")) {
      if (isTrpcPath(pathname)) {
        return handleTrpc(request, "/api/auth");
      }
      const response = await authInstance.handler(request);
      return addCorsHeaders(response);
    }

    return new Response("Not Found", { status: 404 });
  };
}
