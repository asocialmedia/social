import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { auth } from "@/auth/config";
import { appRouter } from "@/server/routers/app";
import { createContext } from "@/server/trpc";

const betterAuthHandler = toNextJsHandler(auth);

function isTrpc(req: NextRequest) {
  return (
    req.nextUrl.pathname.endsWith("/api/auth/pending-signup") ||
    req.nextUrl.pathname.endsWith("/api/auth/pending-verify") ||
    req.nextUrl.pathname.endsWith("/api/auth/pending-resend")
  );
}

function addCorsHeaders(response: Response) {
  const corsHeaders = {
    "Access-Control-Allow-Origin":
      process.env.NODE_ENV === "production"
        ? process.env.NEXT_PUBLIC_URL || "https://asocialmedia.cc"
        : "https://social.localhost",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cache-Control",
    "Access-Control-Allow-Credentials": "true",
  } as const;

  for (const [k, v] of Object.entries(corsHeaders)) {
    response.headers.set(k, v);
  }
  return response;
}

export async function GET(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin":
          process.env.NODE_ENV === "production"
            ? process.env.NEXT_PUBLIC_URL || "https://asocialmedia.cc"
            : "https://social.localhost",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Cache-Control",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  if (isTrpc(req)) {
    const response = await fetchRequestHandler({
      endpoint: "/api/auth",
      req: req as unknown as Request,
      router: appRouter,
      createContext,
    });
    return addCorsHeaders(response);
  }

  const response = await betterAuthHandler.GET(req);
  return addCorsHeaders(response);
}

export async function POST(req: NextRequest) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin":
          process.env.NODE_ENV === "production"
            ? process.env.NEXT_PUBLIC_URL || "https://asocialmedia.cc"
            : "https://social.localhost",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Cache-Control",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  if (isTrpc(req)) {
    const response = await fetchRequestHandler({
      endpoint: "/api/auth",
      req: req as unknown as Request,
      router: appRouter,
      createContext,
    });
    return addCorsHeaders(response);
  }

  const response = await betterAuthHandler.POST(req);
  return addCorsHeaders(response);
}

export function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin":
        process.env.NODE_ENV === "production"
          ? process.env.NEXT_PUBLIC_URL || "https://asocialmedia.cc"
          : "https://social.localhost",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, Cache-Control",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}
