// oxlint-disable react/todo -- Async requests release their guards after both success and failure.
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { create } from "zustand";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";

const stateSchema = z.object({ following: z.boolean() });
export const useExternalFollowRevision = create<{
  revisions: Record<string, number>;
  changed: (viewer: string) => void;
}>((set) => ({
  changed: (viewer) =>
    set((current) => ({
      revisions: {
        ...current.revisions,
        [viewer]: (current.revisions[viewer] ?? 0) + 1,
      },
    })),
  revisions: {},
}));

export function useExternalFollow(did: string, enabled: boolean) {
  const { user } = useSessionContext();
  const router = useRouter();
  const revision = useExternalFollowRevision(
    (state) => state.revisions[user?.id ?? "guest"] ?? 0
  );
  const [state, setState] = useState<{
    key: string;
    following: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const key = `${user?.id ?? "guest"}:${did}:${revision}:${attempt}`;
  useEffect(() => {
    if (!enabled || !user) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        setFailed(false);
        const response = await fetch(
          `${getApiBaseUrl()}/api/protocols/bluesky/follows?${new URLSearchParams({ actor: did })}`,
          {
            headers: {
              "x-asm-client": "mobile",
              ...(cookie ? { cookie } : {}),
            },
            signal: controller.signal,
          }
        );
        if (!response.ok) {
          throw new Error("Follow state unavailable");
        }
        const next = stateSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setState({ following: next.following, key });
        }
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      }
    })();
    return () => controller.abort();
  }, [did, enabled, key, user]);
  const ready = !user || state?.key === key;
  return {
    failed,
    following: state?.key === key && state.following,
    pending: pending || (!ready && !failed),
    toggle: async () => {
      if (!user) {
        router.push("/login");
        return;
      }
      if (failed) {
        setAttempt((current) => current + 1);
        return;
      }
      if (busy.current || !ready) {
        return;
      }
      busy.current = true;
      setPending(true);
      try {
        const cookie = await authClient.getCookie();
        const response = await fetch(
          `${getApiBaseUrl()}/api/protocols/bluesky/follows`,
          {
            body: JSON.stringify({ active: !state?.following, actor: did }),
            headers: {
              "content-type": "application/json",
              "x-asm-client": "mobile",
              ...(cookie ? { cookie } : {}),
            },
            method: "POST",
            signal: AbortSignal.timeout(20_000),
          }
        );
        if (!response.ok) {
          const body: unknown = await response.json();
          const limited =
            body &&
            typeof body === "object" &&
            "error" in body &&
            body.error === "follow_limit";
          throw new Error(
            limited
              ? "You can follow up to 100 Bluesky accounts."
              : "Couldn't update follow. Please try again."
          );
        }
        const next = stateSchema.parse(await response.json());
        useExternalFollowRevision.getState().changed(user.id);
        toast({
          description: "Your Bluesky account does not need to be linked.",
          title: next.following ? "Following in ASM" : "Unfollowed in ASM",
        });
      } catch (error) {
        toast({
          title:
            error instanceof Error ? error.message : "Couldn't update follow",
          variant: "destructive",
        });
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
  };
}
