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
import { panel3d } from "@/features/messages/lib/message-recipes";
import { useAppTheme } from "@/theme";

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

  const handleReset = async () => {
    setWorking(true);
    try {
      await onReset();
      toast({ title: "Setting up a new message key" });
    } catch {
      toast({ title: "Couldn't reset", variant: "destructive" });
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
          accessibilityRole="button"
          disabled={working}
          onPress={handleReset}
          style={styles.action}
        >
          <Text style={styles.actionText}>
            {working ? "Starting…" : "Start over"}
          </Text>
        </Pressable>
      </View>
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
