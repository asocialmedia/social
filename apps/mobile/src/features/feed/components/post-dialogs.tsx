// The three post overflow dialogs: delete, moderation and edit tags.
//
// Web drives these through its own dialog components; the native port keeps
// the same confirm-then-act shape on the shared modal recipe, so a destructive
// tap always costs a second deliberate press. Every submit runs through
// runWithInstallToken, because a first-write from a fresh install is exactly
// the shape the server's bot gate challenges.
import { ShieldCheck, Trash2 } from "lucide-react-native";
import type * as React from "react";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { toast } from "@/components/feedback/toast";
import { ZephLoader } from "@/components/feedback/zeph-loader";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { APPLE_PANEL_TOKENS, themeText } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { SettingsSwitch } from "@/features/settings/components/settings-ui";
import { logInfo, logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { useAppTheme } from "@/theme";

import type { ApiCallOptions } from "../lib/feed-api";
import { deletePost, updatePostModeration } from "../lib/post-mutations";

async function options(): Promise<ApiCallOptions> {
  return { apiBase: getApiBaseUrl(), cookie: await authClient.getCookie() };
}

const log = {
  info: (
    message: string,
    attributes?: Record<string, boolean | number | string>
  ) => logInfo(message, attributes),
  warn: (
    message: string,
    attributes?: Record<string, boolean | number | string>
  ) => logWarn(message, attributes),
};

function shell(isDark: boolean) {
  const text = themeText(isDark);
  return {
    panel: isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light,
    text,
  };
}

// Web's red and amber title tiles and their pill buttons, gradient plus the
// same inset lip and dark ring.
const DELETE_GRADIENT = ["#f87171", "#dc2626"] as const;
const DELETE_SHADOWS =
  "inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 1.5px 2px rgba(255,255,255,0.5), 0 0 0 1px rgba(150,30,30,0.95), 0 1px 1px rgba(255,255,255,0.4), 0 3px 5px rgba(0,0,0,0.12)";
const TILE_GRADIENT = ["#fbbf24", "#f97316"] as const;
const TILE_SHADOWS =
  "inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 1.5px 2px rgba(255,255,255,0.5), 0 0 0 1px rgba(146,64,14,0.95), 0 1px 1px rgba(255,255,255,0.4), 0 3px 5px rgba(0,0,0,0.12)";
const APPLY_GRADIENT = ["#ff9500", "#e65500"] as const;
const APPLY_SHADOWS =
  "inset 0 0 0 1px rgba(255,255,255,0.25), inset 0 1.5px 2px rgba(255,255,255,0.5), 0 0 0 1px rgba(170,60,0,0.95), 0 1px 1px rgba(255,255,255,0.4), 0 3px 5px rgba(0,0,0,0.12)";
// The moderation dialog's raised subcard.
const SUBCARD_SHADOWS =
  "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 2px rgba(255,255,255,0.06), inset 0 -2px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)";

// The shared shell of web's two post dialogs: a hairline-bottomed header
// with a tinted icon tile, title and caption, then the body.
function PostDialogShell({
  busy,
  children,
  description,
  icon,
  onClose,
  tile,
  title,
}: {
  busy: boolean;
  children: React.ReactNode;
  description: string;
  icon: React.ReactNode;
  onClose: () => void;
  tile: { colors: readonly [string, string]; shadows: string };
  title: string;
}) {
  const { isDark } = useAppTheme();
  const { panel, text } = shell(isDark);
  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      statusBarTranslucent
      transparent
      visible
    >
      <View style={styles.center}>
        <Pressable
          accessibilityLabel="Close"
          disabled={busy}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.overlay]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: panel.border }]}>
            <View style={styles.titleRow}>
              <Gradient3D
                colors={tile.colors}
                radius={8}
                shadows={tile.shadows}
                style={styles.tile}
              >
                {icon}
              </Gradient3D>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: text.foreground }]}
              >
                {title}
              </Text>
            </View>
            <Text style={[styles.description, { color: text.muted }]}>
              {description}
            </Text>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function GhostButton({
  disabled,
  label,
  onPress,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const { isDark } = useAppTheme();
  const { text } = shell(isDark);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghost,
        pressed && {
          backgroundColor: isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(0,0,0,0.05)",
        },
      ]}
    >
      <Text style={[styles.ghostText, { color: text.muted }]}>{label}</Text>
    </Pressable>
  );
}

