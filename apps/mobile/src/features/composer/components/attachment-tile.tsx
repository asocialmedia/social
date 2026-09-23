import { useEvent } from "expo";
// Composer attachment tile, 1:1 port of web's attachment-preview.tsx:
// - image: natural aspect on an apple-panel frame (portrait 320 tall, GIFs
//   contained at 280, landscapes full width, all capped at 380)
// - video: muted looping local preview with rail-3d chips (file name top-
//   left, mute bottom-left, play/pause + m:ss clock bottom-right)
// - audio: orange play button, file name + clock, progress-colored bars
// Under the media, the action bar follows the upload: orange progress bar
// with "N% · Stage…" + danger cancel while uploading; an apple-panel error
// row (dark retry badge, title, "Failed at … · will resume where it left
// off", orange Retry, remove) on failure; "Processing in background · you
// can publish now" while the server finishes; a floating remove button
// once settled. The ALT chip (rail-3d) opens the alt editor, like tapping
// the tile body.
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  Film,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

import noMediaImage from "@/assets/images/nomedia.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { IconButton3D } from "@/components/surface/icon-button-3d";
import {
  APPLE_PANEL_TOKENS,
  DARK_CHIP_GRADIENT,
  DARK_CHIP_SHADOWS,
  ORANGE_BUTTON_SHADOWS,
  ORANGE_GRADIENT,
  RAIL_BUTTON,
  themeText,
} from "@/components/surface/recipes";
import { formatFileName } from "@/features/feed/lib/media-url";
import { EQ_FALLBACK_HEIGHTS } from "@/features/feed/lib/waveform";
import { uploadProgressInfo } from "@/features/media-upload/lib/upload-status";
import type { UploadStage } from "@/features/media-upload/lib/upload-status";
import type { DraftAttachment } from "@/features/media-upload/state/attachment-store";
import { useAppTheme } from "@/theme";

const PROGRESS_TRACK_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.25)";

function stageText(stage: UploadStage | null): string {
  switch (stage) {
    case "queued": {
      return "Queued…";
    }
    case "scanning": {
      return "Scanning…";
    }
    case "processing": {
      return "Processing…";
    }
    default: {
      return "Uploading…";
    }
  }
}

