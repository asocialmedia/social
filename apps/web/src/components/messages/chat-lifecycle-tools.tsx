"use client";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { Input } from "@asm/ui/shadui/input";
import {
  Clock3,
  Download,
  Ellipsis,
  History,
  Loader2,
  Shield,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import type { ConversationDetailResponse } from "@/lib/messages/client";
import {
  ChatControlError,
  chatControlRequest,
} from "@/lib/messages/lifecycle-client";
import type { ChatExportStatus } from "@/lib/messages/lifecycle-client";

import {
  IncognitoUsageNotice,
  useChatLifecycle,
} from "./chat-lifecycle-context";

export function ChatLifecycleTools({
  detail,
}: {
  detail: ConversationDetailResponse;
}) {
  const { user } = useSession();
  const {
    snapshot,
    error: lifecycleError,
    busy,
    refresh,
    mutate,
    loadEarlierNotices,
    dismiss,
  } = useChatLifecycle();
  const [dialog, setDialog] = useState<
    "clear" | "start" | "retention" | "export" | "sessions" | null
  >(null);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [job, setJob] = useState<ChatExportStatus | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const id = useId();
  const conversationId = detail.conversation.id;
  const isDen = detail.conversation.type === "DEN";
  const me = detail.conversation.members.find(
    (member) => member.userId === user?.id
  );
  const canManage =
    !me?.leftAt && (!isDen || me?.role === "OWNER" || me?.role === "ADMIN");
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
      if (dialog === "start") {
        return { action: "start-incognito", actionId: crypto.randomUUID() };
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
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-1.5 text-xs">
        <span className="text-muted-foreground flex items-center gap-1.5">
          <Clock3 className="size-3.5" />
          {snapshot?.retentionSeconds
            ? "New messages disappear 24h after sending"
            : "Messages stay until deleted"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Chat actions" size="sm" variant="ghost">
              <Ellipsis className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isDen ? null : (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => setOpen("start")}
              >
                <Shield className="mr-2 size-4" />
                Start incognito
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={busy || !canManage}
              onSelect={() => setOpen("retention")}
            >
              <Clock3 className="mr-2 size-4" />
              Auto-delete · {snapshot?.retentionSeconds ? "24 hours" : "Off"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setOpen("export")}>
              <Download className="mr-2 size-4" />
              Export chat
            </DropdownMenuItem>
            {!isDen && snapshot?.notices.length ? (
              <DropdownMenuItem onSelect={() => setOpen("sessions")}>
                <History className="mr-2 size-4" />
                Incognito session history
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              disabled={busy}
              onSelect={() => setOpen("clear")}
            >
              <Trash2 className="mr-2 size-4" />
              Delete chat for me
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
                if (dialog === "start") {
                  return "Start incognito?";
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
                if (dialog === "start") {
                  return "Both of you will use a separate incognito view. Either person can end it, and it ends automatically 24 hours after starting. All session messages are deleted together. A permanent usage notice stays in this chat.";
                }
                if (dialog === "clear") {
                  return "Your existing history will be cleared across your devices. Other members keep their copies. New messages bring the chat back. Permanent incognito notices remain.";
                }
                if (dialog === "retention") {
                  return "This setting applies to new normal messages for everyone. Existing history keeps its current lifetime. Downloaded copies can remain after a message expires.";
                }
                if (dialog === "sessions") {
                  return "These permanent notices record who used incognito and when. Session message content is never included.";
                }
                return "Download a ZIP with text and JSON copies of your readable history. Cleared, deleted, expired, and incognito messages are excluded. Downloads expire within one hour.";
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
                        <Loader2 className="size-5 animate-spin" />
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
                            <Loader2 className="mr-2 size-4 animate-spin" />
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
                  variant={dialog === "clear" ? "destructive" : "premium"}
                  disabled={busy}
                  onClick={() => {
                    void confirm();
                  }}
                >
                  {busy ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {(() => {
                    if (dialog === "clear") {
                      return "Delete for me";
                    }
                    if (dialog === "start") {
                      return "Start incognito";
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