function GradientButton({
  busy,
  colors,
  disabled,
  label,
  onPress,
  shadows,
}: {
  busy: boolean;
  colors: readonly [string, string];
  disabled: boolean;
  label: string;
  onPress: () => void;
  shadows: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Gradient3D colors={colors} shadows={shadows} style={styles.pill}>
        {busy ? (
          <ZephLoader variant="general" color="#ffffff" size={14} />
        ) : null}
        <Text style={styles.buttonText}>{label}</Text>
      </Gradient3D>
    </Pressable>
  );
}

export function DeletePostDialog({
  onClose,
  onDeleted,
  open,
  postId,
}: {
  onClose: () => void;
  onDeleted: (postId: string) => void;
  open: boolean;
  postId: string;
}) {
  const { isDark } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [busy, setBusy] = useState(false);
  if (!open) {
    return null;
  }
  const { text } = shell(isDark);

  const confirm = async () => {
    setBusy(true);
    const result = await runWithInstallToken(
      async () => {
        try {
          await deletePost(postId, await options(), log);
          return "done" as const;
        } catch (error) {
          return error instanceof Error ? error.message : "unknown";
        }
      },
      (value) => value === "done"
    );
    setBusy(false);
    if (result === null) {
      return;
    }
    if (result === "done") {
      onDeleted(postId);
      onClose();
      // Web's useDeletePostMutation success toast.
      toast({ description: "Post deleted" });
      return;
    }
    toast({
      description:
        result === "unknown" ? "Couldn't delete that post, try again?" : result,
      variant: "destructive",
    });
  };

  return (
    <PostDialogShell
      busy={busy}
      description="This action cannot be undone."
      icon={<Trash2 color="#ffffff" size={14} />}
      onClose={onClose}
      tile={{ colors: DELETE_GRADIENT, shadows: DELETE_SHADOWS }}
      title="Delete Post"
    >
      <View style={styles.body}>
        <Text style={[styles.bodyText, { color: text.foreground }]}>
          Are you sure you want to delete this post? Once deleted, it's gone
          forever.
        </Text>
        <View style={[styles.footer, styles.footerSpaced]}>
          <GhostButton disabled={busy} label="Cancel" onPress={onClose} />
          <GradientButton
            busy={busy}
            colors={DELETE_GRADIENT}
            disabled={false}
            label="Delete"
            onPress={() => {
              void confirm();
            }}
            shadows={DELETE_SHADOWS}
          />
        </View>
      </View>
    </PostDialogShell>
  );
}

