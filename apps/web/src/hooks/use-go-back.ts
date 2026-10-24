"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

// The app's one "go back" rule: return to where the reader came from when there
// is a prior entry, and land on the home feed when the page was opened directly
// from a URL. Post, profile and settings all follow it, so bookmarks, messages
// and notifications use this hook instead of each writing their own copy.
export function useGoBack(fallbackHref = "/") {
  const router = useRouter();
  return useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [fallbackHref, router]);
}
