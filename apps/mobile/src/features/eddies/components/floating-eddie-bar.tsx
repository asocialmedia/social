// Floating eddie bar for the post screen, port of web's mobile
// FloatingPostEditor (components/layouts/navigation/mobile/
// floating-post-editor.tsx): a bottom bar (background/95, hairline top
// border, soft upward shadow) holding
// - the reply chip "Replying to @user" + one-line preview + X, when a row's
//   Reply targeted an eddie
// - a 36px avatar, the premium-input field ("Reply to @u..." / "Add your
//   Eddie to the flow...") and, collapsed, the round orange "Send" pill
// - expanded while focused: the attachment tile, round Image / GIF buttons
//   (purple while the picker is open), the length counter, "Send", the GIF
//   picker
// It sits above the floating nav dock and rises above the keyboard.
import { Clapperboard, ImageIcon, SendHorizonal, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
  PURPLE_GRADIENT,
  themeText,
} from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { useAppTheme } from "@/theme";

import { useEddieComposerStore } from "../state/eddie-composer-store";
import { EddieAttachmentTile } from "./eddie-attachment-tile";
import {
  MAX_EDDIE_CHARS,
  MAX_EDDIE_WORDS,
  useEddieSender,
} from "./use-eddie-sender";

const PURPLE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

// Height of the floating nav dock plus its gap, so the bar clears it.
export const FLOATING_DOCK_CLEARANCE = 76;

function RoundIconButton({
  active,
  disabled,
  icon: Icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: typeof ImageIcon;
  label: string;
  onPress: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={disabled && styles.dimmed}
    >
      {({ pressed }) =>
        active ? (
          <Gradient3D
            colors={PURPLE_GRADIENT}
            shadows={PURPLE_SHADOWS}
            style={styles.round}
          >
            <Icon color="#ffffff" size={16} />
          </Gradient3D>
        ) : (
          <View
            style={[
              styles.round,
              pressed && { backgroundColor: "rgba(246, 107, 21, 0.1)" },
            ]}
          >
            <Icon color={pressed ? "#f66b15" : text.muted} size={16} />
          </View>
        )
      }
    </Pressable>
  );
}

function SendPill({
  disabled,
  height,
  onPress,
  sending,
}: {
  disabled: boolean;
  height: number;
  onPress: () => void;
  sending: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel="Send eddie"
      accessibilityRole="button"
      disabled={disabled || sending}
      onPress={onPress}
      style={(disabled || sending) && styles.dimmed}
    >
      {({ pressed }) => (
        <Gradient3D
          colors={ORANGE_GRADIENT}
          shadows={ORANGE_BUTTON_SHADOWS}
          style={[styles.sendPill, { height }, pressed && styles.pressed]}
        >
          {sending ? (
            <ActivityIndicator color="#ffffff" size={16} />
          ) : (
            <SendHorizonal color="#ffffff" size={16} />
          )}
          <Text style={styles.sendText}>Send</Text>
        </Gradient3D>
      )}
    </Pressable>
  );
}