function ModerationRow({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  const { isDark, theme } = useAppTheme();
  const { text } = shell(isDark);
  return (
    <View
      style={[
        styles.subcard,
        {
          backgroundColor: theme.containerBg,
          borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
          boxShadow: SUBCARD_SHADOWS,
        },
      ]}
    >
      <View style={styles.subcardCopy}>
        <Text style={[styles.rowLabel, { color: text.foreground }]}>
          {label}
        </Text>
        <Text style={[styles.rowHint, { color: text.muted }]}>
          {description}
        </Text>
      </View>
      <SettingsSwitch
        accessibilityLabel={label}
        disabled={disabled}
        onValueChange={onChange}
        value={checked}
      />
    </View>
  );
}

export function PostModerationDialog({
  explicitContent,
  moderated,
  onClose,
  onUpdated,
  open,
  postId,
}: {
  explicitContent: boolean;
  moderated: boolean;
  onClose: () => void;
  onUpdated: (
    postId: string,
    next: { explicitContent: boolean; moderated: boolean }
  ) => void;
  open: boolean;
  postId: string;
}) {
  const { runWithInstallToken } = useInstall();
  const [busy, setBusy] = useState(false);
  const [mature, setMature] = useState(explicitContent);
  const [hidden, setHidden] = useState(moderated);
  // Web resets the switches to the post's stored flags every time the dialog
  // opens, so a reopen never shows the toggles from a previous visit.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMature(explicitContent);
      setHidden(moderated);
    }
  }
  if (!open) {
    return null;
  }
  const isDirty = mature !== explicitContent || hidden !== moderated;

  const apply = async (next: {
    explicitContent: boolean;
    moderated: boolean;
  }) => {
    setBusy(true);
    const result = await runWithInstallToken(
      async () => {
        try {
          await updatePostModeration(postId, next, await options(), log);
          return "done" as const;
        } catch (error) {
          return error instanceof Error ? error.message : "unknown";
        }
      },
      (value) => value === "done"
    );
    setBusy(false);
    if (result === null) {
      return;
    }
    if (result === "done") {
      onUpdated(postId, next);
      onClose();
      toast({ description: "Post updated" });
      return;
    }
    toast({
      description:
        result === "unknown"
          ? "Couldn't update moderation, try again?"
          : result,
      variant: "destructive",
    });
  };

  return (
    <PostDialogShell
      busy={busy}
      description="These flags are reversible. Nothing is ever deleted from the database."
      icon={<ShieldCheck color="#ffffff" size={14} />}
      onClose={onClose}
      tile={{ colors: TILE_GRADIENT, shadows: TILE_SHADOWS }}
      title="Moderation"
    >
      <View style={[styles.body, styles.rows]}>
        <ModerationRow
          checked={hidden}
          description='Hides the content behind a "This post has been moderated" notice.'
          disabled={busy}
          label="Mark as moderated"
          onChange={setHidden}
        />
        <ModerationRow
          checked={mature}
          description="Blurs the media until a viewer taps Continue."
          disabled={busy}
          label="Flag explicit content"
          onChange={setMature}
        />
        <View style={[styles.footer, styles.footerSpacedSmall]}>
          <GhostButton disabled={busy} label="Cancel" onPress={onClose} />
          <GradientButton
            busy={busy}
            colors={APPLY_GRADIENT}
            disabled={!isDirty}
            label="Apply"
            onPress={() => {
              void apply({ explicitContent: mature, moderated: hidden });
            }}
            shadows={APPLY_SHADOWS}
          />
        </View>
      </View>
    </PostDialogShell>
  );
}
export { EditPostTagsDialog } from "./post-meta-editor-dialog";

const styles = StyleSheet.create({
  body: { paddingBottom: 16, paddingHorizontal: 16 },
  bodyText: { fontFamily: "SofiaProReg", fontSize: 14, lineHeight: 20 },
  buttonText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 16,
    maxWidth: 420,
    overflow: "hidden",
    width: "92%",
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  description: { fontFamily: "SofiaProReg", fontSize: 12, marginTop: 4 },
  disabled: { opacity: 0.5 },
  footer: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  footerSpaced: { marginTop: 20 },
  footerSpacedSmall: { marginTop: 8 },
  ghost: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  ghostText: { fontFamily: "SofiaProMed", fontSize: 14 },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  overlay: { backgroundColor: "rgba(0,0,0,0.45)" },
  pill: {
    flexDirection: "row",
    gap: 6,
    height: 36,
    paddingHorizontal: 16,
  },
  pressed: { transform: [{ translateY: 1 }] },
  rowHint: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  rowLabel: { fontFamily: "SofiaProBold", fontSize: 14 },
  rows: { gap: 10 },
  subcard: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  subcardCopy: { flex: 1, minWidth: 0 },
  tile: { height: 28, width: 28 },
  title: { fontFamily: "SofiaProBold", fontSize: 16 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
});
