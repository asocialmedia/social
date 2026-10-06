import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { SessionConnection } from "@/features/auth/lib/session-connection";
import {
  buildSessionEventsUrl,
  parseSessionRevocationEvent,
  shouldEndSession,
} from "@/features/auth/lib/session-revocation";
import { useSessionContext } from "@/features/auth/state/session";
import { getApiBaseUrl } from "@/lib/api-env";
import { readSseStream } from "@/lib/sse-stream";
import { logInfo } from "@/lib/telemetry";

// Monitors server-sent session revocation events in real time.
// Remote revocation events end the affected session immediately.
// A stream 401 is confirmed against get-session before ending the session;
// transient network failures retain the signed-in identity.
export function SessionRevocationGuard(): null {
  const { refresh, sessionId, signOut, user } = useSessionContext();

  const userId = user?.id;
  const signOutRef = useRef(signOut);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    signOutRef.current = signOut;
    refreshRef.current = refresh;
  }, [refresh, signOut]);

  useEffect(() => {
    // Only subscribe when actively authenticated.
    if (!sessionId || !userId) {
      return;
    }

    let isRevoking = false;
    let isDisposed = false;

    const triggerRevocation = (reason: string) => {
      if (isRevoking || isDisposed) {
        return;
      }
      isRevoking = true;
      logInfo("auth.session_revoked", { reason, sessionId });
      void signOutRef.current({ reason: "session-ended" });
    };

    const startStream = async (signal: AbortSignal) => {
      try {
        if (signal.aborted || isDisposed || isRevoking) {
          return;
        }

        const url = buildSessionEventsUrl(getApiBaseUrl());
        await readSseStream({
          baseFetch: expoFetch,
          eventName: "session-revoked",
          getCookie: () => authClient.getCookie(),
          onEvent: (_eventName, data) => {
            const event = parseSessionRevocationEvent(data);
            if (event && shouldEndSession(event, sessionId)) {
              triggerRevocation("remote_revocation_event");
            }
          },
          onUnauthorized: () => connection.confirmUnauthorized(signal),
          signal,
          url,
        });
      } catch {
        // Network drops are handled with backoff inside readSseStream.
      }
    };

    const connection = new SessionConnection({
      connect: startStream,
      onExpired: () => triggerRevocation("confirmed_session_expiry"),
      refresh: () => refreshRef.current(),
      sessionId,
    });
    const connectActive = () => {
      void connection.resume();
    };
    const disconnectInactive = () => connection.suspend();

    // If currently active, start immediately.
    if (AppState.currentState === "active") {
      connectActive();
    }

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        // App returned to foreground: recheck session validity and resume stream.
        connectActive();
      } else {
        // App backgrounded or inactive: pause stream to preserve battery and radio state.
        disconnectInactive();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );

    return () => {
      isDisposed = true;
      subscription.remove();
      disconnectInactive();
    };
  }, [sessionId, userId]);

  return null;
}
