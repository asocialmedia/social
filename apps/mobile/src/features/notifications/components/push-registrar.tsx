// Wires native push into the app's lifecycle:
// - registers/refreshes the device token whenever a user is signed in;
// - re-registers on foreground (a token can rotate while backgrounded);
// - unregisters on sign-out so the next account does not receive alerts;
// - forwards notification taps to expo-router.
//
// Mounted once in the root layout, inside the session provider so it can read
// the current user. All operations are best-effort; a push failure never
// affects the app.
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { useSessionContext } from "@/features/auth/state/session";
import { logInfo } from "@/lib/telemetry";

import {
  registerForPushNotifications,
  resetPushRegistration,
  subscribeToPushTaps,
  unregisterPushNotifications,
} from "../lib/push";

export function PushRegistrar() {
  const router = useRouter();
  const { isPending, user } = useSessionContext();
  const userId = user?.id ?? null;
  const previousUserId = useRef<string | null>(null);
  const routerReady = useRef(false);

  useEffect(() => {
    routerReady.current = true;
    const listener = subscribeToPushTaps(
      (route) => router.push(route as "/notifications"),
      () => routerReady.current
    );
    return () => listener.remove();
  }, [router]);

  useEffect(() => {
    if (isPending) {
      return;
    }
    const previous = previousUserId.current;

    // Sign-out: drop the stored token so the next session starts clean.
    if (previous && !userId) {
      void unregisterPushNotifications();
      logInfo("push.session_signed_out");
    }

    // Sign-in or account switch: a switched token must be re-registered under
    // the new user (the server moves it via upsert).
    if (userId && userId !== previous) {
      resetPushRegistration();
      void registerForPushNotifications();
    }

    previousUserId.current = userId;
  }, [isPending, userId]);

  // A token can rotate while the app is backgrounded (app restore, update),
  // so re-register on each return to foreground.
  useEffect(() => {
    if (!userId) {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void registerForPushNotifications();
      }
    });
    return () => subscription.remove();
  }, [userId]);

  return null;
}
