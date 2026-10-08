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
import { AppState, Platform } from "react-native";

import { useInstall } from "@/features/auth/state/install";
import { useSessionContext } from "@/features/auth/state/session";
import { useStartupPresented } from "@/lib/startup-context";
import { logInfo } from "@/lib/telemetry";

import {
  registerForPushNotifications,
  resetPushRegistration,
  subscribeToPushReceived,
  subscribeToPushTokenChanges,
  subscribeToPushTaps,
  unregisterPushNotifications,
} from "../lib/push";
import { unreadCountStore } from "../state/unread-store";

export function PushRegistrar() {
  const router = useRouter();
  const { isPending, user } = useSessionContext();
  const { runWithInstallToken } = useInstall();
  const userId = user?.id ?? null;
  const previousUserId = useRef<string | null>(null);
  const presented = useStartupPresented();
  const routerReady = useRef(false);
  useEffect(() => {
    routerReady.current = presented;
  }, [presented]);

  useEffect(() => {
    const listener = subscribeToPushTaps(
      (route) => router.push(route as "/notifications"),
      () => routerReady.current
    );
    return () => listener.remove();
  }, [router]);

  // When a push alert arrives in the foreground, refresh the unread bell count
  // immediately so the badge updates in real time without waiting for the poll timer.
  useEffect(() => {
    const listener = subscribeToPushReceived(() => {
      void unreadCountStore.refresh();
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    if (isPending || !presented) {
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
      void registerForPushNotifications(runWithInstallToken);
    }

    previousUserId.current = userId;
  }, [isPending, presented, runWithInstallToken, userId]);

  // A token can rotate while the app is backgrounded (app restore, update),
  // so re-register on each return to foreground.
  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    if (!userId) {
      return;
    }
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void registerForPushNotifications(runWithInstallToken);
        void unreadCountStore.refresh();
      }
    });
    const tokenSubscription = subscribeToPushTokenChanges(() => {
      resetPushRegistration();
      void registerForPushNotifications(runWithInstallToken);
    });
    return () => {
      subscription.remove();
      tokenSubscription.remove();
    };
  }, [runWithInstallToken, userId]);

  return null;
}
