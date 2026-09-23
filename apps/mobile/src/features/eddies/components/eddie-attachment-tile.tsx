// Eddie composer attachment, port of web's comment-input attachment tile:
// a 96px square (GIFs 144px tall, contained) with the hairline + inner lip,
// a black/50 spinner veil while uploading, a black round remove button once
// settled, and (native addition, same copy as the post tiles) a retry veil
// when the upload failed.
import { Image } from "expo-image";
import { RefreshCw, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { DraftAttachment } from "@/features/media-upload/state/attachment-store";
import { useAppTheme } from "@/theme";

export function EddieAttachmentTile({
  attachment,
  onRemove,
  onRetry,
}: {
  attachment: DraftAttachment;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { isDark } = useAppTheme();
  const failed = attachment.stage === "error";
  const uploading = !failed && attachment.stage !== "ready";
  const ratio =
    attachment.width && attachment.height
      ? attachment.width / attachment.height
      : 1;
  return (
    <View
      style={[
        styles.tile,
        attachment.isGif
          ? { aspectRatio: ratio, height: 144, maxWidth: 320 }
          : styles.square,
        {
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.15)"
            : "rgba(0, 0, 0, 0.1)",
          boxShadow: isDark
            ? "inset 0 0 0 1px rgba(255, 255, 255, 0.1), 0 2px 6px rgba(0, 0, 0, 0.3)"
            : "inset 0 0 0 1px rgba(255, 255, 255, 0.3), 0 1px 3px rgba(0, 0, 0, 0.1)",
        },
      ]}
    >
      <Image
        accessibilityLabel="Attachment preview"
        contentFit={attachment.isGif ? "contain" : "cover"}
        source={{ uri: attachment.uri }}
        style={StyleSheet.absoluteFill}
      />
      {uploading ? (
        <View style={styles.veil}>
          <ActivityIndicator color="#ffffff" size={20} />
        </View>
      ) : null}
      {failed ? (
        <Pressable
          accessibilityLabel="Retry upload"
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.veil}
        >
          <RefreshCw color="#ffffff" size={18} />
          <Text numberOfLines={2} style={styles.failText}>
            {attachment.error ?? "Upload failed"}
          </Text>
        </Pressable>
      ) : null}
      {uploading ? null : (
        <Pressable
          accessibilityLabel="Remove attachment"
          accessibilityRole="button"
          hitSlop={6}
          onPress={onRemove}
          style={styles.remove}
        >
          <X color="#ffffff" size={14} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  failText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 10,
    paddingHorizontal: 6,
    textAlign: "center",
  },
  remove: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    borderRadius: 9999,
    boxShadow:
      "0 1px 3px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.25)",
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 6,
    top: 6,
    width: 24,
    zIndex: 10,
  },
  square: {
    height: 96,
    width: 96,
  },
  tile: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  veil: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    bottom: 0,
    gap: 4,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
