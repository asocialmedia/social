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

// Matches better-auth's provider callback endpoints
// (/api/auth/callback/google, /api/auth/callback/reddit, ...).
const OAUTH_CALLBACK_PATTERN = /^\/api\/auth\/callback\/[a-z-]+$/;

// Allowed origins are derived from env — no hardcoded prod URLs.
// Local-only origins are explicitly dev-only and never accepted in production.
const DEV_ONLY_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
] as const;

function getProdOrigins(): string[] {
  return [
    process.env.APP_URL,
    process.env.AUTH_URL,
    process.env.NEXT_PUBLIC_URL,
    process.env.NEXT_PUBLIC_AUTH_URL,
  ].filter((v): v is string => Boolean(v));
}

function getAllowedOriginsSet(): Set<string> {
  return new Set<string>([
    ...getProdOrigins(),
    ...(process.env.NODE_ENV === "production" ? [] : DEV_ONLY_ORIGINS),
  ]);
}

export function getAllowedOrigin(request?: Request): string {
  const allowed = getAllowedOriginsSet();
  const origin = request?.headers.get("origin")?.replace(/\/+$/, "");
  if (origin && allowed.has(origin)) {
    return origin;
  }
  // Fallback for server-to-server calls without Origin (internal secret)
  if (!origin) {
    if (!allowed.size) {
      return process.env.APP_URL || process.env.AUTH_URL || "";
    }
    // In dev, prefer the local dev origin for internal calls
    if (
      process.env.NODE_ENV !== "production" &&
      allowed.has("http://localhost:3000")
    ) {
      return "http://localhost:3000";
    }
    return [...allowed][0] || "";
  }
  const prodFallback =
    process.env.APP_URL ||
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_AUTH_URL ||
    [...allowed][0] ||
    "";
  if (!prodFallback) {
    return "";
  }
  return process.env.NODE_ENV === "production"
    ? prodFallback
    : "http://localhost:3000";
}

export function corsHeaders(request?: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cache-Control, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": getAllowedOrigin(request),
    Vary: "Origin",
  };
}

function addCorsHeaders(response: Response, request?: Request): Response {
  for (const [key, value] of Object.entries(corsHeaders(request))) {
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
    return addCorsHeaders(response, request);
  }

  async function handleGetSession(request: Request): Promise<Response> {
    const session = await authInstance.api.getSession({
      headers: request.headers,
    });
    return Response.json(session, {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        ...corsHeaders(request),
      },
      status: 200,
    });
  }

  async function route(request: Request, pathname: string): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request), status: 204 });
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
      let authRequest = request;
      const origin = request.headers.get("origin");
      const hasSecret = Boolean(request.headers.get("x-internal-secret"));

      // Server-to-server calls carrying the internal secret may lack an Origin
      // header. Better Auth requires an Origin for CSRF checks on mutating requests;
      // synthesize the trusted origin so internal calls succeed without triggering
      // a "Missing or null Origin" rejection.
      if (!origin && hasSecret) {
        const allowedOrigin = getAllowedOrigin();
        const nextHeaders = new Headers(request.headers);
        nextHeaders.set("origin", allowedOrigin);
        if (!nextHeaders.has("referer")) {
          nextHeaders.set("referer", `${allowedOrigin}/`);
        }
        authRequest = new Request(request, { headers: nextHeaders });
      }

      const response = addCorsHeaders(
        await authInstance.handler(authRequest),
        request
      );
      if (OAUTH_CALLBACK_PATTERN.test(pathname)) {
        // A callback that passes validation ALSO answers with a 302 - it
        // redirects onward to the web app's callbackURL. Distinguish the two
        // by inspecting the Location header: a redirect to /api/auth/error is
        // a rejection (state mismatch, expired flow, provider error); any
        // other redirect means the provider round-trip succeeded and the
        // session is being handed to the web app.
        const provider = pathname.split("/").at(-1);
        const state = new URL(request.url).searchParams.get("state");
        const location = response.headers.get("location") ?? "";
        const failed = location.includes("/api/auth/error");
        if (failed) {
          log.error(
            {
              has_state: Boolean(state),
              location,
              provider,
              status: response.status,
            },
            "oauth callback rejected"
          );
        } else {
          log.info(
            { location, provider, status: response.status },
            "oauth callback accepted"
          );
        }
      }
      return response;
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
        const decision = await security.check(request, ip);
        if (!decision.allowed) {
          return addSecurityHeaders(
            addCorsHeaders(
              decision.response ?? new Response("Forbidden", { status: 403 }),
              request
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
          headers: {
            "content-type": "application/json",
            ...corsHeaders(request),
          },
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
