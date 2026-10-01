// Resume + hydration gates for cold start.
// ResumeGate hydrates the persisted feed cache once per launch so the home
// feed paints cached rows instantly, then restores the last route (stale-
// while-revalidate: cached content shows now, network refreshes behind it).
// ResumeSaver persists every navigation for the next cold start.
// Both are best-effort and never block rendering.
import { usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { hydrateFeedCache } from "@/features/feed/state/feed-store";
import { loadResumeRoute, saveResumeRoute } from "@/lib/app-resume";

// Hydrates disk caches once. Runs outside the splash gate so the first paint
// can already read restored tabs.
export function HydrateGate() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) {
      return;
    }
    done.current = true;
    void hydrateFeedCache();
  }, []);
  return null;
}

// Restores the last route once, after the navigator mounts. Only replaces
// when the stored route differs from the current one, and only once per
// launch so deep links arriving later are never hijacked.
export function ResumeGate() {
  const router = useRouter();
  const pathname = usePathname();
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) {
      return;
    }
    restored.current = true;
    void (async () => {
      try {
        const resume = await loadResumeRoute();
        if (!resume) {
          return;
        }
        if (resume.pathname === pathname) {
          return;
        }
        // String href keeps typed-route checking out of the way: the stored
        // pathname is runtime data, not a literal the compiler can verify.
        const params = resume.params ?? {};
        const query = Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join("&");
        const href = query ? `${resume.pathname}?${query}` : resume.pathname;
        router.replace(href as "/");
      } catch {
        // Resume must never break launch.
      }
    })();
  }, [pathname, router]);
  return null;
}

// Persists the current route on every navigation. Debounced by the
// navigator itself: pathname changes at most once per navigation.
export function ResumeSaver() {
  const pathname = usePathname();
  useEffect(() => {
    void saveResumeRoute(pathname);
  }, [pathname]);
  return null;
}
