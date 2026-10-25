import {
  MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES,
  maxMessageAttachmentBytes,
  messageAttachmentKind,
  messageAttachmentMimeType,
} from "@asm/media";
import {
  FileText,
  Film,
  ArrowUp,
  ImagePlus,
  Plus,
  Pencil,
  Smile,
  X,
} from "lucide-react-native";
// The message composer: text, reply and edit context, attachments, and send.
//
// Ported from apps/web/src/components/messages/message-composer.tsx, with the
// send path rewritten around the native uploader.
//
// THE SEND PATH IS WHERE THE PORT HAD TO DIVERGE MOST. On web the sender picks a
// File and the bytes ride in the fetch. Here the bytes never enter the JS heap:
// `pickPhotosAndVideos` returns file:// URIs and `uploadMedia` PUTs them with the
// native upload task, so a 12MP photo is not base64-encoded into a string on the
// way to the server.
//
// WHY EVERY ATTACHMENT MUST BE READY BEFORE ANY IS SENT: the serving route gates on
// READY, so a message that went out early would hand the peer a broken image. It
// also means one slow photo does not send the rest out of order, and the ratchet
// chain stays in step with what the peer can actually read.
import { useCallback, useEffect, useRef, useState } from "react";
import type { TextInputInstance } from "react-native";
import {
  Image,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { toast } from "@/components/feedback/toast";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { IconButton3D } from "@/components/surface/icon-button-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  downloadGif,
  pickMessageFiles,
  pickPhotosAndVideos,
} from "@/features/composer/lib/pick-media";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";
import {
  discardMessageMedia,
  linkMessageMedia,
} from "@/features/messages/lib/client";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import { deliverMessages } from "@/features/messages/lib/deliver-messages";
import { uploadStagedAttachments } from "@/features/messages/lib/message-attachment-upload";
import type { StagedAttachment } from "@/features/messages/lib/message-attachment-upload";
import {
  panel3d,
  reelsInput,
  sendButton,
} from "@/features/messages/lib/message-recipes";
import { useMessagesForeground } from "@/features/messages/state/use-messages-foreground";
import { useProfileMediaCropper } from "@/features/profile/components/profile-media-cropper";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

import { useMessageTextDraft } from "../state/message-text-draft";
import { useSharedPostDraft } from "../state/shared-post-draft";
import { MessageExpressionKeyboard } from "./message-expression-keyboard";
import { MessagePostPreview } from "./message-post-preview";

// The payload validator caps an album at 10, so the picker does too.
const MAX_MESSAGE_ATTACHMENTS = 10;
// Web's typing heartbeat. Matching it keeps an indicator from flickering on one
// client and sticking on the other.
const TYPING_HEARTBEAT_MS = 3000;

export interface ComposerTarget {
  id: string;
  senderId: string;
  text: string;
}

