"use client";

import { useSyncExternalStore } from "react";

import { resolveDiscoveryLocale } from "@/lib/protocols/discovery-locale";

import { useNetworkSettings } from "./use-network-settings";

const subscribe = () => () => null;

export function useDiscoveryLocale() {
  const network = useNetworkSettings();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const {
    contentLanguages,
    language: legacyLanguage,
    region,
  } = network.settings.preferences;
  const deviceLocale = hydrated
    ? resolveDiscoveryLocale(
        navigator.languages,
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
        "auto"
      )
    : "en";
  let locale = deviceLocale;
  if (contentLanguages !== undefined) {
    if (contentLanguages.length === 0) {
      locale = "all";
    } else {
      const primary = contentLanguages[0] ?? "en";
      locale = `${primary}${deviceLocale.includes("-") ? `-${deviceLocale.split("-")[1]}` : ""}`;
    }
  } else if (legacyLanguage === "all") {
    locale = "all";
  } else if (legacyLanguage !== "auto") {
    locale = `${legacyLanguage}${deviceLocale.includes("-") ? `-${deviceLocale.split("-")[1]}` : ""}`;
  }
  if (locale !== "all" && region !== "auto") {
    locale =
      region === "all"
        ? (locale.split("-")[0] ?? "en")
        : `${locale.split("-")[0]}-${region}`;
  }
  return { locale, ready: hydrated && network.ready };
}
