import type { BetterAuthPlugin } from "better-auth";

export function socialUsername({
  isReserved,
}: {
  isReserved: (username: string) => boolean;
}): BetterAuthPlugin {
  return {
    id: "social-username",
    init(context) {
      return {
        options: {
          databaseHooks: {
            user: {
              create: {
                async before(user, endpoint) {
                  const path = endpoint?.path;
                  if (
                    !path ||
                    (!path.startsWith("/callback/") &&
                      path !== "/sign-in/social" &&
                      path !== "/oauth-proxy-callback")
                  ) {
                    return;
                  }
                  const requested = "username" in user ? user.username : null;
                  if (typeof requested !== "string" || !requested.trim()) {
                    return;
                  }
                  const normalized = requested.trim().toLowerCase();
                  const base = (
                    normalized.length < 3 ? `${normalized}_user` : normalized
                  ).slice(0, 30);
                  for (let attempt = 1; attempt <= 50; attempt += 1) {
                    let suffix = "";
                    if (attempt > 1 && attempt < 10) {
                      suffix = String(attempt);
                    } else if (attempt >= 10) {
                      suffix = `_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
                    }
                    const candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`;
                    if (isReserved(candidate)) {
                      continue;
                    }
                    // oxlint-disable-next-line no-await-in-loop -- each candidate must be checked before choosing the next
                    const existing = await context.adapter.findOne({
                      model: "user",
                      where: [{ field: "username", value: candidate }],
                    });
                    if (!existing) {
                      return { data: { ...user, username: candidate } };
                    }
                  }
                  throw new Error(
                    "Unable to assign an available social username"
                  );
                },
              },
            },
          },
        },
      };
    },
  };
}