export function MessageComposer({
  stickersEnabled,
  conversationId,
  incognitoSessionId,
  disabled,
  editing,
  onCancelEdit,
  onCancelReply,
  onSend,
  onTyping,
  replyTo,
  peerName,
}: {
  conversationId: string;
  stickersEnabled: boolean;
  incognitoSessionId?: string;
  disabled?: boolean;
  editing: ComposerTarget | null;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onSend: (payload: MessagePayload) => Promise<void>;
  onTyping: () => void;
  replyTo: ComposerTarget | null;
  peerName: string;
}) {
  const { isDark, theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const fieldRef = useRef<TextInputInstance>(null);
  useEffect(() => {
    if (replyTo?.id) {
      fieldRef.current?.focus();
    }
  }, [replyTo?.id]);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const [expressionKeyboardOpen, setExpressionKeyboardOpen] = useState(false);
  const [expressionTab, setExpressionTab] = useState<
    "emoji" | "gifs" | "stickers"
  >("emoji");
  const [selection, setSelection] = useState({ end: 0, start: 0 });
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true)
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const incognito = Boolean(incognitoSessionId);
  const input = reelsInput(incognito ? true : isDark);
  const button = sendButton(incognito ? true : isDark);
  // The draft the user is typing, and the text the field shows. They differ only
  // while an edit is being loaded, which is why this is not a plain `useState`.
  // What the user has typed this session, keyed by nothing: it survives a cancel so
  // cancelling an edit restores what they had before it.
  const { user } = useSessionContext();
  const draftKey = `${user?.id ?? ""}:${conversationId}`;
  const [draft, setDraft] = useState(() =>
    incognitoSessionId
      ? ""
      : (useMessageTextDraft.getState().drafts[draftKey] ?? "")
  );
  const sharedPostId = useSharedPostDraft((state) =>
    incognitoSessionId ? undefined : state.drafts[conversationId]
  );
  const { crop, cropper } = useProfileMediaCropper();
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const viewOnceMode = attachments.some((attachment) => attachment.viewOnce);
  const typingSent = useRef(false);
  const lastTypedAt = useRef(0);
  const foreground = useMessagesForeground();
  const typingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const aborts = useRef(new Map<string, AbortController>());
  const composerMounted = useRef(true);
  const discardBaseRef = useRef<{
    apiBase: string;
    cookie?: string;
  } | null>(null);

  // The cookie is needed by the unmount sweep and by nothing else, so it is read
  // once on mount rather than threaded through every call site.
  useEffect(() => {
    void (async () => {
      const cookie = await authClient.getCookie().catch(() => null);
      discardBaseRef.current = {
        apiBase: getApiBaseUrl(),
        cookie: cookie ?? undefined,
      };
    })();
  }, []);

  // Every staged upload is aborted on unmount. The rows themselves are reclaimed by
  // the server's own abandoned-upload sweep for non-message media; message media
  // has no such sweep, so a discard is attempted for rows this send created.
  const attachmentsRef = useRef<StagedAttachment[]>([]);
  // Mirrored in an effect rather than during render: writing a ref while rendering
  // leaves it describing state the render may never commit.
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    composerMounted.current = true;
    const uploadControllers = aborts.current;
    return () => {
      composerMounted.current = false;
      for (const controller of uploadControllers.values()) {
        controller.abort();
      }
      uploadControllers.clear();
      const discardBase = discardBaseRef.current;
      if (!discardBase) {
        return;
      }
      for (const item of attachmentsRef.current) {
        if (item.mediaId && item.owned) {
          void discardMessageMedia(item.mediaId, discardBase);
        }
      }
    };
  }, []);

  // While an edit is active and the user has not typed anything into it, the field
  // shows the message being edited. Derived during render rather than seeded by an
  // effect, which is what the react/set-state-in-effect rule is asking for.
  const fieldValue = editing && draft.length === 0 ? editing.text : draft;

  const isUploading = attachments.some((item) => item.progress !== null);
  const canSend =
    !disabled &&
    !sending &&
    !isUploading &&
    (!viewOnceMode || attachments.length > 0) &&
    (fieldValue.trim().length > 0 ||
      attachments.length > 0 ||
      Boolean(sharedPostId)) &&
    attachments.every((item) => item.error === null && item.mediaId !== null);

  const stopTyping = useCallback(() => {
    if (typingTimer.current) {
      clearInterval(typingTimer.current);
      typingTimer.current = null;
    }
    typingSent.current = false;
  }, []);

  useEffect(() => stopTyping, [stopTyping]);
  useEffect(() => {
    if (!foreground) {
      stopTyping();
    }
  }, [foreground, stopTyping]);

  const noteTyping = useCallback(() => {
    lastTypedAt.current = Date.now();
    if (typingSent.current) {
      return;
    }
    typingSent.current = true;
    onTyping();
    typingTimer.current = setInterval(() => {
      if (Date.now() - lastTypedAt.current > 4000) {
        stopTyping();
        return;
      }
      onTyping();
    }, TYPING_HEARTBEAT_MS);
  }, [onTyping, stopTyping]);

  const update = useCallback((id: string, patch: Partial<StagedAttachment>) => {
    setAttachments((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const insertEmoji = useCallback(
    (emoji: string) => {
      const start = Math.min(selection.start, fieldValue.length);
      const end = Math.min(Math.max(start, selection.end), fieldValue.length);
      const next = `${fieldValue.slice(0, start)}${emoji}${fieldValue.slice(end)}`;
      const caret = start + emoji.length;
      setDraft(next);
      setSelection({ end: caret, start: caret });
      if (!incognitoSessionId) {
        if (next) {
          useMessageTextDraft.getState().save(draftKey, next);
        } else {
          useMessageTextDraft.getState().clear(draftKey);
        }
      }
      if (next.trim().length > 0) {
        noteTyping();
      }
    },
    [draftKey, fieldValue, incognitoSessionId, noteTyping, selection]
  );

  const handleGifSelect = useCallback(
    async (gif: Parameters<typeof downloadGif>[0]) => {
      setExpressionKeyboardOpen(false);
      try {
        const file = await downloadGif(gif);
        if (attachmentsRef.current.length >= MAX_MESSAGE_ATTACHMENTS) {
          return;
        }
        const staged: StagedAttachment = {
          error: null,
          file,
          id: `${file.uri}-${Date.now()}`,
          mediaId: null,
          owned: false,
          progress: 0,
        };
        setAttachments((current) => [...current, staged]);
        await uploadStagedAttachments([staged], {
          aborts,
          conversationId,
          incognitoSessionId,
          onPatch: update,
        });
      } catch {
        toast({
          description: "Please try again.",
          title: "Couldn't add GIF",
          variant: "destructive",
        });
      }
    },
    [conversationId, incognitoSessionId, update]
  );

  const handleStickerSend = useCallback(
    async (payload: MessagePayload) => {
      await onSend({
        ...payload,
        replyToId: replyTo?.id,
        replyToSenderId: replyTo?.senderId,
      });
      onCancelReply();
    },
    [onCancelReply, onSend, replyTo?.id, replyTo?.senderId]
  );

  const editAttachment = useCallback(
    async (item: StagedAttachment) => {
      Keyboard.dismiss();
      try {
        const result = await crop(
          { purpose: "message", source: item.file },
          "post",
          {
            canViewOnce:
              attachmentsRef.current.length === 1 &&
              !fieldValue.trim() &&
              !sharedPostId,
            viewOnce: item.viewOnce ?? false,
          }
        );
        if (
          !composerMounted.current ||
          !result ||
          !attachmentsRef.current.some((entry) => entry.id === item.id)
        ) {
          return false;
        }
        const previous = attachmentsRef.current.find(
          (entry) => entry.id === item.id
        );
        const staged: StagedAttachment = {
          error: null,
          file: { ...result.source, size: result.source.size ?? 0 },
          id: `${item.id}-edit-${result.source.uri}`,
          mediaId: null,
          owned: false,
          progress: 0,
          viewOnce: result.viewOnce ?? false,
        };
        aborts.current.get(item.id)?.abort();
        aborts.current.delete(item.id);
        attachmentsRef.current = attachmentsRef.current.map((entry) =>
          entry.id === item.id ? staged : entry
        );
        setAttachments(attachmentsRef.current);
        await uploadStagedAttachments([staged], {
          aborts,
          conversationId,
          incognitoSessionId,
          onPatch: update,
        });
        if (previous?.mediaId && previous.owned) {
          void discardMessageMedia(previous.mediaId, {
            apiBase: getApiBaseUrl(),
            baseFetch: fetch,
          });
        }
        return true;
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Try another image",
          title: "Couldn't edit image",
          variant: "destructive",
        });
        return false;
      }
    },
    [crop, fieldValue, sharedPostId, conversationId, incognitoSessionId, update]
  );

  const stagePickedFiles = useCallback(
    async (picked: PickedMedia[], viewOnce = false) => {
      if (!composerMounted.current) {
        return;
      }
      if (!viewOnce && attachmentsRef.current.some((item) => item.viewOnce)) {
        return;
      }
      if (
        viewOnce &&
        (attachmentsRef.current.length > 0 ||
          picked.length !== 1 ||
          !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(
            picked[0]?.mimeType.toLowerCase() ?? ""
          ))
      ) {
        toast({
          description: "Choose one JPEG, PNG, WebP, or AVIF photo.",
          title: "View once photo",
          variant: "destructive",
        });
        return;
      }
      let totalBytes = attachmentsRef.current.reduce(
        (total, item) => total + item.file.size,
        0
      );
      const accepted: PickedMedia[] = [];
      let rejected = 0;
      let tooLarge = 0;
      for (const candidate of picked) {
        const mimeType = messageAttachmentMimeType(
          candidate.mimeType,
          candidate.name
        );
        const { size } = candidate;
        const typeLimit = maxMessageAttachmentBytes(mimeType);
        if (!messageAttachmentKind(mimeType)) {
          rejected += 1;
          continue;
        }
        if (
          size <= 0 ||
          size > typeLimit ||
          totalBytes + size > MAX_MESSAGE_ATTACHMENT_TOTAL_BYTES
        ) {
          tooLarge += 1;
          continue;
        }
        totalBytes += size;
        accepted.push({ ...candidate, mimeType, size });
      }
      if (rejected > 0) {
        toast({
          description: "Choose photos, videos, audio, PDF, or Office files.",
          title: "Unsupported file",
          variant: "destructive",
        });
      }
      if (tooLarge > 0) {
        toast({
          description: "One or more files exceed the message size limit.",
          title: "Attachment too large",
          variant: "destructive",
        });
      }
      const available = Math.max(
        0,
        MAX_MESSAGE_ATTACHMENTS - attachmentsRef.current.length
      );
      if (accepted.length > available) {
        toast({
          description: `You can send up to ${MAX_MESSAGE_ATTACHMENTS} attachments at a time.`,
          title: "Attachment limit",
          variant: "destructive",
        });
      }
      const staged = accepted.slice(0, available).map((file, index) => ({
        error: null as string | null,
        file,
        id: `${file.uri}-${index}-${attachmentsRef.current.length}`,
        mediaId: null as string | null,
        owned: false,
        progress: 0 as number | null,
        viewOnce,
      }));
      if (staged.length === 0) {
        return;
      }
      attachmentsRef.current = [...attachmentsRef.current, ...staged];
      setAttachments(attachmentsRef.current);
      if (
        picked.length === 1 &&
        staged.length === 1 &&
        attachmentsRef.current.length === 1 &&
        messageAttachmentKind(staged[0].file.mimeType) === "image"
      ) {
        const edited = await editAttachment(staged[0]);
        if (
          edited ||
          !composerMounted.current ||
          !attachmentsRef.current.some((entry) => entry.id === staged[0].id)
        ) {
          return;
        }
      }
      await uploadStagedAttachments(staged, {
        aborts,
        conversationId,
        incognitoSessionId,
        onPatch: update,
      });
    },
    [conversationId, incognitoSessionId, update, editAttachment]
  );

  const choosePhotosAndVideos = useCallback(() => {
    setAttachmentMenuOpen(false);
    if (viewOnceMode) {
      return;
    }
    const remaining = MAX_MESSAGE_ATTACHMENTS - attachmentsRef.current.length;
    if (remaining <= 0) {
      return;
    }
    runMessageAttachmentPicker(
      () => pickPhotosAndVideos({ remaining }),
      stagePickedFiles,
      "Couldn't open photos"
    );
  }, [stagePickedFiles, viewOnceMode]);

  const chooseFiles = useCallback(() => {
    setAttachmentMenuOpen(false);
    if (viewOnceMode) {
      return;
    }
    const remaining = MAX_MESSAGE_ATTACHMENTS - attachmentsRef.current.length;
    if (remaining <= 0) {
      return;
    }
    runMessageAttachmentPicker(
      () => pickMessageFiles(remaining),
      stagePickedFiles,
      "Couldn't open files"
    );
  }, [stagePickedFiles, viewOnceMode]);

  const attach = useCallback(() => {
    Keyboard.dismiss();
    setAttachmentMenuOpen(true);
  }, []);

  const remove = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
    aborts.current.delete(id);
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.mediaId && target.owned) {
        void discardMessageMedia(target.mediaId, {
          apiBase: getApiBaseUrl(),
          baseFetch: fetch,
        });
      }
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const handleSend = useCallback(() => {
    if (!canSend) {
      return;
    }
    setSending(true);
    void runSend({
      attachments,
      caption: fieldValue.trim(),
      onSettled: () => {
        setSending(false);
      },
      onSuccess: () => {
        useSharedPostDraft.getState().clear(conversationId);
        if (!incognitoSessionId) {
          useMessageTextDraft.getState().clear(draftKey);
        }
        setDraft("");
        setAttachments([]);
        onCancelEdit();
        onCancelReply();
        stopTyping();
      },
      postId: sharedPostId,
      replyTo,
      send: onSend,
    });
  }, [
    conversationId,
    incognitoSessionId,
    sharedPostId,
    attachments,
    canSend,
    onCancelEdit,
    fieldValue,
    onCancelReply,
    onSend,
    replyTo,
    stopTyping,
    draftKey,
  ]);

  const atCapacity = attachments.length >= MAX_MESSAGE_ATTACHMENTS;

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: incognito ? "#09090b" : undefined,
          borderTopColor: incognito ? "#3f3f46" : theme.dividerLine,
          paddingBottom: 10 + (keyboardVisible ? 0 : insets.bottom),
        },
      ]}
    >
      {cropper}
      {sharedPostId ? (
        <View
          style={{
            alignSelf: "flex-start",
            marginBottom: 8,
            maxWidth: 320,
            width: "100%",
          }}
        >
          <MessagePostPreview postId={sharedPostId} />
          <View style={{ position: "absolute", right: 8, top: 8 }}>
            <IconButton3D
              accessibilityLabel="Remove shared post"
              icon={X}
              size={28}
              onPress={() =>
                useSharedPostDraft.getState().clear(conversationId)
              }
            />
          </View>
        </View>
      ) : null}
      {editing ? (
        <ContextBar
          label="Editing message"
          onDismiss={onCancelEdit}
          text={editing.text}
        />
      ) : null}
      {replyTo && !editing ? (
        <ContextBar
          label="Replying to"
          onDismiss={onCancelReply}
          text={replyTo.text}
        />
      ) : null}
      {attachments.length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.strip}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, height: 72 }}
        >
          {attachments.map((item) => (
            <AttachmentTile
              attachment={item}
              key={item.id}
              onRemove={() => remove(item.id)}
              onEdit={() => {
                void editAttachment(item);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
      {expressionKeyboardOpen ? (
        <MessageExpressionKeyboard
          canCreate={!incognito && !editing}
          conversationId={conversationId}
          disabled={Boolean(disabled) || Boolean(editing) || viewOnceMode}
          incognitoSessionId={incognitoSessionId}
          onEmoji={insertEmoji}
          onGifSelect={handleGifSelect}
          onSendSticker={handleStickerSend}
          onTabChange={setExpressionTab}
          stickersEnabled={stickersEnabled}
          tab={expressionTab}
        />
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: input.background,
            borderColor: input.border,
            boxShadow: input.shadows,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Add attachment"
          accessibilityRole="button"
          disabled={
            disabled ||
            atCapacity ||
            Boolean(sharedPostId) ||
            viewOnceMode ||
            Boolean(editing)
          }
          hitSlop={6}
          onPress={attach}
          style={styles.attachButton}
        >
          <Plus color={theme.dividerText} size={21} />
        </Pressable>
        <Pressable
          accessibilityLabel={
            expressionKeyboardOpen
              ? "Close expression keyboard"
              : "Open expression keyboard"
          }
          accessibilityRole="button"
          disabled={Boolean(disabled) || viewOnceMode}
          hitSlop={6}
          onPress={() => {
            if (expressionKeyboardOpen) {
              setExpressionKeyboardOpen(false);
              return;
            }
            Keyboard.dismiss();
            setExpressionTab("emoji");
            setExpressionKeyboardOpen(true);
          }}
          style={styles.attachButton}
        >
          <Smile color={theme.dividerText} size={20} />
        </Pressable>
        <TextInput
          ref={fieldRef}
          accessibilityLabel="Message"
          editable={!disabled && !viewOnceMode}
          multiline
          onFocus={() => setExpressionKeyboardOpen(false)}
          onChangeText={(value) => {
            setDraft(value);
            if (!incognitoSessionId) {
              if (value) {
                useMessageTextDraft.getState().save(draftKey, value);
              } else {
                useMessageTextDraft.getState().clear(draftKey);
              }
            }
            if (value.trim().length > 0) {
              noteTyping();
            } else {
              stopTyping();
            }
          }}
          onSelectionChange={(event) =>
            setSelection(event.nativeEvent.selection)
          }
          placeholder={(() => {
            if (viewOnceMode) {
              return "View once photo";
            }
            if (incognitoSessionId) {
              return "Message in incognito…";
            }
            if (editing) {
              return "Edit message…";
            }
            return `Message${peerName ? ` ${peerName}` : ""}…`;
          })()}
          placeholderTextColor={incognito || isDark ? "#6b6b6b" : "#9a9a9a"}
          style={[
            styles.fieldInput,
            { color: incognito || isDark ? "#eeeeee" : "#202020" },
          ]}
          selection={selection}
          value={fieldValue}
        />
        <Pressable
          accessibilityLabel="Send"
          accessibilityRole="button"
          disabled={!canSend}
          hitSlop={8}
          onPress={handleSend}
          style={styles.sendWrap}
        >
          {({ pressed }) => (
            <Gradient3D
              colors={pressed ? button.pressedGradient : button.restingGradient}
              radius={9999}
              shadows={button.shadows}
              style={[styles.send, !canSend && styles.sendDisabled]}
            >
              <ArrowUp
                color={canSend ? "#ffffff" : "#ffffff99"}
                size={16}
                strokeWidth={2.4}
              />
            </Gradient3D>
          )}
        </Pressable>
      </View>
      <Modal
        animationType="slide"
        onRequestClose={() => setAttachmentMenuOpen(false)}
        transparent
        visible={attachmentMenuOpen}
      >
        <Pressable
          accessibilityLabel="Close attachment menu"
          onPress={() => setAttachmentMenuOpen(false)}
          style={styles.attachmentScrim}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.attachmentSheet,
              {
                backgroundColor: input.background,
                borderColor: input.border,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <Text
              style={[
                styles.attachmentSheetTitle,
                { color: isDark ? "#a0a0a0" : "#646464" },
              ]}
            >
              Add to your message
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={viewOnceMode}
              onPress={choosePhotosAndVideos}
              style={styles.attachmentSheetRow}
            >
              <ImagePlus color={theme.dividerText} size={19} />
              <Text
                style={[
                  styles.attachmentSheetLabel,
                  { color: isDark ? "#f1f1f1" : "#202020" },
                ]}
              >
                Photos & videos
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={viewOnceMode}
              onPress={chooseFiles}
              style={styles.attachmentSheetRow}
            >
              <FileText color={theme.dividerText} size={19} />
              <Text
                style={[
                  styles.attachmentSheetLabel,
                  { color: isDark ? "#f1f1f1" : "#202020" },
                ]}
              >
                Files
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function runMessageAttachmentPicker(
  pick: () => Promise<PickedMedia[]>,
  stage: (files: PickedMedia[]) => Promise<void>,
  title: string
): void {
  void (async () => {
    try {
      await stage(await pick());
    } catch {
      toast({
        description: "Please try again.",
        title,
        variant: "destructive",
      });
    }
  })();
}

/**
 * Drives one send and reports back through callbacks.
 *
 * Module scope because React Compiler rejects promise chaining inside a component:
 * the three setters a successful send needs cannot be expressed as an `await`
 * chain here without the compiler refusing to lower it.
 */
async function runSend(input: {
  attachments: StagedAttachment[];
  postId?: string;
  caption: string;
  onSettled: () => void;
  onSuccess: () => void;
  replyTo: ComposerTarget | null;
  send: (payload: MessagePayload) => Promise<void>;
}): Promise<void> {
  const delivery = deliverMessages({
    attachments: input.attachments,
    caption: input.caption,
    onSend: input.send,
    postId: input.postId,
    replyTo: input.replyTo,
  });
  await delivery.then(
    () => {
      input.onSuccess();
    },
    (error: unknown) => {
      // The draft stays in the field. Losing what someone typed because a send
      // failed is the one outcome a composer must never produce.
      //
      // Web raises the same pair from its send path
      // (`apps/web/src/components/messages/message-composer.tsx`): "Message not
      // sent", with the thrown message as the description when there is one. The
      // draft surviving is not a substitute for saying so -- without this the
      // send fails silently and the only symptom is the text still sitting there.
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't send message",
        title: "Message not sent",
        variant: "destructive",
      });
    }
  );
  input.onSettled();
}

/**
 * The sender's client is the only party that knows the media ids -- they live
 * inside the encrypted payload -- so it re-asserts the conversation link when it
 * renders its own media message. Rows created before that binding existed are
 * readable by the uploader but 404 for the peer, which is a one-sided message.
 */
export async function reclaimOwnMedia(
  mediaIds: string[],
  conversationId: string
): Promise<void> {
  for (const mediaId of mediaIds) {
    // oxlint-disable-next-line no-await-in-loop -- one rebind per image, and each is an independent best-effort request whose failure must not skip the rest
    await linkMessageMedia(mediaId, conversationId, {
      apiBase: getApiBaseUrl(),
      baseFetch: fetch,
    });
  }
}

// The edit / reply banner. A quiet surface, not a chip: it has to read as context
// for the field below it.
function ContextBar({
  label,
  onDismiss,
  text,
}: {
  label: string;
  onDismiss: () => void;
  text: string;
}) {
  const { isDark, theme } = useAppTheme();
  const panel = panel3d(isDark);
  return (
    <View
      style={[
        styles.contextBar,
        {
          backgroundColor: panel.background,
          borderColor: panel.border,
          boxShadow: panel.shadows,
        },
      ]}
    >
      <View style={styles.contextTextWrap}>
        <Text style={[styles.contextLabel, { color: theme.dividerText }]}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            styles.contextText,
            { color: isDark ? "#e8e8e8" : "#202020" },
          ]}
        >
          {text}
        </Text>
      </View>
      <Pressable accessibilityLabel="Cancel" hitSlop={8} onPress={onDismiss}>
        <X color={theme.dividerText} size={16} />
      </Pressable>
    </View>
  );
}

// A staged attachment: the thumbnail, a progress bar while the bytes move, and an
// error overlay, because a silently dead tile tells the sender nothing.
function AttachmentTile({
  attachment,
  onRemove,
  onEdit,
}: {
  attachment: StagedAttachment;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const { theme } = useAppTheme();
  const isImage = attachment.file.mimeType.startsWith("image/");
  const isVideo = attachment.file.mimeType.startsWith("video/");
  return (
    <View
      style={[
        styles.tile,
        { borderColor: theme.dividerLine, width: isImage ? 64 : 208 },
      ]}
    >
      {isImage ? (
        <Image
          source={{ uri: attachment.file.uri }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.fileTilePreview}>
          {isVideo ? (
            <Film color={theme.dividerText} size={22} />
          ) : (
            <FileText color={theme.dividerText} size={22} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={[styles.fileTileName, { color: theme.inputText }]}
            >
              {attachment.file.name}
            </Text>
            <Text
              style={{ color: theme.dividerText, fontSize: 11, marginTop: 3 }}
            >
              {attachment.file.size >= 1024 * 1024
                ? `${(attachment.file.size / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.max(1, Math.round(attachment.file.size / 1024))} KB`}
            </Text>
          </View>
        </View>
      )}
      {isImage ? (
        <View style={{ bottom: 4, left: 4, position: "absolute" }}>
          <IconButton3D
            accessibilityLabel={
              attachment.file.mimeType === "image/gif"
                ? "Edit GIF"
                : "Edit image"
            }
            icon={Pencil}
            size={28}
            onPress={onEdit}
          />
        </View>
      ) : null}
      {attachment.viewOnce ? (
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderRadius: 10,
            bottom: 6,
            paddingHorizontal: 6,
            paddingVertical: 3,
            position: "absolute",
            right: 6,
          }}
        >
          <Text style={{ color: theme.inputText, fontSize: 10 }}>1×</Text>
        </View>
      ) : null}
      {attachment.progress === null ? null : (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            max: 100,
            now: Math.round(attachment.progress),
          }}
          style={styles.progressTrack}
        >
          <View
            style={[styles.progressFill, { width: `${attachment.progress}%` }]}
          />
        </View>
      )}
      {attachment.error ? (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{attachment.error}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityLabel="Remove attachment"
        hitSlop={6}
        onPress={onRemove}
        style={[styles.tileRemove, { borderColor: theme.dividerLine }]}
      >
        <X color="#ffffff" size={12} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  attachButton: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  attachmentScrim: {
    backgroundColor: "#00000055",
    flex: 1,
    justifyContent: "flex-end",
  },
  attachmentSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  attachmentSheetLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 15,
  },
  attachmentSheetRow: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: 14,
    minHeight: 52,
    paddingHorizontal: 12,
  },
  attachmentSheetTitle: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
  },
  contextBar: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    marginHorizontal: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  contextLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
  },
  contextText: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
  },
  contextTextWrap: {
    flex: 1,
  },
  errorOverlay: {
    alignItems: "center",
    backgroundColor: "#000000bb",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: 4,
    position: "absolute",
    right: 0,
    top: 0,
  },
  errorText: {
    color: "#ffffff",
    fontFamily: "SofiaProReg",
    fontSize: 9,
    textAlign: "center",
  },
  field: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  fieldInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    maxHeight: 128,
    minHeight: 32,
    paddingHorizontal: 0,
    paddingVertical: 4,
    textAlignVertical: "center",
  },
  fileTileName: {
    color: "#76767b",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    textAlign: "left",
  },
  fileTilePreview: {
    alignItems: "center",
    backgroundColor: "rgba(127,127,127,0.12)",
    flex: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingRight: 28,
  },
  inputRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  progressFill: {
    backgroundColor: "#ff9500",
    height: "100%",
  },
  progressTrack: {
    backgroundColor: "#00000055",
    bottom: 0,
    height: 3,
    left: 0,
    position: "absolute",
    right: 0,
  },
  root: {
    borderTopWidth: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  send: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  sendDisabled: {
    opacity: 0.5,
  },
  sendWrap: {
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  strip: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  tile: {
    borderRadius: 12,
    borderWidth: 1,
    height: 64,
    overflow: "hidden",
    width: 64,
  },
  tileRemove: {
    alignItems: "center",
    backgroundColor: "#000000aa",
    borderRadius: 9999,
    borderWidth: 1,
    height: 20,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    top: 2,
    width: 20,
  },
});
