// The three post overflow dialogs: delete, moderation and edit tags.
//
// Web drives these through its own dialog components; the native port keeps
// the same confirm-then-act shape on the shared modal recipe, so a destructive
// tap always costs a second deliberate press. Every submit runs through
// runWithInstallToken, because a first-write from a fresh install is exactly
// the shape the server's bot gate challenges.

import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { toast } from "@/components/feedback/toast";
import { APPLE_PANEL_TOKENS, themeText } from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { getApiBaseUrl } from "@/lib/api-env";
import { logInfo, logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import type { ApiCallOptions } from "../lib/feed-api";
import {
  deletePost,
  updatePostModeration,
  updatePostTags,
} from "../lib/post-mutations";

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
    destructive: isDark ? "#7f1d1d" : "#dc2626",
    panel: isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light,
    text,
  };
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
  const { destructive, panel, text } = shell(isDark);

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
      return;
    }
    toast({
      description:
        result === "unknown" ? "Couldn't delete that post, try again?" : result,
      title: "Delete failed",
      variant: "destructive",
    });
  };

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={onClose}
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
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <Text style={[styles.title, { color: text.foreground }]}>
            Delete post?
          </Text>
          <Text style={[styles.description, { color: text.muted }]}>
            This removes the post, its gust and its eddies. It cannot be undone.
          </Text>
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={confirm}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: destructive },
                pressed && styles.pressed,
              ]}
            >
              {busy ? <ActivityIndicator color="#ffffff" size={14} /> : null}
              <Text style={styles.buttonText}>Delete</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: panel.background,
                  borderColor: panel.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, { color: text.foreground }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
  const { isDark } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [busy, setBusy] = useState(false);
  const [mature, setMature] = useState(explicitContent);
  const [hidden, setHidden] = useState(moderated);
  if (!open) {
    return null;
  }
  const { panel, text } = shell(isDark);

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
      return;
    }
    toast({
      description: result === "unknown" ? "Couldn't update that post" : result,
      title: "Update failed",
      variant: "destructive",
    });
  };

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={onClose}
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
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <Text style={[styles.title, { color: text.foreground }]}>
            Moderate post
          </Text>
          <Text style={[styles.description, { color: text.muted }]}>
            Marking a post mature puts a gate in front of it. Moderating hides
            it from everyone but its author.
          </Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: mature }}
            disabled={busy}
            onPress={() => setMature(!mature)}
            style={[styles.row, { borderColor: panel.border }]}
          >
            <Text style={[styles.rowLabel, { color: text.foreground }]}>
              Mature content
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: hidden }}
            disabled={busy}
            onPress={() => setHidden(!hidden)}
            style={[styles.row, { borderColor: panel.border }]}
          >
            <Text style={[styles.rowLabel, { color: text.foreground }]}>
              Moderated
            </Text>
          </Pressable>
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                apply({ explicitContent: mature, moderated: hidden })
              }
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: "#f97316" },
                pressed && styles.pressed,
              ]}
            >
              {busy ? <ActivityIndicator color="#ffffff" size={14} /> : null}
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: panel.background,
                  borderColor: panel.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, { color: text.foreground }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function EditPostTagsDialog({
  initialTags,
  onClose,
  onSaved,
  open,
  postId,
}: {
  initialTags: readonly string[];
  onClose: () => void;
  onSaved: (postId: string, tags: string[]) => void;
  open: boolean;
  postId: string;
}) {
  const { isDark } = useAppTheme();
  const { runWithInstallToken } = useInstall();
  const [value, setValue] = useState(initialTags.join(", "));
  const [busy, setBusy] = useState(false);
  if (!open) {
    return null;
  }
  const { panel, text } = shell(isDark);

  const parsed = value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  const save = async () => {
    if (parsed.length === 0) {
      toast({
        description: "Add at least one tag",
        title: "No tags",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    const result = await runWithInstallToken(
      async () => {
        try {
          await updatePostTags(postId, parsed, await options(), log);
          return "done" as const;
        } catch (error) {
          return error instanceof Error ? error.message : "unknown";
        }
      },
      (value_) => value_ === "done"
    );
    setBusy(false);
    if (result === null) {
      return;
    }
    if (result === "done") {
      onSaved(postId, parsed);
      onClose();
      return;
    }
    toast({
      description: result === "unknown" ? "Couldn't save those tags" : result,
      title: "Save failed",
      variant: "destructive",
    });
  };

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={onClose}
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
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <Text style={[styles.title, { color: text.foreground }]}>
            Edit tags
          </Text>
          <Text style={[styles.description, { color: text.muted }]}>
            Separate tags with commas. They decide who sees the post.
          </Text>
          <TextInput
            accessibilityLabel="Post tags"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            onChangeText={setValue}
            placeholder="art, music"
            placeholderTextColor={text.muted}
            style={[
              styles.input,
              { borderColor: panel.border, color: text.foreground },
            ]}
            value={value}
          />
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={save}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: "#f97316" },
                pressed && styles.pressed,
              ]}
            >
              {busy ? <ActivityIndicator color="#ffffff" size={14} /> : null}
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: panel.background,
                  borderColor: panel.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonText, { color: text.foreground }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 16,
  },
  buttonText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  card: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    maxWidth: 420,
    padding: 18,
    width: "88%",
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  description: { fontFamily: "SofiaProReg", fontSize: 13 },
  footer: { flexDirection: "row", gap: 8, marginTop: 4 },
  input: {
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: 1,
    fontFamily: "SofiaProReg",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  overlay: { backgroundColor: "rgba(0,0,0,0.45)" },
  pressed: { opacity: 0.85 },
  row: {
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowLabel: { fontFamily: "SofiaProMed", fontSize: 14 },
  title: { fontFamily: "SofiaProBold", fontSize: 17 },
});
