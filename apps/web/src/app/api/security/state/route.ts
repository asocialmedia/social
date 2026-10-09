import { prisma } from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";

function noStoreJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    headers: { "cache-control": "no-store, private, max-age=0" },
    status,
  });
}

// Read-only security facts the settings screen needs but the session payload
// does not carry: whether an authenticator (TOTP) credential is verified, the
// linked social providers, and whether a password exists. Web reads these
// server-side in `settings/page.tsx`; native has no server render, so it asks
// this route. Nothing here is sensitive beyond the account's own state.
export async function GET(): Promise<Response> {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const userId = session.user.id;
  const [twoFactor, accounts] = await Promise.all([
    prisma.orm.public.TwoFactor.select("verified").where({ userId }).first(),
    prisma.orm.public.Accounts.select("providerId").where({ userId }).all(),
  ]);

  const providers = accounts
    .map((account) => account.providerId)
    .filter(
      (providerId): providerId is "google" | "reddit" =>
        providerId === "google" || providerId === "reddit"
    );

  return noStoreJson({
    hasAuthenticatorApp: Boolean(twoFactor?.verified),
    hasPassword: accounts.some(
      (account) => account.providerId === "credential"
    ),
    linkedProviders: providers,
  });
}
