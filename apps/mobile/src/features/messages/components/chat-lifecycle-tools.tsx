import { observeChatTask, runChatTask, throwChatError } from "@asm/messages";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Clock3, Ellipsis, Shield, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { StatusActionButton } from "@/components/feedback/status-action-button";
import { useSessionContext } from "@/features/auth/state/session";
import {
  NativeChatControlError,
  nativeChatRequest,
} from "@/features/messages/lib/lifecycle-client";
import type { MessageConversationData } from "@/features/messages/lib/types";
import { useAppTheme } from "@/theme";

import {
  NativeIncognitoUsageNotice,
  useNativeChatLifecycle,
} from "./chat-lifecycle-context";
import { MessageSheet } from "./message-sheet";

interface ExportStatus {
  id: string;
  status: string;
  expiresAt: string;
  errorCode: string | null;
}
export function NativeChatLifecycleTools({
  conversation,
}: {
  conversation: MessageConversationData | null;
}) {
  const { user } = useSessionContext();
  const { theme } = useAppTheme();
  const {
    snapshot,
    error: lifecycleError,
    busy,
    options,
    mutate,
    refresh,
    loadEarlierNotices,
  } = useNativeChatLifecycle();
  const [open, setOpen] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [job, setJob] = useState<ExportStatus | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const conversationId = conversation?.id;
  const me = conversation?.members.find((member) => member.userId === user?.id);
  const canManage =
    !me?.leftAt &&
    (conversation?.type !== "DEN" ||
      me?.role === "OWNER" ||
      me?.role === "ADMIN");
  const [pollFailures, setPollFailures] = useState(0);
  useEffect(() => {
    if (
      !job ||
      !conversationId ||
      !options ||
      !["pending", "processing"].includes(job.status)
    ) {
      return;
    }
    if (pollFailures >= 3) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void observeChatTask(
        nativeChatRequest<ExportStatus>(
          conversationId,
          `exports/${job.id}`,
          options,
          { signal: controller.signal }
        ),
        (result) => {
          if (!controller.signal.aborted) {
            setJob(result);
            setExportError(null);
            setPollFailures(0);
          }
        },
        (requestFailure) => {
          if (controller.signal.aborted) {
            return;
          }
          const message =
            requestFailure instanceof Error
              ? requestFailure.message
              : "Export status couldn't be checked.";
          if (
            requestFailure instanceof NativeChatControlError &&
            [404, 409, 410].includes(requestFailure.status)
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
      );
    }, 5000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [job, conversationId, options, pollFailures]);
  const confirm = (action: "start" | "clear" | "retention") => {
    const title = (() => {
      if (action === "start") {
        return "Start incognito?";
      }
      if (action === "clear") {
        return "Delete chat for me?";
      }
      if (snapshot?.retentionSeconds) {
        return "Turn off auto-delete?";
      }
      return "Auto-delete after 24 hours?";
    })();
    const description = (() => {
      if (action === "start") {
        return "Both of you will use a separate incognito view. The session ends when either person exits or 24 hours after starting. All session messages are deleted together. A permanent usage notice remains.";
      }
      if (action === "clear") {
        return "Your existing history will be cleared across your devices. Other members keep their copies. New messages bring the chat back. Permanent incognito notices remain.";
      }
      return "This applies to new normal messages for everyone. Existing history keeps its current lifetime. Downloaded copies can remain after expiry.";
    })();
    Alert.alert(title, description, [
      { style: "cancel", text: "Cancel" },
      {
        onPress: () => {
          void observeChatTask(
            mutate(
              (() => {
                if (action === "start") {
                  return {
                    action: "start-incognito",
                    actionId: crypto.randomUUID(),
                  };
                }
                if (action === "clear") {
                  return {
                    action: "clear",
                    throughSequence: snapshot?.changeSeq,
                  };
                }
                return {
                  action: "retention",
                  seconds: snapshot?.retentionSeconds ? 0 : 86_400,
                  version: snapshot?.retentionVersion,
                };
              })()
            ),
            (done) => {
              if (done) {
                setOpen(false);
              }
            }
          );
        },
        style: action === "clear" ? "destructive" : "default",
        text: (() => {
          if (action === "clear") {
            return "Delete for me";
          }
          if (action === "start") {
            return "Start incognito";
          }
          if (snapshot?.retentionSeconds) {
            return "Turn off";
          }
          return "Enable 24 hours";
        })(),
      },
    ]);
  };
  const startExport = async () => {
    if (!options || !conversationId) {
      return;
    }
    setExportBusy(true);
    setExportError(null);
    setPollFailures(0);
    return await runChatTask(
      async () => {
        try {
          const from = fromDate ? new Date(`${fromDate}T00:00:00`) : undefined;
          const through = toDate
            ? new Date(`${toDate}T23:59:59.999`)
            : undefined;
          if (
            (from && !Number.isFinite(from.getTime())) ||
            (through && !Number.isFinite(through.getTime())) ||
            (from && through && from > through)
          ) {
            throwChatError(
              new Error("Use YYYY-MM-DD and choose a valid date range.")
            );
          }
          setJob(
            await nativeChatRequest<ExportStatus>(
              conversationId,
              "exports",
              options,
              {
                body: JSON.stringify({
                  fromDate: from?.toISOString(),
                  includeMedia,
                  toDate: through?.toISOString(),
                }),
                method: "POST",
              }
            )
          );
        } catch (error) {
          setExportError(
            error instanceof Error
              ? error.message
              : "Export couldn't be started. Retry."
          );
        }
      },
      () => {
        setExportBusy(false);
      }
    );
  };
  const download = async () => {
    if (!options || !conversationId || !job) {
      return;
    }
    setExportBusy(true);
    setExportError(null);
    const file = new File(Paths.cache, `chat-export-${job.id}.zip`);
    return await runChatTask(
      async () => {
        try {
          if (!(await Sharing.isAvailableAsync())) {
            throwChatError(
              new Error("File sharing is unavailable on this device.")
            );
          }
          await File.downloadFileAsync(
            `${options.apiBase}/api/messages/conversations/${conversationId}/exports/${job.id}/download`,
            file,
            {
              headers: options.cookie ? { Cookie: options.cookie } : undefined,
              idempotent: true,
            }
          );
          await Sharing.shareAsync(file.uri, {
            UTI: "public.zip-archive",
            dialogTitle: "Save chat export",
            mimeType: "application/zip",
          });
        } catch (error) {
          if (error instanceof Error && /404|410/.test(error.message)) {
            setJob(null);
          }
          setExportError(
            error instanceof Error
              ? error.message
              : "Download failed. Please retry."
          );
        }
      },
      () => {
        try {
          if (file.exists) {
            file.delete();
          }
        } catch {
          // Reconcile safely on the next request; do not expose source errors.
          // Temporary-file cleanup must never mask a successful share or the original error.
        }
        setExportBusy(false);
      }
    );
  };
  const cancelExport = async () => {
    if (!options || !conversationId || !job) {
      return;
    }
    setExportBusy(true);
    return await runChatTask(
      async () => {
        try {
          await nativeChatRequest(
            conversationId,
            `exports/${job.id}`,
            options,
            {
              method: "DELETE",
            }
          );
          setJob(null);
        } catch {
          setExportError("Export couldn't be cancelled. Retry.");
        }
      },
      () => {
        setExportBusy(false);
      }
    );
  };
  return (
    <>
      <View
        style={{
          alignItems: "center",
          borderBottomColor: theme.dividerLine,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: 8,
          minHeight: 38,
          paddingHorizontal: 16,
        }}
      >
        <Clock3 size={13} color={theme.dividerText} />
        <Text style={{ color: theme.dividerText, flex: 1, fontSize: 11 }}>
          {snapshot?.retentionSeconds
            ? "New messages disappear 24h after sending"
            : "Messages stay until deleted"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Chat actions"
          onPress={() => setOpen(true)}
          hitSlop={12}
          style={{ padding: 8 }}
        >
          <Ellipsis color={theme.inputText} size={20} />
        </Pressable>
      </View>
      {lifecycleError ? (
        <Pressable
          accessibilityRole="button"
          onPress={refresh}
          style={{ padding: 12 }}
        >
          <Text accessibilityRole="alert" style={{ color: theme.dividerText }}>
            {lifecycleError} Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      <MessageSheet
        open={open}
        title="Chat actions"
        onClose={() => {
          if (!busy && !exportBusy) {
            setOpen(false);
          }
        }}
        busy={busy || exportBusy}
      >
        {conversation?.type === "DEN" ? null : (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => confirm("start")}
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 12,
              paddingVertical: 10,
            }}
          >
            <Shield color={theme.inputText} size={20} />
            <Text style={{ color: theme.inputText }}>Start incognito</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !canManage}
          onPress={() => confirm("retention")}
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 12,
            opacity: canManage ? 1 : 0.5,
            paddingVertical: 10,
          }}
        >
          <Clock3 color={theme.inputText} size={20} />
          <Text style={{ color: theme.inputText }}>
            Auto-delete · {snapshot?.retentionSeconds ? "24 hours" : "Off"}
          </Text>
        </Pressable>
        <View
          style={{
            borderTopColor: theme.dividerLine,
            borderTopWidth: 1,
            gap: 12,
            paddingTop: 16,
          }}
        >
          <Text style={{ color: theme.inputText, fontFamily: "SofiaProBold" }}>
            Export chat
          </Text>
          <Text
            style={{ color: theme.dividerText, fontSize: 12, lineHeight: 18 }}
          >
            ZIP with text and JSON copies of your readable history. Incognito,
            deleted, cleared, and expired messages are excluded. Permanent usage
            notices are included.
          </Text>
          {(() => {
            if (!job || job.status === "failed") {
              return (
                <>
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: theme.dividerText, fontSize: 12 }}>
                        From
                      </Text>
                      <TextInput
                        accessibilityLabel="Export from date"
                        placeholder="YYYY-MM-DD"
                        value={fromDate}
                        onChangeText={setFromDate}
                        autoCapitalize="none"
                        placeholderTextColor={theme.dividerText}
                        style={{
                          borderColor: theme.dividerLine,
                          borderRadius: 12,
                          borderWidth: 1,
                          color: theme.inputText,
                          padding: 12,
                        }}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: theme.dividerText, fontSize: 12 }}>
                        Through
                      </Text>
                      <TextInput
                        accessibilityLabel="Export through date"
                        placeholder="YYYY-MM-DD"
                        value={toDate}
                        onChangeText={setToDate}
                        autoCapitalize="none"
                        placeholderTextColor={theme.dividerText}
                        style={{
                          borderColor: theme.dividerLine,
                          borderRadius: 12,
                          borderWidth: 1,
                          color: theme.inputText,
                          padding: 12,
                        }}
                      />
                    </View>
                  </View>
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ color: theme.inputText }}>
                      Include uploaded media
                    </Text>
                    <Switch
                      accessibilityLabel="Include uploaded media"
                      value={includeMedia}
                      onValueChange={setIncludeMedia}
                    />
                  </View>
                  {job?.status === "failed" ? (
                    <Text style={{ color: theme.dividerText }}>
                      {job.errorCode === "EXPORT_TOO_LARGE"
                        ? "Choose a shorter date range or exclude media."
                        : "Export couldn't be prepared. Please try again."}
                    </Text>
                  ) : null}
                  <StatusActionButton
                    label={(() => {
                      if (exportBusy) {
                        return "Preparing…";
                      }
                      if (job) {
                        return "Retry export";
                      }
                      return "Prepare export";
                    })()}
                    disabled={exportBusy}
                    onPress={() => {
                      void startExport();
                    }}
                  />
                </>
              );
            }
            if (job.status === "ready") {
              return (
                <>
                  <Text style={{ color: theme.dividerText }}>
                    Ready until {new Date(job.expiresAt).toLocaleTimeString()}.
                  </Text>
                  <StatusActionButton
                    label={
                      exportBusy ? "Downloading…" : "Download and save ZIP"
                    }
                    disabled={exportBusy}
                    onPress={() => {
                      void download();
                    }}
                  />
                </>
              );
            }
            return (
              <>
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: 12,
                  }}
                >
                  <ActivityIndicator />
                  <Text style={{ color: theme.inputText }}>
                    {job.status === "processing"
                      ? "Preparing your archive…"
                      : "Your export is queued…"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={exportBusy}
                  onPress={() => {
                    void cancelExport();
                  }}
                >
                  <Text style={{ color: theme.dividerText, padding: 10 }}>
                    Cancel export
                  </Text>
                </Pressable>
              </>
            );
          })()}
          {exportError ? (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.dividerText }}
            >
              {exportError}
            </Text>
          ) : null}
        </View>
        {snapshot?.notices.length ? (
          <View
            style={{
              borderTopColor: theme.dividerLine,
              borderTopWidth: 1,
              paddingTop: 16,
            }}
          >
            <Text
              style={{ color: theme.inputText, fontFamily: "SofiaProBold" }}
            >
              Incognito session history
            </Text>
            {snapshot.notices.map((session) => (
              <NativeIncognitoUsageNotice key={session.id} session={session} />
            ))}
            {snapshot.nextNoticeCursor ? (
              <StatusActionButton
                label="Load earlier sessions"
                disabled={busy}
                onPress={() => {
                  void loadEarlierNotices();
                }}
              />
            ) : null}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => confirm("clear")}
          style={{
            alignItems: "center",
            borderTopColor: theme.dividerLine,
            borderTopWidth: 1,
            flexDirection: "row",
            gap: 12,
            paddingVertical: 14,
          }}
        >
          <Trash2 size={20} color="#dc2626" />
          <Text style={{ color: "#dc2626" }}>Delete chat for me</Text>
        </Pressable>
        {busy ? <ActivityIndicator /> : null}
      </MessageSheet>
    </>
  );
}
