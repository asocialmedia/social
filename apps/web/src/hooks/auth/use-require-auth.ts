"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { useSession } from "@/app/(main)/session-provider";

// Shared guest-mode guard: interactive buttons that need an account use this
// to bounce to the login page (preserving the current route) instead of firing
// a mutation that would 401.
export function useRequireAuth() {
  const { user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const goToLogin = useCallback(() => {
    const query = searchParams.toString();
    const current = query ? `${pathname}?${query}` : pathname;
    router.push(`/login?next=${encodeURIComponent(current)}`);
  }, [pathname, router, searchParams]);

  return { goToLogin, isLoggedIn: Boolean(user), user };
}
