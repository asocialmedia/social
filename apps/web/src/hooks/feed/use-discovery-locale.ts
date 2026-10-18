"use client";

import { useSyncExternalStore } from "react";

import { resolveDiscoveryLocale } from "@/lib/protocols/discovery-locale";
import { useFeedSourceStore } from "@/store/feed-source-store";

import { useNetworkSettings } from "./use-network-settings";

const subscribe = () => () => null;

export function useDiscoveryLocale() {
  const network = useNetworkSettings();
  const preference = useFeedSourceStore((state) => state.language);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const requested =
    preference === "auto" ? network.settings.preferences.language : preference;
  const deviceLocale = hydrated
    ? resolveDiscoveryLocale(
        navigator.languages,
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
        "auto"
      )
    : "en";
  let locale = deviceLocale;
  if (requested === "all") {
    locale = "all";
  }
  if (requested !== "auto" && requested !== "all") {
    locale = `${requested}${deviceLocale.includes("-") ? `-${deviceLocale.split("-")[1]}` : ""}`;
  }
  const { region } = network.settings.preferences;
  if (locale !== "all" && region !== "auto") {
    locale =
      region === "all"
        ? (locale.split("-")[0] ?? "en")
        : `${locale.split("-")[0]}-${region}`;
  }
  return { locale, ready: hydrated && network.ready };
}
