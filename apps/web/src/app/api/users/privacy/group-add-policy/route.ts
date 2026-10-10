import { isGroupAddPolicy, prisma } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

// The reader's own group-add setting.
//
// GET and PATCH together on one path because the value is a single column with a
// single meaning, and the mobile app has no reason to learn two URLs for it.
//
// Mobile calls this through the same base URL the rest of its settings use, so
// there is one server contract for the setting rather than a web route and a
// native route that can disagree about what the values are.
const groupAddPolicySchema = z.object({
  groupAddPolicy: z
    .string()
    // The shared guard rather than a zod enum, so the list of accepted values
    // exists once. A zod enum here would be a second copy of the contract enum,
    // and the copy that rots.
    .refine(isGroupAddPolicy, "Choose one of the available options"),
});

export async function GET() {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.orm.public.Users.select("groupAddPolicy")
    .where({ id: userId })
    .first();
  if (!row) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }
  return Response.json({ groupAddPolicy: row.groupAddPolicy });
}

export async function PATCH(request: Request) {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = groupAddPolicySchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid setting" },
      { status: 400 }
    );
  }

  const updated = await prisma.orm.public.Users.where({ id: userId }).update({
    groupAddPolicy: parsed.data.groupAddPolicy,
  });
  // A session can outlive the account it names. Answering with the new value
  // would then be a claim about a row that is not there, and the client would
  // cache a setting nobody is holding.
  if (!updated) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }
  // The session carries a copy of the user, and the mobile settings screen reads
  // the setting back through it after a save, so a stale session would show the
  // old choice until the next sign-in.
  return Response.json({ groupAddPolicy: updated.groupAddPolicy, ok: true });
}