function clock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function RailChip({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.rail,
        {
          backgroundColor: RAIL_BUTTON.background,
          boxShadow: RAIL_BUTTON.shadows,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function VideoPreview({ attachment }: { attachment: DraftAttachment }) {
  const [muted, setMuted] = useState(true);
  const [firstFrame, setFirstFrame] = useState(false);
  const player = useVideoPlayer(attachment.uri, (created) => {
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.loop = true;
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.muted = true;
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.timeUpdateEventInterval = 0.5;
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const time = useEvent(player, "timeUpdate", {
    bufferedPosition: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    currentTime: 0,
  });
  const ratio =
    attachment.width && attachment.height
      ? attachment.width / attachment.height
      : 16 / 9;
  const portrait = ratio <= 1;
  const frame: ViewStyle = portrait
    ? {
        alignSelf: "flex-start",
        aspectRatio: ratio,
        height: 380,
        maxWidth: "100%",
      }
    : { aspectRatio: ratio, maxHeight: 380, width: "100%" };
  return (
    <View style={[styles.mediaFrame, frame]}>
      {firstFrame ? null : (
        <View style={styles.center}>
          <Film color="rgba(128, 128, 128, 0.4)" size={48} />
        </View>
      )}
      <VideoView
        contentFit="cover"
        nativeControls={false}
        onFirstFrameRender={() => setFirstFrame(true)}
        player={player}
        style={StyleSheet.absoluteFill}
        surfaceType="textureView"
      />
      <RailChip style={styles.nameChip}>
        <Text numberOfLines={1} style={styles.railText}>
          {formatFileName(attachment.name)}
        </Text>
      </RailChip>
      <Pressable
        accessibilityLabel={muted ? "Unmute video" : "Mute video"}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => {
          const next = !muted;
          // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
          player.muted = next;
          setMuted(next);
        }}
        style={styles.muteChipWrap}
      >
        <RailChip style={styles.roundRail}>
          {muted ? (
            <VolumeX color="#ffffff" size={14} />
          ) : (
            <Volume2 color="#ffffff" size={14} />
          )}
        </RailChip>
      </Pressable>
      <View style={styles.playChipWrap}>
        <RailChip style={styles.playRail}>
          <Pressable
            accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => (isPlaying ? player.pause() : player.play())}
          >
            {isPlaying ? (
              <Pause color="#ffffff" size={14} />
            ) : (
              <Play color="#ffffff" size={14} />
            )}
          </Pressable>
          <Text style={styles.railText}>
            {clock(time.currentTime)} / {clock(player.duration)}
          </Text>
        </RailChip>
      </View>
    </View>
  );
}

function AudioPreview({ attachment }: { attachment: DraftAttachment }) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  const player = useAudioPlayer(attachment.uri, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const fraction =
    status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const played = fraction * EQ_FALLBACK_HEIGHTS.length;
  return (
    <View
      style={[
        styles.audioPanel,
        {
          backgroundColor: panel.background,
          borderColor: panel.border,
          boxShadow: panel.shadows,
        },
      ]}
    >
      <Pressable
        accessibilityLabel={status.playing ? "Pause audio" : "Play audio"}
        accessibilityRole="button"
        onPress={() => (status.playing ? player.pause() : player.play())}
      >
        <Gradient3D
          colors={ORANGE_GRADIENT}
          shadows={ORANGE_BUTTON_SHADOWS}
          style={styles.audioPlay}
        >
          {status.playing ? (
            <Pause color="#ffffff" fill="#ffffff" size={20} />
          ) : (
            <Play color="#ffffff" fill="#ffffff" size={20} />
          )}
        </Gradient3D>
      </Pressable>
      <View style={styles.audioMeta}>
        <View style={styles.audioHead}>
          <Text
            numberOfLines={1}
            style={[styles.audioName, { color: text.foreground }]}
          >
            {formatFileName(attachment.name)}
          </Text>
          <Text style={[styles.audioTime, { color: text.muted }]}>
            {clock(status.currentTime)} / {clock(status.duration)}
          </Text>
        </View>
        <View style={styles.bars}>
          {EQ_FALLBACK_HEIGHTS.map((height, index) => (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  backgroundColor:
                    index < played ? "#ff9500" : "rgba(113, 113, 122, 0.3)",
                  height: `${Math.max(12, height * 100)}%`,
                },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function ImagePreview({
  attachment,
  onError,
}: {
  attachment: DraftAttachment;
  onError: () => void;
}) {
  const { isDark } = useAppTheme();
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  const ratio =
    attachment.width && attachment.height
      ? attachment.width / attachment.height
      : null;
  let frame: ViewStyle;
  if (attachment.isGif) {
    frame = { aspectRatio: ratio ?? 1, maxHeight: 280, maxWidth: "100%" };
  } else if (ratio !== null && ratio <= 1) {
    frame = { aspectRatio: ratio, height: 320, maxWidth: "100%" };
  } else if (ratio === null) {
    frame = { aspectRatio: 1, height: 176, maxWidth: "100%" };
  } else {
    frame = { aspectRatio: ratio, maxHeight: 380, width: "100%" };
  }
  return (
    <View
      style={[
        styles.mediaFrame,
        {
          backgroundColor: panel.background,
          borderColor: panel.border,
          borderWidth: 1,
          boxShadow: panel.shadows,
        },
        frame,
      ]}
    >
      <Image
        accessibilityLabel={attachment.altText || attachment.name}
        contentFit={attachment.isGif ? "contain" : "cover"}
        onError={onError}
        source={{ uri: attachment.uri }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function AttachmentTile({
  attachment,
  onEditAlt,
  onRemove,
  onRetry,
}: {
  attachment: DraftAttachment;
  onEditAlt?: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  const [previewFailed, setPreviewFailed] = useState(false);
  const hasError = attachment.stage === "error";
  const isUploading =
    !hasError && !attachment.isProcessing && attachment.stage !== "ready";

  let preview: React.ReactNode;
  if (previewFailed) {
    preview = (
      <View style={[styles.mediaFrame, { aspectRatio: 16 / 9, width: "100%" }]}>
        <Image
          accessibilityLabel={attachment.name}
          contentFit="cover"
          source={noMediaImage}
          style={[StyleSheet.absoluteFill, { opacity: 0.5 }]}
        />
      </View>
    );
  } else if (attachment.family === "VIDEO") {
    preview = <VideoPreview attachment={attachment} />;
  } else if (attachment.family === "AUDIO") {
    preview = <AudioPreview attachment={attachment} />;
  } else {
    preview = (
      <ImagePreview
        attachment={attachment}
        onError={() => setPreviewFailed(true)}
      />
    );
  }

  let actionBar: React.ReactNode;
  if (isUploading) {
    const { label, percent } = uploadProgressInfo(
      attachment.stage,
      attachment.bytesPercent
    );
    actionBar = (
      <View style={styles.progressRow}>
        <View
          style={[
            styles.progressTrack,
            {
              backgroundColor: isDark
                ? "rgba(255, 255, 255, 0.1)"
                : "rgba(0, 0, 0, 0.1)",
              boxShadow: PROGRESS_TRACK_SHADOWS,
            },
          ]}
        >
          <Gradient3D
            colors={ORANGE_GRADIENT}
            shadows=""
            style={[styles.progressFill, { width: `${percent}%` }]}
          />
        </View>
        <Text style={[styles.progressLabel, { color: text.muted }]}>
          {label}
        </Text>
        <IconButton3D
          accessibilityLabel="Cancel upload"
          danger
          icon={X}
          onPress={onRemove}
          size={28}
        />
      </View>
    );
  } else if (hasError) {
    actionBar = (
      <View
        style={[
          styles.errorRow,
          {
            backgroundColor: panel.background,
            borderColor: panel.border,
            boxShadow: panel.shadows,
          },
        ]}
      >
        <Gradient3D
          colors={DARK_CHIP_GRADIENT}
          shadows={DARK_CHIP_SHADOWS}
          style={styles.errorBadge}
        >
          <RefreshCw color="#ffffff" size={16} />
        </Gradient3D>
        <View style={styles.errorCopy}>
          <Text
            numberOfLines={1}
            style={[styles.errorTitle, { color: text.foreground }]}
          >
            {attachment.error ?? "Upload failed"}
          </Text>
          {attachment.failedStage ? (
            <Text
              numberOfLines={1}
              style={[styles.errorSub, { color: text.muted }]}
            >
              Failed at {stageText(attachment.failedStage).toLowerCase()} · will
              resume where it left off
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Retry upload"
          accessibilityRole="button"
          onPress={onRetry}
        >
          {({ pressed }) => (
            <Gradient3D
              colors={ORANGE_GRADIENT}
              shadows={ORANGE_BUTTON_SHADOWS}
              style={[styles.retryButton, pressed && styles.pressed]}
            >
              <RefreshCw color="#ffffff" size={14} />
              <Text style={styles.retryText}>Retry</Text>
            </Gradient3D>
          )}
        </Pressable>
        <IconButton3D
          accessibilityLabel="Remove attachment"
          icon={X}
          onPress={onRemove}
        />
      </View>
    );
  } else if (attachment.isProcessing) {
    actionBar = (
      <View
        style={[
          styles.processingRow,
          {
            backgroundColor: isDark
              ? "rgba(48, 48, 48, 0.7)"
              : "rgba(232, 232, 232, 0.7)",
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.processingText, { color: text.muted }]}
        >
          Processing in background · you can publish now
        </Text>
        <IconButton3D
          accessibilityLabel="Remove attachment"
          icon={X}
          iconSize={14}
          onPress={onRemove}
          size={28}
        />
      </View>
    );
  } else {
    actionBar = (
      <View style={styles.settledRemove}>
        <IconButton3D
          accessibilityLabel="Remove attachment"
          icon={X}
          onPress={onRemove}
        />
      </View>
    );
  }

  // The ALT chip clears the media controls: video's mute toggle, audio's
  // play button, or the tile edge.
  let altLeft = 8;
  if (attachment.family === "VIDEO") {
    altLeft = 40;
  } else if (attachment.family === "AUDIO") {
    altLeft = 64;
  }

  return (
    <View style={styles.tile}>
      <Pressable
        accessibilityHint="Opens the alt text editor"
        accessibilityLabel={formatFileName(attachment.name)}
        disabled={hasError || !onEditAlt || attachment.family === "VIDEO"}
        onPress={onEditAlt}
        style={(isUploading || hasError) && styles.dimmed}
      >
        {preview}
      </Pressable>
      {onEditAlt && !isUploading && !hasError ? (
        <Pressable
          accessibilityLabel={
            attachment.altText ? "Edit alt text" : "Add alt text to this media"
          }
          accessibilityRole="button"
          hitSlop={4}
          onPress={onEditAlt}
          style={[styles.altChipWrap, { left: altLeft }]}
        >
          <RailChip style={styles.altChip}>
            <Text numberOfLines={1} style={styles.railText}>
              {attachment.altText ? "ALT" : "Add alt text"}
            </Text>
          </RailChip>
        </Pressable>
      ) : null}
      {actionBar}
    </View>
  );
}

const styles = StyleSheet.create({
  altChip: {
    height: 28,
    paddingHorizontal: 10,
  },
  altChipWrap: {
    bottom: 8,
    maxWidth: "70%",
    position: "absolute",
  },
  audioHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  audioMeta: {
    flex: 1,
    minWidth: 0,
  },
  audioName: {
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  audioPanel: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
    width: "100%",
  },
  audioPlay: {
    height: 48,
    width: 48,
  },
  audioTime: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  bar: {
    borderRadius: 9999,
    flex: 1,
  },
  bars: {
    alignItems: "center",
    flexDirection: "row",
    gap: 1,
    height: 40,
    marginTop: 8,
  },
  center: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  dimmed: {
    opacity: 0.6,
  },
  errorBadge: {
    height: 32,
    width: 32,
  },
  errorCopy: {
    flex: 1,
    minWidth: 0,
  },
  errorRow: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
    padding: 10,
  },
  errorSub: {
    fontFamily: "SofiaProReg",
    fontSize: 11,
  },
  errorTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  mediaFrame: {
    borderRadius: 16,
    overflow: "hidden",
  },
  muteChipWrap: {
    bottom: 8,
    left: 8,
    position: "absolute",
  },
  nameChip: {
    left: 8,
    maxWidth: "70%",
    paddingHorizontal: 10,
    position: "absolute",
    top: 8,
  },
  playChipWrap: {
    bottom: 8,
    position: "absolute",
    right: 8,
  },
  playRail: {
    gap: 6,
    paddingHorizontal: 6,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  processingRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  processingText: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 12,
  },
  progressFill: {
    height: "100%",
  },
  progressLabel: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
  },
  progressRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  progressTrack: {
    borderRadius: 9999,
    flex: 1,
    height: 8,
    overflow: "hidden",
  },
  rail: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    height: 28,
  },
  railText: {
    color: "rgba(255, 255, 255, 0.95)",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  retryButton: {
    flexDirection: "row",
    gap: 6,
    height: 32,
    paddingHorizontal: 14,
  },
  retryText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  roundRail: {
    justifyContent: "center",
    width: 28,
  },
  settledRemove: {
    position: "absolute",
    right: 12,
    top: 12,
  },
  tile: {
    position: "relative",
    width: "100%",
  },
});