export function FloatingEddieBar({ postId }: { postId: string }) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const insets = useSafeAreaInsets();
  const { user } = useSessionContext();
  const viewerAvatar = useViewerAvatarUrl();
  const replyingTo = useEddieComposerStore((state) =>
    state.replyingTo?.postId === postId ? state.replyingTo : null
  );
  const setReplyingTo = useEddieComposerStore((state) => state.setReplyingTo);
  const sender = useEddieSender(postId, replyingTo?.commentId ?? null);
  const [focused, setFocused] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const input = premiumInput(isDark, focused);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (!user) {
    return null;
  }

  const expanded = focused || gifOpen || sender.attachments.length > 0;
  const busy = sender.isBusy || sender.sending;
  const submit = async () => {
    const created = await sender.send();
    if (created) {
      setGifOpen(false);
      setReplyingTo(null);
      Keyboard.dismiss();
    }
  };
  const bottom =
    keyboardHeight > 0
      ? keyboardHeight
      : insets.bottom + FLOATING_DOCK_CLEARANCE;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: isDark
            ? "rgba(31, 31, 31, 0.95)"
            : "rgba(249, 249, 249, 0.95)",
          borderTopColor: isDark
            ? "rgba(255, 255, 255, 0.1)"
            : "rgba(0, 0, 0, 0.08)",
          bottom,
        },
      ]}
    >
      <View style={styles.inner}>
        {replyingTo ? (
          <View
            style={[
              styles.replyChip,
              {
                backgroundColor: isDark
                  ? "rgba(255, 255, 255, 0.05)"
                  : "rgba(0, 0, 0, 0.05)",
              },
            ]}
          >
            <View style={styles.replyCopy}>
              <Text style={[styles.replyLabel, { color: text.muted }]}>
                Replying to{" "}
                <Text style={styles.replyHandle}>@{replyingTo.username}</Text>
              </Text>
              {replyingTo.preview ? (
                <Text
                  numberOfLines={1}
                  style={[styles.replyPreview, { color: text.muted }]}
                >
                  {replyingTo.preview}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel="Cancel reply"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setReplyingTo(null)}
              style={styles.replyClose}
            >
              <X color={text.muted} size={14} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.row}>
          <UserAvatar radius={10} size={36} url={viewerAvatar} />
          <TextInput
            accessibilityLabel="Eddie"
            editable={!sender.sending}
            multiline
            onBlur={() => setFocused(false)}
            onChangeText={(value) => sender.setText(value)}
            onFocus={() => setFocused(true)}
            onSubmitEditing={() => {
              void submit();
            }}
            placeholder={
              replyingTo
                ? `Reply to @${replyingTo.username}...`
                : "Add your Eddie to the flow..."
            }
            placeholderTextColor={input.placeholder}
            returnKeyType="send"
            style={[
              styles.field,
              {
                backgroundColor: input.background,
                boxShadow: input.shadows,
                color: input.text,
              },
            ]}
            submitBehavior="submit"
            value={sender.text}
          />
          {expanded ? null : (
            <SendPill
              disabled={!sender.canSubmit}
              height={36}
              onPress={() => {
                void submit();
              }}
              sending={sender.sending}
            />
          )}
        </View>
        {expanded ? (
          <View>
            {sender.attachments.length > 0 ? (
              <View style={styles.attachments}>
                {sender.attachments.map((attachment) => (
                  <EddieAttachmentTile
                    attachment={attachment}
                    key={attachment.localId}
                    onRemove={() => sender.removeAttachment(attachment.localId)}
                    onRetry={() => sender.retryAttachment(attachment.localId)}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.expandedRow}>
              <View style={styles.expandedLeft}>
                {sender.attachments.length === 0 ? (
                  <View style={styles.iconCluster}>
                    <RoundIconButton
                      disabled={busy}
                      icon={ImageIcon}
                      label="Add image or GIF"
                      onPress={() => {
                        void sender.pickImage();
                      }}
                    />
                    <RoundIconButton
                      active={gifOpen}
                      disabled={busy}
                      icon={Clapperboard}
                      label="Search and add a GIF"
                      onPress={() => setGifOpen((open) => !open)}
                    />
                  </View>
                ) : null}
                {sender.nearLimit ? (
                  <Text
                    style={[
                      styles.counter,
                      {
                        color: sender.exceeded ? text.destructive : text.muted,
                      },
                    ]}
                  >
                    {sender.words}/{MAX_EDDIE_WORDS}w · {sender.text.length}/
                    {MAX_EDDIE_CHARS}c
                  </Text>
                ) : null}
              </View>
              <SendPill
                disabled={!sender.canSubmit}
                height={32}
                onPress={() => {
                  void submit();
                }}
                sending={sender.sending}
              />
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
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  bar: {
    borderTopWidth: 1,
    boxShadow: "0 -4px 20px rgba(0, 0, 0, 0.15)",
    left: 0,
    padding: 8,
    position: "absolute",
    right: 0,
    zIndex: 40,
  },
  counter: {
    fontFamily: "SofiaProMed",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  dimmed: {
    opacity: 0.5,
  },
  expandedLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  expandedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 8,
  },
  field: {
    borderRadius: 12,
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    maxHeight: 112,
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  gifPanel: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 8,
    padding: 8,
  },
  iconCluster: {
    flexDirection: "row",
    gap: 4,
  },
  inner: {
    alignSelf: "center",
    maxWidth: 512,
    width: "100%",
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  replyChip: {
    alignItems: "flex-start",
    borderRadius: 8,
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  replyClose: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
    marginTop: 2,
    width: 20,
  },
  replyCopy: {
    flex: 1,
    minWidth: 0,
  },
  replyHandle: {
    color: "#f66b15",
    fontFamily: "SofiaProBold",
  },
  replyLabel: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  replyPreview: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
    opacity: 0.8,
  },
  round: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  sendPill: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 16,
  },
  sendText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
});
