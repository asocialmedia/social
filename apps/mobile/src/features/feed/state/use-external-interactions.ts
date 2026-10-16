// oxlint-disable react/todo -- Async mutations release request guards in finally, including failed requests.
import type { ExternalPost } from "@asm/protocols/contracts";
import type { ExternalMutation } from "@asm/protocols/discovery";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { toast } from "@/components/feedback/toast";
import { useSessionContext } from "@/features/auth/state/session";

import { mutateExternal } from "../lib/external-interactions";

type ExternalState = NonNullable<ExternalPost["asm"]>;
const EMPTY_STATE: ExternalState = {
  amplifications: 0,
  amplified: false,
  bookmarked: false,
  comments: 0,
  responses: 0,
};
const useExternalStates = create<{
  values: Record<string, ExternalState>;
  update: (key: string, value: ExternalState) => void;
}>((set) => ({
  update: (key, value) =>
    set((store) => ({
      values: Object.fromEntries([
        ...Object.entries(store.values)
          .filter(([existing]) => existing !== key)
          .slice(-999),
        [key, value],
      ]),
    })),
  values: {},
}));

export function recordExternalResponse(uri: string, viewer: string) {
  const key = `${viewer}:${uri}`;
  const store = useExternalStates.getState();
  const previous = store.values[key] ?? EMPTY_STATE;
  store.update(key, { ...previous, responses: (previous.responses ?? 0) + 1 });
}

export function useExternalInteractions(
  post: Pick<ExternalPost, "id" | "asm">
) {
  const { user } = useSessionContext();
  const router = useRouter();
  const key = `${user?.id ?? "guest"}:${post.id}`;
  const stored = useExternalStates((store) => store.values[key]);
  const update = useExternalStates((store) => store.update);
  const state = stored ?? post.asm ?? EMPTY_STATE;
  useEffect(() => {
    if (post.asm) {
      update(key, post.asm);
    }
  }, [key, post.asm, update]);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mutate = async (input: ExternalMutation) => {
    if (!user) {
      router.push("/(auth)/login");
      return false;
    }
    if (busy.current) {
      return false;
    }
    busy.current = true;
    setPending(true);
    try {
      update(key, await mutateExternal(input));
      return true;
    } catch (error) {
      toast({
        title:
          error instanceof Error
            ? error.message
            : "Couldn't save. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { mutate, pending, state };
}
