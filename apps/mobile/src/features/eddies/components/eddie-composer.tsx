// Inline eddie composer, 1:1 port of web's CommentInput
// (components/comments/composer/comment-input.tsx):
// - guests: sidebar-subcard row "Log in to join the conversation" with a
//   btn-3d-gray "Log in" pill
// - signed in: 40px avatar, optional "Replying to @u · Cancel" line, then a
//   premium-input rounded-2xl box holding the text field (Enter sends) and
//   the button row: counter near the limit, pill "Image" and "GIFs" (purple
//   3D while the picker is open), orange "Send" + arrow; with an attachment
//   the tile sits in the box and Send drops below it
// - the inline GIF picker (apple-panel) under the box
import { useRouter } from "expo-router";
import { Clapperboard, ImagePlus, SendHorizonal } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  UserAvatar,
  useViewerAvatarUrl,
} from "@/components/avatar/user-avatar";
import { GifPicker } from "@/components/media/gif-picker";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  APPLE_PANEL_TOKENS,
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
  premiumInput,
  pressedPill,
  PURPLE_GRADIENT,
  themeText,
} from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import type { FeedComment } from "@/features/feed/lib/feed-api";
import { useAppTheme } from "@/theme";

import { EddieAttachmentTile } from "./eddie-attachment-tile";
import {
  MAX_EDDIE_CHARS,
  MAX_EDDIE_WORDS,
  useEddieSender,
} from "./use-eddie-sender";

const PURPLE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";
const GRAY_BUTTON_DARK = {
  gradient: ["#4a4a4a", "#333333"] as const,
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 1.5px 2px rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.7), 0 1px 1px rgba(255, 255, 255, 0.35), 0 3px 5px rgba(0, 0, 0, 0.12)",
  text: "#ffffff",
};
const GRAY_BUTTON_LIGHT = {
  gradient: ["#ffffff", "#e9ebef"] as const,
  shadows:
    "inset 0 0 0 1px rgba(255, 255, 255, 0.8), inset 0 1.5px 2px rgba(255, 255, 255, 0.9), 0 0 0 1px rgba(0, 0, 0, 0.14), 0 1px 2px rgba(0, 0, 0, 0.08)",
  text: "#1f2430",
};

export function PillIconButton({
  active,
  disabled,
  icon: Icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: typeof ImagePlus;
  label: string;
  onPress: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const pressedTone = pressedPill(isDark);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={disabled && styles.dimmed}
    >
      {({ pressed }) => {
        if (active) {
          return (
            <Gradient3D
              colors={PURPLE_GRADIENT}
              shadows={PURPLE_SHADOWS}
              style={[styles.pill, pressed && styles.pressed]}
            >
              <Icon color="#ffffff" size={16} />
            </Gradient3D>
          );
        }
        return (
          <View style={[styles.pill, pressed && styles.pressed]}>
            {pressed ? (
              <Gradient3D
                colors={pressedTone.gradient}
                shadows={pressedTone.shadows}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Icon color={pressed ? pressedTone.color : text.muted} size={16} />
          </View>
        );
      }}
    </Pressable>
  );
}

export function SendButton({
  disabled,
  label,
  onPress,
  sending,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  sending: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: sending, disabled }}
      disabled={disabled || sending}
      onPress={onPress}
      style={(disabled || sending) && styles.dimmed}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={ORANGE_GRADIENT}
          radius={12}
          shadows={ORANGE_BUTTON_SHADOWS}
          style={[styles.send, pressed && styles.pressed]}
        >
          {sending ? (
            <ActivityIndicator color="#ffffff" size={16} />
          ) : (
            <>
              <Text style={styles.sendText}>Send</Text>
              <SendHorizonal color="#ffffff" size={16} />
            </>
          )}
        </Gradient3D>
      )}
    </Pressable>
  );
}

