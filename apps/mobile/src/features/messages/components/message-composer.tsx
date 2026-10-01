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

import { Plus, SendHorizontal, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Gradient3D } from "@/components/surface/gradient-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { pickPhotosAndVideos } from "@/features/composer/lib/pick-media";
import {
  UploadError,
  uploadMedia,
} from "@/features/media-upload/lib/upload-client";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";
import {
  discardMessageMedia,
  linkMessageMedia,
} from "@/features/messages/lib/client";
import type { MessagePayload } from "@/features/messages/lib/crypto";
import {
  panel3d,
  reelsInput,
  sendButton,
} from "@/features/messages/lib/message-recipes";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

// The payload validator caps an album at 10, so the picker does too.
const MAX_MESSAGE_ATTACHMENTS = 10;
// Web's typing heartbeat. Matching it keeps an indicator from flickering on one
// client and sticking on the other.
const TYPING_HEARTBEAT_MS = 3000;

export interface StagedAttachment {
  error: string | null;
  file: PickedMedia;
  id: string;
  mediaId: string | null;
  /** False while uploading, null once READY. */
  progress: number | null;
  /** True only for a row this send created; a dedup hit must never be discarded. */
  owned: boolean;
}

export interface ComposerTarget {
  id: string;
  senderId: string;
  text: string;
}

