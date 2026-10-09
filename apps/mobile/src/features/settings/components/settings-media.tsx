// Native port of web's `components/profile/profile-media-inputs.tsx`
// (BannerInput / AvatarInput), for the settings profile tab.
//
// Web holds a cropped blob locally and uploads it on the form's Save; native
// has no browser crop step (the platform image editor does the framing), so the
// pick and the upload are one action here - the same pipeline the profile edit
// modal already uses. The parent receives the new URL and keeps it in state, so
// the hero reflects a successful upload immediately.
import { Image } from "expo-image";
import { ImagePlus, Pencil, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Spinner3D } from "@/components/feedback/spinner-3d";
import { toast } from "@/components/feedback/toast";
import { useInstall } from "@/features/auth/state/install";
import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import type { ProfileImageKind } from "@/features/profile/lib/profile-media";
import {
  deleteProfileMedia,
  updateProfileMedia,
} from "@/features/profile/lib/profile-media-mutations";
import { getApiBaseUrl } from "@/lib/api-env";
import { useAppTheme } from "@/theme";

// Web's `pipelineStageLabel`: the byte-transfer percentage while uploading,
// then the pipeline stage name once the server owns the job.
function pipelineStageLabel(
  stage: string | null,
  progress: number,
  kind: ProfileImageKind
): string {
  if (!stage) {
    return "Processing…";
  }
  switch (stage) {
    case "uploading": {
      return `Uploading ${progress}%`;
    }
    case "queued": {
      return "Queued for processing";
    }
    case "scanning": {
      return "Scanning for threats…";
    }
    case "processing": {
      return kind === "banner" ? "Processing header…" : "Processing avatar…";
    }
    default: {
      return "Processing…";
    }
  }
}

function useMediaUpload(
  kind: ProfileImageKind,
  onUploaded: (url: string | null) => void
) {
  const { runWithInstallToken } = useInstall();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string | null>(null);

  const upload = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setProgress(0);
    setStage("uploading");
    const result = await updateProfileMedia(
      kind,
      {
        onBytes: setProgress,
        onStage: (next) => {
          setStage(next);
          if (next === "processing") {
            setProgress(100);
          }
        },
      },
      runWithInstallToken
    );
    setBusy(false);
    setProgress(0);
    setStage(null);
    if (result.kind === "cancelled") {
      return;
    }
    if (result.kind === "error") {
      toast({
        description: result.message,
        title: "That didn't work",
        variant: "destructive",
      });
      return;
    }
    if (result.kind !== "success") {
      return;
    }
    onUploaded(result.url);
    toast({
      description: `Your ${kind} has been updated.`,
      title: "Updated",
    });
  };

  const remove = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    const result = await deleteProfileMedia(kind, runWithInstallToken);
    setBusy(false);
    if (result.kind === "cancelled") {
      return;
    }
    if (result.kind === "error") {
      toast({
        description: result.message,
        title: "That didn't work",
        variant: "destructive",
      });
      return;
    }
    if (result.kind !== "success") {
      return;
    }
    onUploaded(null);
    toast({
      description: `Your ${kind} has been removed.`,
      title: "Removed",
    });
  };

  return { busy, progress, remove, stage, upload };
}