export function EddieComposer({
  autoFocus,
  onCancel,
  onPosted,
  parentId,
  placeholder = "Add your Eddie to the flow...",
  postId,
  replyingTo,
}: {
  autoFocus?: boolean;
  onCancel?: () => void;
  onPosted?: (comment: FeedComment) => void;
  parentId?: string;
  placeholder?: string;
  postId: string;
  replyingTo?: { username: string } | null;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const router = useRouter();
  const { user } = useSessionContext();
  const viewerAvatar = useViewerAvatarUrl();
  const sender = useEddieSender(postId, parentId);
  const [focused, setFocused] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const input = premiumInput(isDark, focused);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;

  if (!user) {
    const gray = isDark ? GRAY_BUTTON_DARK : GRAY_BUTTON_LIGHT;
    return (
      <View
        style={[
          styles.guest,
          {
            backgroundColor: isDark ? "#1f1f1f" : "#f9f9f9",
            borderColor: isDark
              ? "rgba(255, 255, 255, 0.08)"
              : "rgba(0, 0, 0, 0.08)",
          },
        ]}
      >
        <Text style={[styles.guestText, { color: text.muted }]}>
          Log in to join the conversation
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/login")}
        >
          <Gradient3D
            colors={gray.gradient}
            shadows={gray.shadows}
            style={styles.guestButton}
          >
            <Text style={[styles.guestButtonText, { color: gray.text }]}>
              Log in
            </Text>
          </Gradient3D>
        </Pressable>
      </View>
    );
  }

  const submit = async () => {
    const created = await sender.send();
    if (created) {
      setGifOpen(false);
      onPosted?.(created);
    }
  };

  const busy = sender.isBusy || sender.sending;
  const counter = sender.nearLimit ? (
    <Text
      style={[
        styles.counter,
        { color: sender.exceeded ? text.destructive : text.muted },
      ]}
    >
      {sender.words}/{MAX_EDDIE_WORDS}w · {sender.text.length}/{MAX_EDDIE_CHARS}
      c
    </Text>
  ) : null;
  const sendButton = (
    <SendButton
      disabled={!sender.canSubmit}
      label={parentId ? "Send reply" : "Send eddie"}
      onPress={() => {
        void submit();
      }}
      sending={sender.sending}
    />
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <UserAvatar size={40} url={viewerAvatar} />
        <View style={styles.column}>
          {replyingTo ? (
            <View style={styles.replyLine}>
              <Text style={[styles.replyText, { color: text.muted }]}>
                Replying to{" "}
                <Text style={styles.replyHandle}>@{replyingTo.username}</Text>
              </Text>
              {onCancel ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={onCancel}
                >
                  <Text style={[styles.replyText, { color: text.muted }]}>
                    Cancel
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View
            style={[
              styles.box,
              { backgroundColor: input.background, boxShadow: input.shadows },
              sender.attachments.length > 0 && styles.boxWithAttachment,
            ]}
          >
            <TextInput
              accessibilityLabel={placeholder}
              autoFocus={autoFocus}
              editable={!sender.sending}
              multiline
              onBlur={() => setFocused(false)}
              onChangeText={(value) => sender.setText(value)}
              onFocus={() => setFocused(true)}
              onSubmitEditing={() => {
                void submit();
              }}
              placeholder={placeholder}
              placeholderTextColor={input.placeholder}
              returnKeyType="send"
              style={[styles.field, { color: input.text }]}
              submitBehavior="submit"
              value={sender.text}
            />
            {sender.attachments.length === 0 ? (
              <View style={styles.buttonRow}>
                {counter}
                <View style={styles.buttonCluster}>
                  <PillIconButton
                    disabled={busy}
                    icon={ImagePlus}
                    label="Add image or GIF"
                    onPress={() => {
                      void sender.pickImage();
                    }}
                  />
                  <PillIconButton
                    active={gifOpen}
                    disabled={busy}
                    icon={Clapperboard}
                    label="Search and add a GIF"
                    onPress={() => setGifOpen((open) => !open)}
                  />
                  {sendButton}
                </View>
              </View>
            ) : (
              <>
                {sender.attachments.map((attachment) => (
                  <EddieAttachmentTile
                    attachment={attachment}
                    key={attachment.localId}
                    onRemove={() => sender.removeAttachment(attachment.localId)}
                    onRetry={() => sender.retryAttachment(attachment.localId)}
                  />
                ))}
                <View style={styles.attachmentFooter}>
                  <View>{counter}</View>
                  {sendButton}
                </View>
              </>
            )}
          </View>
          {gifOpen ? (
            <View
              style={[
                styles.gifPanel,
                {
                  backgroundColor: panel.background,
                  borderColor: panel.border,
                  boxShadow: panel.shadows,
                },
              ]}
            >
              <GifPicker
                disabled={busy}
                onSelect={(gif) => {
                  setGifOpen(false);
                  void sender.pickGif(gif);
                }}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  attachmentFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
  },
  box: {
    borderRadius: 16,
    paddingBottom: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingTop: 6,
  },
  boxWithAttachment: {
    gap: 8,
  },
  buttonCluster: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginLeft: "auto",
  },
  buttonRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  counter: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  dimmed: {
    opacity: 0.5,
  },
  field: {
    fontFamily: "SofiaProReg",
    fontSize: 14,
    lineHeight: 22,
    maxHeight: 160,
    minHeight: 24,
    paddingVertical: 8,
  },
  gifPanel: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
    padding: 8,
  },
  guest: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginVertical: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guestButton: {
    height: 32,
    paddingHorizontal: 16,
  },
  guestButtonText: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
    letterSpacing: -0.3,
  },
  guestText: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
  },
  pill: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  replyHandle: {
    color: "#f66b15",
    fontFamily: "SofiaProMed",
  },
  replyLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 4,
  },
  replyText: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  send: {
    flexDirection: "row",
    gap: 6,
    height: 32,
    paddingHorizontal: 16,
  },
  sendText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
  },
  wrap: {
    marginVertical: 12,
    width: "100%",
  },
});
