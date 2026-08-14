import type { AnyRouter } from "@trpc/server";
import type {
  FetchCreateContextFn,
  fetchRequestHandler,
} from "@trpc/server/adapters/fetch";

import type { Security } from "../security";
import { securityHeaders } from "../security";

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
  getClientIp?: (request: Request) => string;
  logger?: HttpLogger;
  security?: Security;
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
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cache-Control",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": getAllowedOrigin(),
  };
}

function addCorsHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(corsHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

function addSecurityHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(securityHeaders())) {
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
  debug: () => {
    /* empty */
  },
  error: () => {
    /* empty */
  },
  info: () => {
    /* empty */
  },
  warn: () => {
    /* empty */
  },
};

export function createHttpHandler(deps: HttpHandlerDeps) {
  const {
    authInstance,
    appRouter,
    createContext,
    trpcFetchHandler,
    getClientIp = () => "unknown",
    security,
  } = deps;
  const log = deps.logger ?? noopLogger;

  async function handleTrpc(
    request: Request,
    endpoint: string
  ): Promise<Response> {
    const response = await trpcFetchHandler({
      createContext,
      endpoint,
      onError({ error, path, input }) {
        log.error(
          { input, message: error.message, path },
          "tRPC request failed"
        );
      },
      req: request,
      router: appRouter,
    });
    return addCorsHeaders(response);
  }

  async function handleGetSession(request: Request): Promise<Response> {
    const session = await authInstance.api.getSession({
      headers: request.headers,
    });
    return Response.json(session, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        ...corsHeaders(),
      },
      status: 200,
    });
  }

  async function route(request: Request, pathname: string): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(), status: 204 });
    }
    if (pathname === "/api/health") {
      return Response.json(
        {
          service: "auth",
          status: "ok",
          timestamp: new Date().toISOString(),
        },
        { status: 200 }
      );
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
      return addCorsHeaders(await authInstance.handler(request));
    }
    return new Response("Not Found", { status: 404 });
  }

  return async function handleRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const startedAt = Date.now();

    let response: Response;
    try {
      if (security) {
        const ip = getClientIp(request);
        const decision = security.check(request, ip);
        if (!decision.allowed) {
          return addSecurityHeaders(
            addCorsHeaders(
              decision.response ?? new Response("Forbidden", { status: 403 })
            )
          );
        }
      }

      response = await route(request, pathname);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ message, pathname }, "request handler threw");
      response = Response.json(
        { error: "Internal server error" },
        {
          headers: { "content-type": "application/json", ...corsHeaders() },
          status: 500,
        }
      );
    }

    log.info(
      {
        duration_ms: Date.now() - startedAt,
        method: request.method,
        path: pathname,
        request_id: request.headers.get("x-request-id") ?? undefined,
        status: response.status,
      },
      "request completed"
    );

    return addSecurityHeaders(response);
  };
}
