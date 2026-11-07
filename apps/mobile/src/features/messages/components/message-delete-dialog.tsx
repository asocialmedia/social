// Confirm for "delete for me" / "delete for everyone", ported from
// apps/web/src/components/messages/message-delete-dialog.tsx. Web renders an
// AlertDialog with Cancel + a destructive confirm; here the shell is
// DialogPanel (the native Dialog counterpart) and the footer keeps the same
// copy, ordering and busy gating: Cancel, then the destructive confirm which
// reads "Deleting…" while the request is in flight and ignores presses.
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DialogPanel } from "@/components/surface/dialog-panel";

import type { MessageDeleteCopy } from "../lib/message-delete";
import { MessagesGrayButton } from "./messages-gray-button";

export function MessageDeleteDialog({
  busy,
  copy,
  onConfirm,
  onOpenChange,
  open,
}: {
  busy: boolean;
  copy: MessageDeleteCopy;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  if (!open) {
    return null;
  }
  return (
    <DialogPanel
      busy={busy}
      description={copy.description}
      onClose={() => onOpenChange(false)}
      title={copy.title}
    >
      <View style={styles.footer}>
        <MessagesGrayButton
          accessibilityLabel="Cancel delete"
          disabled={busy}
          label="Cancel"
          onPress={() => onOpenChange(false)}
        />
        <Pressable
          accessibilityLabel={busy ? "Deleting message" : copy.confirmLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onConfirm}
          style={[styles.confirm, busy && styles.confirmBusy]}
        >
          <Text style={styles.confirmLabel}>
            {busy ? "Deleting…" : copy.confirmLabel}
          </Text>
        </Pressable>
      </View>
    </DialogPanel>
  );
}

const styles = StyleSheet.create({
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
  confirmLabel: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
});
