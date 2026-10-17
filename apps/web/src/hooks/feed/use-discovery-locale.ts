"use client";

import { useSyncExternalStore } from "react";

import { resolveDiscoveryLocale } from "@/lib/protocols/discovery-locale";
import { useFeedSourceStore } from "@/store/feed-source-store";

const subscribe = () => () => null;

export function useDiscoveryLocale() {
  const preference = useFeedSourceStore((state) => state.language);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const locale = hydrated
    ? resolveDiscoveryLocale(
        navigator.languages,
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
        preference
      )
    : "en";
  return { locale, ready: hydrated };
}
