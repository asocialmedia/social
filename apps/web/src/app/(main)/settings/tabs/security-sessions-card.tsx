"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import {
  Globe2,
  Loader2,
  LogOut,
  MonitorSmartphone,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { LoadingButton } from "@/components/auth/loading-button";
import { SettingsCard } from "@/components/settings/settings-section-card";
import { useToast } from "@/lib/gooey-toast";

import {
  getSessionDevice,
  getSessionLocation,
  isSecuritySession,
} from "./security-session-utils";
import type { SecuritySession } from "./security-session-utils";

type RevokeAction = "all" | "other-sessions" | "single";

const SESSION_REQUEST_TIMEOUT_MS = 10_000;

function normalizeSession(value: unknown): SecuritySession | null {
  if (!isSecuritySession(value)) {
    return null;
  }
  return {
    ...value,
    country: value.country ?? null,
    ipAddress: value.ipAddress ?? null,
    userAgent: value.userAgent ?? null,
  };
}

async function listSecuritySessions(): Promise<SecuritySession[]> {
  let response: Response;
  try {
    response = await fetch("/api/security/sessions", {
      credentials: "include",
      signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        "Loading sessions took too long. Check your connection and try again.",
        { cause: error }
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error("Couldn’t load your active sessions. Please try again.");
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new TypeError("Unexpected session response");
  }
  return data
    .map(normalizeSession)
    .filter((session): session is SecuritySession => session !== null)
    .toSorted(
      (firstSession, secondSession) =>
        new Date(secondSession.updatedAt).getTime() -
        new Date(firstSession.updatedAt).getTime()
    );
}

async function revokeAuthSessions(
  action: RevokeAction,
  session?: Pick<SecuritySession, "id">
): Promise<void> {
  const response = await fetch("/api/security/sessions", {
    body: JSON.stringify({
      action,
      ...(session ? { sessionId: session.id } : {}),
    }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? "For your protection, sign in again before managing sessions."
        : "Couldn’t update your sessions. Please try again."
    );
  }
}

function formatSessionDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getRevokeCopy(action: RevokeAction): {
  confirm: string;
  description: string;
  title: string;
} {
  if (action === "all") {
    return {
      confirm: "Sign out everywhere",
      description:
        "This ends every active session, including this one. You’ll need to sign in again on all devices.",
      title: "Sign out everywhere?",
    };
  }
  if (action === "other-sessions") {
    return {
      confirm: "Sign out other devices",
      description:
        "This ends all other active sessions and keeps this device signed in.",
      title: "Sign out other devices?",
    };
  }
  return {
    confirm: "Sign out session",
    description:
      "This device will need to sign in again to access your account.",
    title: "Sign out this device?",
  };
}

export default function SecuritySessionsCard({
  currentSessionId,
}: {
  currentSessionId: string;
}) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeAction, setRevokeAction] = useState<RevokeAction>("single");
  const [selectedSession, setSelectedSession] = useState<SecuritySession>();

  const refreshSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      setSessions(await listSecuritySessions());
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn’t load your active sessions. Please try again.",
        title: "Couldn’t load sessions",
        variant: "destructive",
      });
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshSessions();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refreshSessions]);

  function openRevokeDialog(action: RevokeAction, session?: SecuritySession) {
    if (
      isLoading ||
      (action === "all" && sessions.length === 0) ||
      (action === "other-sessions" && sessions.length < 2)
    ) {
      return;
    }
    setRevokeAction(action);
    setSelectedSession(session);
    setIsDialogOpen(true);
  }

  async function confirmRevoke() {
    if (revokeAction === "single" && !selectedSession) {
      return;
    }
    setIsRevoking(true);
    try {
      await revokeAuthSessions(revokeAction, selectedSession);
      const revokesCurrentSession =
        revokeAction === "all" || selectedSession?.id === currentSessionId;
      if (revokesCurrentSession) {
        window.location.assign("/login");
        return;
      }
      setIsDialogOpen(false);
      await refreshSessions();
      toast({
        description:
          revokeAction === "other-sessions"
            ? "Other devices have been signed out."
            : "That device has been signed out.",
        title: "Sessions updated",
      });
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn’t update your sessions. Please try again.",
        title: "Couldn’t update sessions",
        variant: "destructive",
      });
    }
    setIsRevoking(false);
  }

  const revokeCopy = getRevokeCopy(revokeAction);

  return (
    <SettingsCard className="scroll-mt-24" id="settings-sessions">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
            <MonitorSmartphone className="h-3.5 w-3.5" />
          </div>
          <div>
            <h3 className="font-medium">Active sessions</h3>
            <p className="text-muted-foreground text-sm">
              Devices currently signed in to your account
            </p>
          </div>
        </div>
        <Button
          className="btn-3d-gray h-9 rounded-full px-3 text-sm!"
          onClick={() => {
            if (isLoading) {
              return;
            }
            void refreshSessions();
          }}
          variant="ghost"
        >
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Loading signed-in devices…
        </div>
      ) : null}
      {!isLoading && sessions.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          No active sessions were found. Refresh the page after your next
          sign-in.
        </p>
      ) : null}
      {!isLoading && sessions.length > 0 ? (
        <div className="mt-4 space-y-2">
          {sessions.map((session) => {
            const device = getSessionDevice(session.userAgent);
            const isCurrentSession = session.id === currentSessionId;
            return (
              <div
                className="border-border/60 rounded-xl border bg-[hsl(var(--background))] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),inset_0_1px_2px_rgba(255,255,255,0.9),inset_0_-2px_4px_rgba(0,0,0,0.03),0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06),inset_0_1px_2px_rgba(255,255,255,0.04),inset_0_-2px_4px_rgba(0,0,0,0.15),0_1px_3px_rgba(0,0,0,0.2)]"
                key={session.id}
              >
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
                    <MonitorSmartphone className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {device.browser} on {device.device}
                      </p>
                      {isCurrentSession ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          Current device
                        </span>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                      <p className="flex items-center gap-1.5">
                        <Globe2 className="size-3" />
                        {getSessionLocation(session.country, session.ipAddress)}
                      </p>
                      <p>Signed in {formatSessionDate(session.createdAt)}</p>
                      <p>Last active {formatSessionDate(session.updatedAt)}</p>
                    </div>
                  </div>
                  <Button
                    className="text-destructive pill-3d-hover h-8 shrink-0 rounded-full px-2.5 text-xs"
                    onClick={() => openRevokeDialog("single", session)}
                    variant="ghost"
                  >
                    <LogOut className="size-3.5" />
                    {isCurrentSession ? "Sign out" : "End"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          className="btn-3d-gray h-9 rounded-full px-4 text-sm!"
          onClick={() => openRevokeDialog("other-sessions")}
          variant="ghost"
        >
          Sign out other devices
        </Button>
        <Button
          className="text-destructive pill-3d-hover h-9 rounded-full px-4 text-sm"
          onClick={() => openRevokeDialog("all")}
          variant="ghost"
        >
          <ShieldAlert className="size-4" />
          Sign out everywhere
        </Button>
      </div>

      <Dialog onOpenChange={setIsDialogOpen} open={isDialogOpen}>
        <DialogContent className="apple-panel w-[calc(100%-1.5rem)] max-w-[420px] gap-0 overflow-hidden border-0 p-0 sm:rounded-2xl">
          <DialogHeader className="border-border/60 gap-0 border-b px-5 pt-5 pb-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-b from-[#ff9500] to-[#e65500] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(170,60,0,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)]">
                <ShieldAlert className="size-4" />
              </div>
              {revokeCopy.title}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {revokeCopy.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-border/60 flex-row justify-end gap-2 border-t px-5 py-3 sm:space-x-0">
            <Button
              className="btn-3d-gray h-9 rounded-full px-4 text-sm!"
              disabled={isRevoking}
              onClick={() => setIsDialogOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <LoadingButton
              className="h-9 rounded-full px-4 text-sm"
              loading={isRevoking}
              onClick={() => {
                void confirmRevoke();
              }}
              type="button"
              variant="premium"
            >
              {revokeCopy.confirm}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
