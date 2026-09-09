import { z } from "zod";

import { signUp } from "@/app/(auth)/signup/actions";

const signupRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(256),
  turnstileToken: z.string().min(1).max(4096),
  username: z.string().min(3).max(32),
});

// Keep credentials out of Next's Server Action development trace. The route
// validates and forwards the same server-only operation, while Turnstile is
// still verified before the auth service is contacted.
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => { /* empty */ });
  const parsed = signupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Check your signup details and try again.", success: false },
      { status: 400 }
    );
  }

  const result = await signUp(parsed.data);
  return Response.json(result, { status: result.success ? 200 : 400 });
}
