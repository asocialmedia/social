// The "locked" state: the stored identity row exists but nothing on this device can
// read it.
//
// This is invariant 3 in AGENTS.md made visible. A lost key DEGRADES: it costs this
// account the history it encrypted, and the peer's own wraps stay intact so the
// peer keeps everything. The only action offered is a reset, and it is stated
// plainly rather than behind a generic error.
//
// There is deliberately no "enter your backup key" field. The brief that governs
// this feature says a fresh device must always recover from the stored row alone,
// and that abandoned verifier rows must unlock without a user-facing secret. Adding
// a prompt would reintroduce exactly the credential the design removed.

import { ShieldAlert } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { toast } from "@/components/feedback/toast";
import { DialogPanel } from "@/components/surface/dialog-panel";
import { panel3d } from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

import { MessagesGrayButton } from "./messages-gray-button";

export function MessageIdentityLocked({
  message,
  onReset,
}: {
  message: string | null;
  onReset: () => Promise<void>;
}) {
  const { isDark, theme } = useAppTheme();
  const panel = panel3d(isDark);
  const [working, setWorking] = useState(false);
  // Resetting mints a new key and strands everything encrypted under the old
  // one, so it commits only through a confirm dialog with the full loss copy
  // (web's ResetIdentityDialog), never on the first press.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleReset = async () => {
    setWorking(true);
    try {
      await onReset();
      setConfirmOpen(false);
      toast({ title: "Setting up a new message key" });
    } catch {
      toast({ title: "Reset failed", variant: "destructive" });
    }
    setWorking(false);
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.containerBg }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: panel.background,
            borderColor: panel.border,
            boxShadow: panel.shadows,
          },
        ]}
      >
        {/* The bare glyph, no tinted tile: an icon behind a coloured box is a
            component-kit default, and this state has to read as a warning rather
            than as a feature card. */}
        <ShieldAlert color="#ff9500" size={28} />
        <Text style={[styles.title, { color: isDark ? "#eeeeee" : "#202020" }]}>
          Messages locked
        </Text>
        <Text style={[styles.body, { color: theme.dividerText }]}>
          {message ??
            "Your message key can't be read on this device. Start over to create a new one."}
        </Text>
        <Pressable
          accessibilityLabel="Start over with a new messages key"
          accessibilityRole="button"
          disabled={working}
          onPress={() => setConfirmOpen(true)}
          style={styles.action}
        >
          <Text style={styles.actionText}>Start over</Text>
        </Pressable>
      </View>
      {confirmOpen ? (
        <DialogPanel
          busy={working}
          description="You'll get a new messages key. Messages sent or received before this point can no longer be read on your account — they stay on the other person's device and are not deleted. This can't be undone."
          onClose={() => {
            if (!working) {
              setConfirmOpen(false);
            }
          }}
          title="Start messages over?"
        >
          <View style={styles.confirmFooter}>
            <MessagesGrayButton
              accessibilityLabel="Cancel reset"
              disabled={working}
              label="Cancel"
              onPress={() => setConfirmOpen(false)}
            />
            <Pressable
              accessibilityLabel={
                working ? "Resetting messages" : "Reset messages"
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: working }}
              disabled={working}
              onPress={handleReset}
              style={[styles.confirm, working && styles.confirmBusy]}
            >
              <Text style={styles.confirmText}>
                {working ? "Resetting…" : "Reset messages"}
              </Text>
            </Pressable>
          </View>
        </DialogPanel>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 12,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  actionText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  body: {
    fontFamily: "SofiaProReg",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  card: {
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginHorizontal: 28,
    padding: 22,
  },
  confirm: {
    alignItems: "center",
    backgroundColor: "#ff3b30",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  confirmBusy: {
    opacity: 0.6,
  },
  confirmFooter: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
  confirmText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  root: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingVertical: 60,
  },
  title: {
    fontFamily: "SofiaProBold",
    fontSize: 17,
  },
});
