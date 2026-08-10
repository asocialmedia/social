import type { NextRequest } from "next/server";
import { auth } from "@/auth/config";

export const dynamic = "force-dynamic";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      process.env.NODE_ENV === "production"
        ? process.env.NEXT_PUBLIC_URL || "https://asocialmedia.cc"
        : "https://social.localhost",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  } as const;
}

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });

  return new Response(JSON.stringify(session), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      ...corsHeaders(),
    },
  });
}
