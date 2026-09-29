import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { AppStateStatus } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
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
// When another device revokes this session (or all sessions for the account),
// or when the server signals 401 Unauthorized on the events stream, this guard
// immediately initiates sign-out and routes the user back to the login screen.
export function SessionRevocationGuard(): null {
  const { refresh, sessionId, signOut, user } = useSessionContext();

  const signOutRef = useRef(signOut);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    signOutRef.current = signOut;
    refreshRef.current = refresh;
  }, [refresh, signOut]);

  useEffect(() => {
    // Only subscribe when actively authenticated.
    if (!sessionId || !user) {
      return;
    }

    let isRevoking = false;
    let streamController: AbortController | null = null;
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
        const cookie = await authClient.getCookie();
        if (signal.aborted || isDisposed || isRevoking) {
          return;
        }

        const url = buildSessionEventsUrl(getApiBaseUrl());
        await readSseStream({
          cookie,
          eventName: "session-revoked",
          onEvent: (_eventName, data) => {
            const event = parseSessionRevocationEvent(data);
            if (event && shouldEndSession(event, sessionId)) {
              triggerRevocation("remote_revocation_event");
            }
          },
          onUnauthorized: () => {
            triggerRevocation("unauthorized_stream_response");
          },
          signal,
          url,
        });
      } catch {
        // Network drops are handled with backoff inside readSseStream.
      }
    };

    const connectActive = () => {
      if (streamController) {
        streamController.abort();
      }
      streamController = new AbortController();
      void startStream(streamController.signal);
    };

    const disconnectInactive = () => {
      if (streamController) {
        streamController.abort();
        streamController = null;
      }
    };

    // If currently active, start immediately.
    if (AppState.currentState === "active") {
      connectActive();
    }

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        // App returned to foreground: recheck session validity and resume stream.
        void refreshRef.current();
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
  }, [sessionId, user]);

  return null;
}
