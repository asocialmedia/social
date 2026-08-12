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

export interface HttpLogger {
  debug: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface HttpHandlerDeps {
  appRouter: AnyRouter;
  authInstance: AuthInstance;
  createContext: FetchCreateContextFn<AnyRouter>;
  logger?: HttpLogger;
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

// A no-op logger used when one is not injected, so the handler stays
// dependency-injected and trivially testable.
const noopLogger: HttpLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createHttpHandler(deps: HttpHandlerDeps) {
  const { authInstance, appRouter, createContext, trpcFetchHandler } = deps;
  const log = deps.logger ?? noopLogger;

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
        log.error(
          { path, message: error.message, input },
          "tRPC request failed"
        );
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
    const startedAt = Date.now();

    let response: Response;
    try {
      if (request.method === "OPTIONS") {
        response = new Response(null, { status: 200, headers: corsHeaders() });
      } else if (pathname === "/api/auth/get-session") {
        response = await handleGetSession(request);
      } else if (pathname.startsWith("/api/trpc")) {
        response = await handleTrpc(request, "/api/trpc");
      } else if (pathname.startsWith("/api/auth")) {
        if (isTrpcPath(pathname)) {
          response = await handleTrpc(request, "/api/auth");
        } else {
          response = await authInstance.handler(request);
          response = addCorsHeaders(response);
        }
      } else {
        response = new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ pathname, message }, "request handler threw");
      response = new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { "content-type": "application/json", ...corsHeaders() },
        }
      );
    }

    log.info(
      {
        method: request.method,
        path: pathname,
        status: response.status,
        duration_ms: Date.now() - startedAt,
        request_id: request.headers.get("x-request-id") ?? undefined,
      },
      "request completed"
    );

    return response;
  };
}
