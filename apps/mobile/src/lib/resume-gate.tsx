import { usePathname, useRootNavigationState, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { loadLaunchResumeRoute, saveResumeRoute } from "@/lib/app-resume";
import { useStartupPresented } from "@/lib/startup-context";

import { resumeHref, startupDestination } from "./startup";

// Keep Home beneath the restored destination and release startup only when
// the navigator commits that route. Incoming deep links take precedence.
export function ResumeGate({ onReady }: { onReady: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useRootNavigationState();
  const currentPath = useRef(pathname);
  useEffect(() => {
    currentPath.current = pathname;
  }, [pathname]);
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    if (!navigation?.key) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
      onReady();
    }, 2500);
    void (async () => {
      try {
        const resume = await loadLaunchResumeRoute();
        if (cancelled) {
          return;
        }
        const target = startupDestination(currentPath.current, resume);
        setDestination(target);
        if (resume && target !== currentPath.current) {
          router.navigate(resumeHref(resume) as "/");
        }
      } catch {
        if (!cancelled) {
          onReady();
        }
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [navigation?.key, onReady, router]);

  useEffect(() => {
    if (destination !== null && pathname === destination) {
      onReady();
    }
  }, [destination, onReady, pathname]);
  return null;
}

// Never persist the temporary Home route while restoration is in progress.
export function ResumeSaver() {
  const pathname = usePathname();
  const presented = useStartupPresented();
  useEffect(() => {
    if (presented) {
      void saveResumeRoute(pathname);
    }
  }, [pathname, presented]);
  return null;
}