export function MessageComposer({
  conversationId,
  disabled,
  editing,
  onCancelEdit,
  onCancelReply,
  onSend,
  onTyping,
  replyTo,
}: {
  conversationId: string;
  disabled?: boolean;
  editing: ComposerTarget | null;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onSend: (payload: MessagePayload) => Promise<void>;
  onTyping: () => void;
  replyTo: ComposerTarget | null;
}) {
  const { isDark, theme } = useAppTheme();
  const input = reelsInput(isDark);
  const button = sendButton(isDark);
  // The draft the user is typing, and the text the field shows. They differ only
  // while an edit is being loaded, which is why this is not a plain `useState`.
  // What the user has typed this session, keyed by nothing: it survives a cancel so
  // cancelling an edit restores what they had before it.
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const typingSent = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const aborts = useRef(new Map<string, AbortController>());
  const [discardBase, setDiscardBase] = useState<{
    apiBase: string;
    cookie?: string;
  } | null>(null);

  // The cookie is needed by the unmount sweep and by nothing else, so it is read
  // once on mount rather than threaded through every call site.
  // oxlint-disable-next-line react/set-state-in-effect -- reading a stored credential is an external system, and the value cannot be derived during render
  useEffect(() => {
    void (async () => {
      const cookie = await authClient.getCookie();
      setDiscardBase({ apiBase: getApiBaseUrl(), cookie: cookie ?? undefined });
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
  useEffect(
    () => () => {
      for (const controller of aborts.current.values()) {
        controller.abort();
      }
      aborts.current.clear();
      if (!discardBase) {
        return;
      }
      for (const item of attachmentsRef.current) {
        if (item.mediaId && item.owned) {
          void discardMessageMedia(item.mediaId, discardBase);
        }
      }
    },
    [discardBase]
  );

  // While an edit is active and the user has not typed anything into it, the field
  // shows the message being edited. Derived during render rather than seeded by an
  // effect, which is what the react/set-state-in-effect rule is asking for.
  const fieldValue = editing && draft.length === 0 ? editing.text : draft;

  const isUploading = attachments.some((item) => item.progress !== null);
  const canSend =
    !disabled &&
    !sending &&
    !isUploading &&
    (fieldValue.trim().length > 0 || attachments.length > 0) &&
    attachments.every((item) => item.error === null && item.mediaId !== null);

  const stopTyping = useCallback(() => {
    if (typingTimer.current) {
      clearInterval(typingTimer.current);
      typingTimer.current = null;
    }
    typingSent.current = false;
  }, []);

  useEffect(() => stopTyping, [stopTyping]);

  const noteTyping = useCallback(() => {
    if (typingSent.current) {
      return;
    }
    typingSent.current = true;
    onTyping();
    typingTimer.current = setInterval(() => {
      onTyping();
    }, TYPING_HEARTBEAT_MS);
  }, [onTyping]);

  const update = useCallback((id: string, patch: Partial<StagedAttachment>) => {
    setAttachments((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const attach = useCallback(() => {
    const remaining = MAX_MESSAGE_ATTACHMENTS - attachmentsRef.current.length;
    if (remaining <= 0) {
      return;
    }
    // Everything after the picker is module-level: React Compiler cannot lower a
    // `try`/`finally` inside a component, and the upload loop has to reach the
    // abort registry and the store without closing over render state.
    void (async () => {
      const picked = await pickPhotosAndVideos({
        imagesOnly: true,
        remaining,
      });
      if (picked.length === 0) {
        return;
      }
      const staged = picked.map((file, index) => ({
        error: null as string | null,
        file,
        id: `${file.uri}-${index}-${attachmentsRef.current.length}`,
        mediaId: null as string | null,
        owned: false,
        progress: 0 as number | null,
      }));
      setAttachments((current) => [...current, ...staged]);
      await uploadStagedAttachments(staged, {
        aborts,
        conversationId,
        onPatch: update,
      });
    })();
  }, [conversationId, update]);

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
        setDraft("");
        setAttachments([]);
        onCancelEdit();
        onCancelReply();
        stopTyping();
      },
      replyTo,
      send: onSend,
    });
  }, [
    attachments,
    canSend,
    onCancelEdit,
    fieldValue,
    onCancelReply,
    onSend,
    replyTo,
    stopTyping,
  ]);

  const atCapacity = attachments.length >= MAX_MESSAGE_ATTACHMENTS;

  return (
    <View style={[styles.root, { borderTopColor: theme.dividerLine }]}>
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
        <View style={styles.strip}>
          {attachments.map((item) => (
            <AttachmentTile
              attachment={item}
              key={item.id}
              onRemove={() => remove(item.id)}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <Pressable
          accessibilityLabel="Add photo"
          accessibilityRole="button"
          disabled={disabled || atCapacity}
          hitSlop={8}
          onPress={attach}
          style={styles.attachButton}
        >
          <Plus color={theme.dividerText} size={22} strokeWidth={2.2} />
        </Pressable>
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
          <TextInput
            accessibilityLabel="Message"
            editable={!disabled}
            multiline
            onChangeText={(value) => {
              setDraft(value);
              if (value.trim().length > 0) {
                noteTyping();
              } else {
                stopTyping();
              }
            }}
            placeholder="Message"
            placeholderTextColor={isDark ? "#6b6b6b" : "#9a9a9a"}
            style={[
              styles.fieldInput,
              { color: isDark ? "#eeeeee" : "#202020" },
            ]}
            value={fieldValue}
          />
        </View>
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
              <SendHorizontal
                color={canSend ? "#ffffff" : "#ffffff99"}
                size={18}
                strokeWidth={2.4}
              />
            </Gradient3D>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Uploads the staged attachments, one at a time.
 *
 * Sequential on purpose: parallel presigned PUTs on a phone's connection make
 * every one of them slower and the tiles race each other for the same bandwidth.
 */
async function uploadStagedAttachments(
  staged: StagedAttachment[],
  context: {
    aborts: React.RefObject<Map<string, AbortController>>;
    conversationId: string;
    onPatch: (id: string, patch: Partial<StagedAttachment>) => void;
  }
): Promise<void> {
  for (const item of staged) {
    // oxlint-disable-next-line no-await-in-loop -- see the note above
    await stageOneAttachment(item, context);
  }
}

/**
 * Uploads one staged attachment and folds its progress into the tile.
 *
 * Module scope, not a component body, for two reasons: React Compiler cannot lower
 * a `try`/`finally` inside a component, and the error path has to reach `discard`
 * and the store without closing over render state.
 */
async function stageOneAttachment(
  item: StagedAttachment,
  context: {
    aborts: React.RefObject<Map<string, AbortController>>;
    conversationId: string;
    onPatch: (id: string, patch: Partial<StagedAttachment>) => void;
  }
): Promise<void> {
  const controller = new AbortController();
  context.aborts.current.set(item.id, controller);
  const outcome = await uploadMedia(item.file, {
    conversationId: context.conversationId,
    onBytes: (percent) => context.onPatch(item.id, { progress: percent }),
    // A dedup hit reused bytes that belong to another message, so this row is not
    // ours to discard later.
    onDeduplicated: (deduplicated) =>
      context.onPatch(item.id, { owned: !deduplicated }),
    onMediaId: (mediaId) => context.onPatch(item.id, { mediaId }),
    onStage: () => context.onPatch(item.id, { progress: null }),
    purpose: "message",
    signal: controller.signal,
    // The composer gates the send itself, so there is no need to block here on the
    // pipeline; the tile's progress reflects the bytes.
    waitForProcessing: false,
  })
    .then((result) => {
      context.onPatch(item.id, { progress: null });
      if (result.status !== "READY") {
        context.onPatch(item.id, {
          error: "Attachment was rejected by scanning",
        });
      }
      return null;
    })
    .catch((error: unknown) => {
      // A failed upload still leaves a server row this send created, so it is
      // reclaimed rather than orphaned.
      logWarn("message attachment upload failed", {
        step: error instanceof UploadError ? error.step : "upload",
      });
      context.onPatch(item.id, {
        error:
          error instanceof UploadError ? error.userMessage : "Upload failed",
        progress: null,
      });
      const mediaId = error instanceof UploadError ? error.mediaId : null;
      if (mediaId && !item.owned) {
        void discardMessageMedia(mediaId, {
          apiBase: getApiBaseUrl(),
          baseFetch: fetch,
        });
      }
      return null;
    });
  context.aborts.current.delete(item.id);
  return outcome ?? undefined;
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
    replyTo: input.replyTo,
  });
  await delivery.then(
    () => {
      input.onSuccess();
    },
    () => {
      // The draft stays in the field. Losing what someone typed because a send
      // failed is the one outcome a composer must never produce.
    }
  );
  input.onSettled();
}

/**
 * Delivers the composer draft.
 *
 * A media payload carries ONE `kind` for all of its images, so a mixed batch (photos
 * plus a GIF) becomes two messages rather than one malformed one. The caption goes
 * on the first only: repeating it would read as a duplicate.
 */
async function deliverMessages(input: {
  attachments: StagedAttachment[];
  caption: string;
  onSend: (payload: MessagePayload) => Promise<void>;
  replyTo: ComposerTarget | null;
}): Promise<void> {
  const { attachments, caption, onSend, replyTo } = input;
  if (attachments.length === 0) {
    await onSend({
      content: caption,
      replyToId: replyTo?.id,
      replyToSenderId: replyTo?.senderId,
      type: "text",
    });
    return;
  }
  const photos = attachments.filter(
    (item) => item.file.mimeType !== "image/gif"
  );
  const gifs = attachments.filter((item) => item.file.mimeType === "image/gif");
  if (photos.length > 0) {
    await onSend(buildMediaPayload(photos, "image", caption, replyTo));
  }
  if (gifs.length > 0) {
    await onSend(buildMediaPayload(gifs, "gif", "", replyTo));
  }
}

function buildMediaPayload(
  items: StagedAttachment[],
  kind: "gif" | "image",
  caption: string,
  replyTo: ComposerTarget | null
): MessagePayload {
  return {
    content: caption || undefined,
    images: items.map((item) => ({
      height: item.file.height,
      url: `/api/media/${item.mediaId}`,
      width: item.file.width,
    })),
    kind,
    replyToId: replyTo?.id,
    replyToSenderId: replyTo?.senderId,
    type: "media",
  };
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
}: {
  attachment: StagedAttachment;
  onRemove: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.tile, { borderColor: theme.dividerLine }]}>
      <Image
        source={{ uri: attachment.file.uri }}
        style={StyleSheet.absoluteFill}
      />
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
    height: 40,
    justifyContent: "center",
    width: 30,
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
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  fieldInput: {
    fontFamily: "SofiaProReg",
    fontSize: 15,
    maxHeight: 96,
    minHeight: 22,
    padding: 0,
    textAlignVertical: "center",
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
    paddingBottom: 8,
    paddingTop: 8,
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
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
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
