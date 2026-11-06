"use client";

import { canManageDen } from "@asm/db/messages/dens";
import { runChatTask } from "@asm/messages";
import { Button } from "@asm/ui/shadui/button";
import { Checkbox } from "@asm/ui/shadui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  Download,
  ChevronRight,
  History,
  Shield,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import type React from "react";

import { useSession } from "@/app/(main)/session-provider";
import { ZephLoader } from "@/components/layouts/feedback/zeph-loader";
import type { ConversationDetailResponse } from "@/lib/messages/client";
import {
  ChatControlError,
  chatControlRequest,
} from "@/lib/messages/lifecycle-client";
import type { ChatExportStatus } from "@/lib/messages/lifecycle-client";

import { useChatLifecycle } from "./chat-lifecycle-state";
import { IncognitoUsageNotice } from "./incognito-usage-notice";

export function ChatLifecycleTools({
  detail,
}: {
  detail: ConversationDetailResponse;
}) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const {
    snapshot,
    error: lifecycleError,
    busy,
    refresh,
    mutate,
    loadEarlierNotices,
    dismiss,
    requestIncognito,
  } = useChatLifecycle();
  const [dialog, setDialog] = useState<
    "clear" | "end" | "retention" | "export" | "sessions" | null
  >(null);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [job, setJob] = useState<ChatExportStatus | null>(
    () =>
      queryClient.getQueryData<ChatExportStatus>([
        "chat-export-job",
        user?.id,
        detail.conversation.id,
      ]) ?? null
  );
  useEffect(() => {
    queryClient.setQueryData(
      ["chat-export-job", user?.id, detail.conversation.id],
      job
    );
  }, [queryClient, user?.id, detail.conversation.id, job]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const id = useId();
  const conversationId = detail.conversation.id;
  const isDen = detail.conversation.type === "DEN";
  const me = detail.conversation.members.find(
    (member) => member.userId === user?.id
  );
  const canManage = !me?.leftAt && (!isDen || canManageDen(me?.role));
  const setOpen = (next: typeof dialog) => {
    dismiss();
    setDialog(next);
  };
  const [pollFailures, setPollFailures] = useState(0);
  useEffect(() => {
    if (
      !job ||
      !["pending", "processing"].includes(job.status) ||
      pollFailures >= 3
    ) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await chatControlRequest<ChatExportStatus>(
            conversationId,
            `exports/${job.id}`,
            { signal: controller.signal }
          );
          if (!cancelled) {
            setJob(result);
            setExportError(null);
            setPollFailures(0);
          }
        } catch (error) {
          if (cancelled) {
            return;
          }
          const message =
            error instanceof Error
              ? error.message
              : "Export status couldn't be checked.";
          if (
            error instanceof ChatControlError &&
            [404, 409, 410].includes(error.status)
          ) {
            setJob(null);
            setExportError(
              "This export is no longer available. Prepare a fresh export."
            );
            return;
          }
          setPollFailures((count) => count + 1);
          setExportError(message);
          setJob((current) => (current ? { ...current } : null));
        }
      })();
    }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [job, conversationId, pollFailures]);
  const startExport = async () => {
    setExportBusy(true);
    setExportError(null);
    setPollFailures(0);
    return await runChatTask(
      async () => {
        try {
          const body = {
            fromDate: fromDate
              ? new Date(`${fromDate}T00:00:00`).toISOString()
              : undefined,
            includeMedia,
            toDate: toDate
              ? new Date(`${toDate}T23:59:59.999`).toISOString()
              : undefined,
          };
          setJob(
            await chatControlRequest<ChatExportStatus>(
              conversationId,
              "exports",
              {
                body: JSON.stringify(body),
                method: "POST",
              }
            )
          );
        } catch (error) {
          setExportError(
            error instanceof Error
              ? error.message
              : "Export couldn't be started. Try again."
          );
        }
      },
      () => {
        setExportBusy(false);
      }
    );
  };
  const confirm = async () => {
    const body = (() => {
      if (dialog === "end") {
        return {
          action: "end-incognito",
          sessionId: snapshot?.activeSession?.id,
        };
      }
      if (dialog === "clear") {
        return { action: "clear", throughSequence: snapshot?.changeSeq };
      }
      return {
        action: "retention",
        seconds: snapshot?.retentionSeconds ? 0 : 86_400,
        version: snapshot?.retentionVersion,
      };
    })();
    if (await mutate(body)) {
      setDialog(null);
    }
  };
  const cancelExport = async () => {
    if (!job) {
      return;
    }
    setExportBusy(true);
    return await runChatTask(
      async () => {
        try {
          await chatControlRequest(conversationId, `exports/${job.id}`, {
            method: "DELETE",
          });
          setJob(null);
        } catch {
          setExportError("Export couldn't be cancelled. Try again.");
        }
      },
      () => {
        setExportBusy(false);
      }
    );
  };
  return (
    <>
      <div className="divide-border/60 divide-y">
        {isDen ? null : (
          <LifecycleAction
            icon={<Shield className="size-4" />}
            label={
              snapshot?.activeSession ? "End incognito" : "Start incognito"
            }
            disabled={busy}
            onClick={() =>
              snapshot?.activeSession ? setOpen("end") : requestIncognito()
            }
          />
        )}
        <LifecycleAction
          icon={<Clock3 className="size-4" />}
          label="Auto-delete messages"
          value={snapshot?.retentionSeconds ? "24 hours" : "Off"}
          disabled={busy || !canManage || Boolean(snapshot?.activeSession)}
          onClick={() => setOpen("retention")}
        />
        <LifecycleAction
          icon={<Download className="size-4" />}
          label="Export chat"
          onClick={() => setOpen("export")}
        />
        {!isDen && snapshot?.notices.length ? (
          <LifecycleAction
            icon={<History className="size-4" />}
            label="Incognito history"
            onClick={() => setOpen("sessions")}
          />
        ) : null}
        <LifecycleAction
          icon={<Trash2 className="size-4" />}
          label="Delete chat for me"
          destructive
          disabled={busy || Boolean(snapshot?.activeSession)}
          onClick={() => setOpen("clear")}
        />
      </div>
      {lifecycleError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-red-600"
        >
          <span>{lifecycleError}</span>
          <Button variant="ghost" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy && !exportBusy) {
            setOpen(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {(() => {
                if (dialog === "end") {
                  return "End incognito for both of you?";
                }
                if (dialog === "clear") {
                  return "Delete chat for me?";
                }
                if (dialog === "retention") {
                  if (snapshot?.retentionSeconds) {
                    return "Turn off auto-delete?";
                  }
                  return "Auto-delete new messages after 24 hours?";
                }
                if (dialog === "sessions") {
                  return "Incognito session history";
                }
                return "Export chat";
              })()}
            </DialogTitle>
            <DialogDescription>
              {(() => {
                if (dialog === "end") {
                  return "All messages and attachments in incognito will be deleted, including unread messages.";
                }
                if (dialog === "clear") {
                  return "Clear this chat from your devices. Other members keep their messages.";
                }
                if (dialog === "retention") {
                  return "New messages will disappear 24 hours after sending. Existing messages keep their current setting.";
                }
                if (dialog === "sessions") {
                  return "Past incognito conversations.";
                }
                return "Download your chat history and optional media as a ZIP file.";
              })()}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            if (dialog === "sessions") {
              return (
                <div className="max-h-[55vh] overflow-y-auto">
                  {snapshot?.notices.map((session) => (
                    <IncognitoUsageNotice session={session} key={session.id} />
                  ))}
                  {snapshot?.nextNoticeCursor ? (
                    <Button
                      disabled={busy}
                      variant="ghost"
                      className="w-full"
                      onClick={() => {
                        void loadEarlierNotices();
                      }}
                    >
                      Load earlier sessions
                    </Button>
                  ) : null}
                </div>
              );
            }
            if (dialog === "export") {
              return (
                <div className="space-y-4">
                  {(() => {
                    if (!job || job.status === "failed") {
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <label
                              className="space-y-1 text-sm"
                              htmlFor={`${id}-from`}
                            >
                              From
                              <Input
                                id={`${id}-from`}
                                type="date"
                                value={fromDate}
                                onChange={(event) =>
                                  setFromDate(event.target.value)
                                }
                              />
                            </label>
                            <label
                              className="space-y-1 text-sm"
                              htmlFor={`${id}-to`}
                            >
                              Through
                              <Input
                                id={`${id}-to`}
                                type="date"
                                value={toDate}
                                onChange={(event) =>
                                  setToDate(event.target.value)
                                }
                              />
                            </label>
                          </div>
                          <label
                            htmlFor={`${id}-media`}
                            className="flex items-center gap-3 text-sm"
                          >
                            <Checkbox
                              id={`${id}-media`}
                              checked={includeMedia}
                              onCheckedChange={(checked) =>
                                setIncludeMedia(checked === true)
                              }
                            />
                            Include uploaded media
                          </label>
                          {job?.status === "failed" ? (
                            <p role="alert" className="text-sm text-red-600">
                              {(() => {
                                if (job.errorCode === "EXPORT_TOO_LARGE") {
                                  return "This export is too large. Choose a shorter date range or exclude media.";
                                }
                                if (
                                  job.errorCode ===
                                  "EXPORT_IDENTITY_UNAVAILABLE"
                                ) {
                                  return "Unlock message recovery, then request the export again.";
                                }
                                return "Export couldn't be prepared. Try again.";
                              })()}
                            </p>
                          ) : null}
                        </>
                      );
                    }
                    if (job.status === "ready") {
                      return (
                        <div
                          aria-live="polite"
                          className="surface-3d rounded-xl! p-4"
                        >
                          <p className="font-medium">Your export is ready</p>
                          <p className="text-muted-foreground mt-1 text-sm">
                            Available until{" "}
                            {new Date(job.expiresAt).toLocaleTimeString()}.
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div
                        aria-live="polite"
                        className="flex items-center gap-3 py-3"
                      >
                        <ZephLoader variant="messages" className="size-5" />
                        <div>
                          <p className="text-sm font-medium">
                            {job.status === "processing"
                              ? "Preparing your archive…"
                              : "Your export is queued…"}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            You can keep chatting while this finishes.
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                  {exportError ? (
                    <p role="alert" className="text-sm text-red-600">
                      {exportError}
                    </p>
                  ) : null}
                  <DialogFooter>
                    {(() => {
                      if (job?.status === "ready") {
                        return (
                          <Button asChild variant="premium">
                            <a
                              href={`/api/messages/conversations/${conversationId}/exports/${job.id}/download`}
                              download
                            >
                              <Download className="mr-2 size-4" />
                              Download ZIP
                            </a>
                          </Button>
                        );
                      }
                      if (
                        job &&
                        ["pending", "processing"].includes(job.status)
                      ) {
                        return (
                          <Button
                            variant="outline"
                            disabled={exportBusy}
                            onClick={() => {
                              void cancelExport();
                            }}
                          >
                            Cancel export
                          </Button>
                        );
                      }
                      return (
                        <Button
                          variant="premium"
                          disabled={
                            exportBusy ||
                            Boolean(fromDate && toDate && fromDate > toDate)
                          }
                          onClick={() => {
                            void startExport();
                          }}
                        >
                          {exportBusy ? (
                            <ZephLoader
                              variant="messages"
                              className="mr-2 size-4"
                            />
                          ) : (
                            <Download className="mr-2 size-4" />
                          )}
                          {job ? "Try again" : "Prepare export"}
                        </Button>
                      );
                    })()}
                  </DialogFooter>
                </div>
              );
            }
            return (
              <DialogFooter>
                {dialog === "clear" ? (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setOpen("export")}
                  >
                    Export first
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setOpen(null)}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  variant={
                    dialog === "clear" || dialog === "end"
                      ? "destructive"
                      : "premium"
                  }
                  disabled={busy}
                  onClick={() => {
                    void confirm();
                  }}
                >
                  {busy ? (
                    <ZephLoader variant="messages" className="mr-2 size-4" />
                  ) : null}
                  {(() => {
                    if (dialog === "clear") {
                      return "Delete for me";
                    }
                    if (dialog === "end") {
                      return "End and delete messages";
                    }
                    if (snapshot?.retentionSeconds) {
                      return "Turn off";
                    }
                    return "Enable 24 hours";
                  })()}
                </Button>
              </DialogFooter>
            );
          })()}
          {lifecycleError && dialog !== "export" ? (
            <p role="alert" className="text-sm text-red-600">
              {lifecycleError}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LifecycleAction({
  icon,
  label,
  value,
  disabled = false,
  destructive = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="pill-3d-hover flex min-h-12 w-full items-center gap-3 px-2.5 py-2 text-left disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span
        className={`chip-3d flex size-8 shrink-0 items-center justify-center rounded-lg ${destructive ? "text-destructive" : ""}`}
      >
        {icon}
      </span>
      <span
        className={`min-w-0 flex-1 text-sm font-medium ${destructive ? "text-destructive" : ""}`}
      >
        {label}
      </span>
      {value ? (
        <span className="text-muted-foreground text-xs">{value}</span>
      ) : null}
      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
    </button>
  );
}