// Web's `BannerInput` in its settings-hero form: flush-top, tall, no radius.
export function SettingsBannerInput({
  canRemove,
  height = 144,
  onChanged,
  src,
}: {
  canRemove: boolean;
  height?: number;
  onChanged: (url: string | null) => void;
  src: string | null;
}) {
  const { isDark, theme } = useAppTheme();
  const { busy, progress, remove, stage, upload } = useMediaUpload(
    "banner",
    onChanged
  );
  const resolved = resolveProfileImageUrl(src, getApiBaseUrl());

  return (
    <View style={{ height }}>
      <Pressable
        accessibilityLabel="Change profile header"
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          void upload();
        }}
        style={StyleSheet.absoluteFill}
      >
        {resolved ? (
          <Image
            contentFit="cover"
            source={{ uri: resolved }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.bannerPlaceholder,
              { backgroundColor: theme.cardBg },
            ]}
          >
            <ImagePlus color={theme.dividerText} size={16} />
            <Text
              style={[
                styles.bannerPlaceholderText,
                { color: theme.dividerText },
              ]}
            >
              Add a header image
            </Text>
          </View>
        )}
        {busy ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.overlay,
              { backgroundColor: "rgba(0,0,0,0.55)" },
            ]}
          >
            <Spinner3D size={40} />
            <Text numberOfLines={1} style={styles.overlayText}>
              {pipelineStageLabel(stage, progress, "banner")}
            </Text>
          </View>
        ) : (
          <View
            style={[
              StyleSheet.absoluteFill,
              styles.overlay,
              { backgroundColor: "rgba(0,0,0,0.4)" },
            ]}
          >
            <Pencil color="#ffffff" fill="#ffffff" size={24} />
          </View>
        )}
      </Pressable>
      {canRemove ? (
        <Pressable
          accessibilityLabel="Remove header image"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void remove();
          }}
          style={[
            styles.trashOverlay,
            { backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.5)" },
          ]}
        >
          <Trash2 color="#ffffff" size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

// Web's `AvatarInput` in its bare, squircle settings-hero form.
export function SettingsAvatarInput({
  canDelete,
  onChanged,
  size = 112,
  src,
}: {
  canDelete: boolean;
  onChanged: (url: string | null) => void;
  size?: number;
  src: string | null;
}) {
  const { theme } = useAppTheme();
  const { busy, progress, remove, stage, upload } = useMediaUpload(
    "avatar",
    onChanged
  );
  const resolved = resolveProfileImageUrl(src, getApiBaseUrl());
  const radius = Math.round(size * 0.3);

  return (
    <View style={{ height: size, width: size }}>
      <Pressable
        accessibilityLabel="Change profile avatar"
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          void upload();
        }}
      >
        <View
          style={{
            backgroundColor: theme.cardBg,
            borderRadius: radius,
            height: size,
            overflow: "hidden",
            width: size,
          }}
        >
          {resolved ? (
            <Image
              contentFit="cover"
              source={{ uri: resolved }}
              style={{ borderRadius: radius, height: size, width: size }}
            />
          ) : (
            <View
              style={[
                styles.avatarPlaceholder,
                { backgroundColor: theme.cardBg, borderRadius: radius },
              ]}
            >
              <ImagePlus color={theme.dividerText} size={20} />
            </View>
          )}
          {busy ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.overlay,
                { backgroundColor: "rgba(0,0,0,0.55)", borderRadius: radius },
              ]}
            >
              <Spinner3D size={32} />
              <Text numberOfLines={1} style={styles.overlayTextSmall}>
                {pipelineStageLabel(stage, progress, "avatar")}
              </Text>
            </View>
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                styles.overlay,
                { backgroundColor: "rgba(0,0,0,0.4)", borderRadius: radius },
              ]}
            >
              <Pencil color="#ffffff" fill="#ffffff" size={20} />
            </View>
          )}
        </View>
      </Pressable>
      {/* Web's `ring-4 ring-[hsl(var(--background))]`: the avatar sits on the
          banner with a page-colored ring separating the two. */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderColor: theme.containerBg,
            borderRadius: radius,
            borderWidth: 4,
          },
        ]}
      />
      {canDelete ? (
        <Pressable
          accessibilityLabel="Remove avatar"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            void remove();
          }}
          style={styles.avatarTrash}
        >
          <Trash2 color="#ffffff" size={12} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarPlaceholder: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  avatarTrash: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 9999,
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    top: 4,
    width: 24,
  },
  bannerPlaceholder: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  bannerPlaceholderText: { fontFamily: "SofiaProReg", fontSize: 14 },
  overlay: {
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  overlayText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  overlayTextSmall: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 10,
  },
  trashOverlay: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 28,
  },
});
