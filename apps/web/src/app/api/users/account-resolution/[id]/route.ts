import {
  AccountResolutionError,
  consumeRateLimit,
  deleteAccountResolutionState,
} from "@asm/db";
import { z } from "zod";

import {
  finishAccountResolution,
  getAccountReview,
  loadAccountReview,
  setupAccountForResolution,
  verifyAccountForResolution,
} from "@/lib/auth/account-resolution";
import {
  authInternalHeaders,
  getAuthBaseUrl,
  resolveAppOrigin,
} from "@/lib/auth/auth-internal";
import { getSessionFromApi } from "@/lib/auth/session";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }).strict(),
  z
    .object({
      action: z.literal("verify"),
      code: z.string().max(100).optional(),
      method: z.enum(["totp", "backup-code", "otp", "send-otp"]).optional(),
      password: z.string().max(256).optional(),
      side: z.enum(["current", "other"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("code"),
      email: z.email().max(254),
      otp: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
      side: z.enum(["current", "other"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("setup"),
      password: z.string().min(8).max(256).optional(),
      side: z.enum(["current", "other"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve"),
      confirmation: z.string().min(1).max(100),
      keepUserId: z.string().min(1),
      mode: z.enum(["merge", "discard"]),
    })
    .strict(),
]);

interface Context {
  params: Promise<{ id: string }>;
}

async function handle(request: Request, context: Context) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json(
      { error: "Sign in to review these accounts." },
      { status: 401 }
    );
  }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "Invalid account review." }, { status: 400 });
  }
  if (request.method !== "GET" && !request.headers.get("authorization")) {
    const origin = request.headers.get("origin");
    if (origin !== new URL(resolveAppOrigin()).origin) {
      return Response.json(
        { error: "Invalid request origin." },
        { status: 403 }
      );
    }
  }
  try {
    const pending = await loadAccountReview(
      id,
      session.user.id,
      session.session.id
    );
    if (request.method === "GET") {
      return Response.json(await getAccountReview(id, pending.state), {
        headers: { "cache-control": "no-store" },
      });
    }
    const rate = await consumeRateLimit({
      bucket: "account-resolution",
      identifier: session.user.id,
      limit: 30,
      windowSeconds: 300,
    });
    if (!rate.allowed) {
      return Response.json(
        { error: "Too many attempts. Please wait a few minutes." },
        { status: 429 }
      );
    }
    const parsed = actionSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid account review action." },
        { status: 400 }
      );
    }
    const input = parsed.data;
    if (input.action === "cancel") {
      await deleteAccountResolutionState(id);
      return Response.json({ cancelled: true });
    }
    if (input.action === "code") {
      const response = await fetch(
        `${getAuthBaseUrl()}/api/auth/account-resolution/code`,
        {
          body: JSON.stringify({
            email: input.email,
            id,
            otp: input.otp,
            side: input.side,
          }),
          headers: authInternalHeaders({
            "content-type": "application/json",
            cookie: request.headers.get("cookie") ?? "",
            ...(request.headers.get("authorization")
              ? { authorization: request.headers.get("authorization") ?? "" }
              : {}),
          }),
          method: "POST",
        }
      );
      const data: unknown = await response.json();
      return Response.json(data, { status: response.status });
    }
    if (input.action === "verify") {
      return Response.json(
        await verifyAccountForResolution(id, pending, input.side, input)
      );
    }
    if (input.action === "setup") {
      await setupAccountForResolution(id, pending, input.side, input.password);
      return Response.json({ saved: true });
    }
    const result = await finishAccountResolution(id, pending, input);
    return Response.json({ complete: true, ...result });
  } catch (error) {
    if (error instanceof AccountResolutionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    // Never serialize database records, password hashes, or temporary 2FA cookies into an API error.
    console.error(
      "Account resolution failed",
      error instanceof Error ? error.name : "unknown"
    );
    return Response.json(
      {
        error:
          "Could not confirm the result of this account review. Refresh or sign in again before retrying.",
      },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
