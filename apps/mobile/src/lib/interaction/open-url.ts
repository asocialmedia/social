// Hands a URL to whichever system app can open it. Linking.openURL rejects when
// no app claims the scheme or host, and firing it without a catch turns that
// into an unhandled promise rejection and a tap that does nothing.
// Every external link in the app goes through here instead, so a failure is
// always caught and the reader is told.
import { Linking } from "react-native";

import { toast } from "@/components/feedback/toast";

import { openUrlSafely } from "./open-url-core";

export function openExternalUrl(url: string): Promise<boolean> {
  return openUrlSafely(url, {
    onFailure: () =>
      toast({
        description: "Couldn't open that link",
        title: "No luck",
        variant: "destructive",
      }),
    open: (target) => Linking.openURL(target),
  });
}
