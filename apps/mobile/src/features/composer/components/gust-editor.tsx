import { Image } from "expo-image";
import { Hash, ImageIcon, Music, Plus, Search, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import zephImage from "@/assets/images/zeph.png";
import { UserAvatar } from "@/components/avatar/user-avatar";
import { toast } from "@/components/feedback/toast";
import { useSkeletonPulse } from "@/components/feedback/use-skeleton-pulse";
import {
  RAIL_BUTTON,
  premiumInput,
  themeText,
} from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import { mediaPosterUrl } from "@/features/feed/lib/media-url";
import { suggestAltText } from "@/features/media-upload/lib/upload-api";
import {
  attachmentActions,
  getScopeAttachments,
} from "@/features/media-upload/state/attachment-store";
import type { DraftAttachment } from "@/features/media-upload/state/attachment-store";
import { getApiBaseUrl } from "@/lib/api-env";
import { withAuthHeaders } from "@/lib/auth-headers";
import { haptic } from "@/lib/haptics";
import { useAppTheme } from "@/theme";

import type { MentionPick } from "../lib/inline-relations";
import { pickAudioFile, pickPhotosAndVideos } from "../lib/pick-media";
import { useComposerStore } from "../state/composer-store";
import {
  carryGustSound,
  clearGustOptions,
  removeGustAsset,
  setGustAlt,
  setGustAsset,
  useGustOptions,
} from "../state/gust-options-store";
import type { GustAssetDraft } from "../state/gust-options-store";
import { AttachmentTile } from "./attachment-tile";
import { InlineSuggestions } from "./inline-suggestions";

function Heading({ title, hint }: { title: string; hint: string }) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  return (
    <View style={styles.heading}>
      <Text style={[styles.title, { color: text.foreground }]}>{title}</Text>
      <Text style={[styles.hint, { color: text.muted }]}>{hint}</Text>
    </View>
  );
}

function GustMetaPickers() {
  const { isDark } = useAppTheme();
  const input = premiumInput(isDark, false);
  const text = themeText(isDark);
  const { user } = useSessionContext();
  const draft = useComposerStore((state) => state.draft);
  const setDraft = useComposerStore((state) => state.setDraft);
  const [tagQuery, setTagQuery] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const tags = draft.gustTags ?? [];
  const mentions = draft.gustMentions ?? [];
  const addTag = (value: string) => {
    const tag = value.trim().replace(/^#/, "").toLowerCase();
    if (!tag || tags.includes(tag)) {
      return;
    }
    if (tags.length >= 5) {
      toast({
        description: "You can add up to 5 tags per gust",
        title: "Up to 5 Tags",
      });
      return;
    }
    setDraft({ gustTags: [...tags, tag] });
    setTagQuery("");
    haptic("selection");
  };
  const addMention = (person: MentionPick) => {
    if (mentions.some((item) => item.id === person.id)) {
      return;
    }
    if (mentions.length >= 5) {
      toast({
        description: "You can tag up to 5 people per gust",
        title: "Up to 5 People",
      });
      return;
    }
    setDraft({ gustMentions: [...mentions, person] });
    setPersonQuery("");
    haptic("selection");
  };
  return (
    <View style={styles.options}>
      <Heading title="Tags" hint="Up to 5 - help people find your gust." />
      {tags.length ? (
        <View style={styles.chips}>
          {tags.map((tag) => (
            <View
              key={tag}
              style={[
                styles.chip,
                {
                  backgroundColor: input.background,
                  boxShadow: RAIL_BUTTON.shadows,
                },
              ]}
            >
              <Hash size={14} color="#ff9500" />
              <Text style={[styles.chipText, { color: text.foreground }]}>
                {tag}
              </Text>
              <Pressable
                accessibilityLabel={`Remove tag ${tag}`}
                hitSlop={8}
                onPress={() =>
                  setDraft({ gustTags: tags.filter((value) => value !== tag) })
                }
              >
                <X size={13} color={text.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View
        style={[
          styles.search,
          { backgroundColor: input.background, boxShadow: input.shadows },
        ]}
      >
        <Search size={16} color={text.muted} />
        <TextInput
          accessibilityLabel="Search or create a tag"
          placeholder="Search or create a tag…"
          placeholderTextColor={input.placeholder}
          value={tagQuery}
          onChangeText={setTagQuery}
          onSubmitEditing={() => addTag(tagQuery)}
          style={[styles.searchInput, { color: input.text }]}
        />
      </View>
      {tagQuery.trim() ? (
        <View>
          <Pressable
            accessibilityLabel={`Create tag ${tagQuery.trim()}`}
            onPress={() => addTag(tagQuery)}
            style={styles.createTag}
          >
            <Plus size={16} color="#ff9500" />
            <Text style={[styles.chipText, { color: text.foreground }]}>
              Create tag “{tagQuery.trim()}”
            </Text>
          </Pressable>
          <InlineSuggestions
            active={{ query: tagQuery.trim(), start: 0, trigger: "#" }}
            excludedTags={tags}
            excludedUserIds={[]}
            onPickTag={addTag}
            onPickUser={addMention}
          />
        </View>
      ) : null}
      <Heading title="Mentions" hint="Credit up to 5 people in your gust." />
      {mentions.length ? (
        <View style={styles.chips}>
          {mentions.map((person) => (
            <View
              key={person.id}
              style={[
                styles.chip,
                {
                  backgroundColor: input.background,
                  boxShadow: RAIL_BUTTON.shadows,
                },
              ]}
            >
              <UserAvatar
                size={20}
                radius={6}
                seed={person.id}
                url={person.avatarUrl}
              />
              <Text style={[styles.chipText, { color: text.foreground }]}>
                @{person.username}
              </Text>
              <Pressable
                accessibilityLabel={`Remove mention ${person.username}`}
                hitSlop={8}
                onPress={() =>
                  setDraft({
                    gustMentions: mentions.filter(
                      (value) => value.id !== person.id
                    ),
                  })
                }
              >
                <X size={13} color={text.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View
        style={[
          styles.search,
          { backgroundColor: input.background, boxShadow: input.shadows },
        ]}
      >
        <Search size={16} color={text.muted} />
        <TextInput
          accessibilityLabel="Search people to tag"
          placeholder="Search people to mention…"
          placeholderTextColor={input.placeholder}
          value={personQuery}
          onChangeText={setPersonQuery}
          style={[styles.searchInput, { color: input.text }]}
        />
      </View>
      {personQuery.trim() ? (
        <InlineSuggestions
          active={{ query: personQuery.trim(), start: 0, trigger: "@" }}
          excludedTags={[]}
          excludedUserIds={[
            ...mentions.map((person) => person.id),
            ...(user ? [user.id] : []),
          ]}
          onPickTag={addTag}
          onPickUser={addMention}
        />
      ) : null}
    </View>
  );
}

function AssetChip({
  asset,
  label,
  disabled,
  onRetry,
  onRemove,
}: {
  asset: GustAssetDraft;
  label: string;
  disabled: boolean;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const Icon = label === "sound track" ? Music : ImageIcon;
  return (
    <View
      style={[
        styles.assetChip,
        {
          backgroundColor: RAIL_BUTTON.background,
          boxShadow: RAIL_BUTTON.shadows,
        },
      ]}
    >
      <Icon color="#9c85ff" size={14} />
      <Text
        numberOfLines={1}
        style={[styles.assetName, { color: text.foreground }]}
      >
        {asset.file.name}
      </Text>
      {asset.status === "uploading" ? (
        <Text style={[styles.hint, { color: text.muted }]}>
          {Math.round(asset.percent)}%
        </Text>
      ) : null}
      {asset.status === "error" ? (
        <Pressable
          accessibilityLabel={`Retry ${label}`}
          disabled={disabled}
          onPress={onRetry}
        >
          <Text style={[styles.chipText, { color: text.destructive }]}>
            Retry
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={`Remove ${label === "sound track" ? "sound track" : "custom thumbnail"}`}
        disabled={disabled}
        hitSlop={8}
        onPress={onRemove}
      >
        <X size={14} color={text.muted} />
      </Pressable>
    </View>
  );
}

export function GustEditor({
  attachment,
  caption,
  counter,
  footer,
  viewerAvatar,
}: {
  attachment: DraftAttachment;
  caption: ReactNode;
  counter: ReactNode;
  footer: ReactNode;
  viewerAvatar: string | null;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const input = premiumInput(isDark, false);
  const options = useGustOptions(attachment.localId);
  const pulse = useSkeletonPulse();
  const skeleton = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const cookie = await authClient.getCookie();
      if (active) {
        setHeaders(withAuthHeaders({}, cookie));
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  const processing = attachment.stage !== "ready" || attachment.isProcessing;
  const disabled = options.busy || !attachment.mediaId || processing;
  const poster = attachment.mediaId
    ? `${mediaPosterUrl(getApiBaseUrl(), attachment.mediaId)}&t=${options.thumbRevision}`
    : null;
  const sourceKey = `${poster}:${options.thumbnail?.file.uri ?? ""}:${headers ? "ready" : "waiting"}`;
  const [previousSource, setPreviousSource] = useState(sourceKey);
  if (previousSource !== sourceKey) {
    setPreviousSource(sourceKey);
    setThumbnailFailed(false);
    setThumbnailLoaded(false);
  }

  const chooseAsset = async (kind: "sound" | "thumbnail") => {
    if (disabled || !attachment.mediaId) {
      return;
    }
    haptic("selection");
    try {
      const [file] =
        kind === "sound"
          ? await pickAudioFile()
          : await pickPhotosAndVideos({ imagesOnly: true, remaining: 1 });
      if (file) {
        await setGustAsset(attachment.localId, attachment.mediaId, kind, file);
      }
    } catch (error) {
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't open your files. Try again.",
        title: kind === "sound" ? "Sound unavailable" : "Thumbnail unavailable",
      });
    }
  };
  const replaceVideo = async () => {
    if (
      options.busy ||
      (attachment.stage !== "ready" && !attachment.isProcessing)
    ) {
      return;
    }
    try {
      const files = await pickPhotosAndVideos({
        remaining: 1,
        videoOnly: true,
      });
      if (!files.length) {
        return;
      }
      const sound =
        options.sound?.status === "ready" ? options.sound : undefined;
      attachmentActions.remove(attachment.localId);
      clearGustOptions(attachment.localId);
      attachmentActions.add("post", files, {
        audioOverlayId: sound?.readyMediaId,
        gust: true,
        max: 1,
        purpose: "post",
        waitForProcessing: false,
      });
      const [next] = getScopeAttachments("post");
      if (next && sound) {
        carryGustSound(next.localId, sound);
      }
    } catch {
      toast({
        description: "Couldn't open your videos. Try again.",
        title: "Video unavailable",
      });
    }
  };
  const autoAlt = async () => {
    if (!attachment.mediaId || analyzing) {
      return;
    }
    setAnalyzing(true);
    try {
      const result = await suggestAltText(attachment.mediaId);
      if (result.suggestedAlt) {
        setGustAlt(attachment.localId, result.suggestedAlt.slice(0, 1000));
      } else {
        toast({
          description: result.isProcessing
            ? "The video is still processing. Try again shortly."
            : "Add a description of your video below.",
          title: "No description yet",
        });
      }
    } catch {
      toast({
        description: "Try again or write a description below.",
        title: "Couldn't generate alt text",
      });
    }
    setAnalyzing(false);
  };
  return (
    <View style={styles.root}>
      <View style={styles.mediaRow}>
        <View style={styles.mediaColumn}>
          <UserAvatar radius={16} size={48} url={viewerAvatar} />
          <View style={styles.video}>
            <AttachmentTile
              attachment={attachment}
              gust
              onChangeVideo={() => {
                void replaceVideo();
              }}
              onRemove={() => {
                attachmentActions.remove(attachment.localId);
                clearGustOptions(attachment.localId);
              }}
              onRetry={() => attachmentActions.retry(attachment.localId)}
            />
          </View>
          <Text style={[styles.hint, { color: text.muted }]}>
            Tap the preview to change your gust{" "}
            <Text style={styles.ratio}>9:16</Text>
          </Text>
          {counter}
        </View>
        <View style={styles.mediaColumn}>
          <Heading
            title="Thumbnail"
            hint="Optional - pick a cover frame; one is chosen from the video otherwise."
          />
          <Pressable
            accessibilityLabel="Change thumbnail"
            disabled={disabled}
            onPress={() => {
              void chooseAsset("thumbnail");
            }}
            style={[
              styles.cover,
              { backgroundColor: input.background, boxShadow: input.shadows },
            ]}
          >
            {processing || !thumbnailLoaded ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  skeleton,
                  { backgroundColor: isDark ? "#343434" : "#e4e4e4" },
                ]}
              />
            ) : null}
            {poster && headers && !processing && !thumbnailFailed ? (
              <Image
                cachePolicy="memory-disk"
                contentFit="cover"
                source={{ headers, uri: poster }}
                onLoad={() => setThumbnailLoaded(true)}
                onError={() => setThumbnailFailed(true)}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            {thumbnailFailed ? (
              <View style={styles.coverFallback}>
                <ImageIcon color={text.muted} size={24} />
                <Text style={[styles.hint, { color: text.muted }]}>
                  Choose a cover
                </Text>
              </View>
            ) : null}
            {disabled ? null : (
              <View style={styles.coverAction}>
                <ImageIcon color="#ffffff" size={16} />
              </View>
            )}
          </Pressable>
          {options.thumbnail ? (
            <AssetChip
              asset={options.thumbnail}
              label="thumbnail"
              disabled={options.busy}
              onRetry={() => {
                if (attachment.mediaId && options.thumbnail) {
                  void setGustAsset(
                    attachment.localId,
                    attachment.mediaId,
                    "thumbnail",
                    options.thumbnail.file
                  );
                }
              }}
              onRemove={() => {
                if (attachment.mediaId) {
                  void removeGustAsset(
                    attachment.localId,
                    attachment.mediaId,
                    "thumbnail"
                  );
                }
              }}
            />
          ) : null}
        </View>
      </View>
      <Heading title="Caption" hint="Tell viewers what your gust is about." />
      {caption}
      <Heading title="Alt text" hint="For viewers who can't see it." />
      <View
        style={[
          styles.altBar,
          { backgroundColor: input.background, boxShadow: input.shadows },
        ]}
      >
        <TextInput
          accessibilityLabel="Gust alt text"
          maxLength={1000}
          multiline
          scrollEnabled
          placeholder="Write a description so everyone can follow along…"
          placeholderTextColor={input.placeholder}
          value={options.altText ?? attachment.altText}
          onChangeText={(value) => setGustAlt(attachment.localId, value)}
          style={[styles.altInput, { color: input.text }]}
        />
        <Pressable
          accessibilityLabel="Auto-generate Gust alt text"
          disabled={disabled || analyzing}
          onPress={() => {
            void autoAlt();
          }}
          style={styles.auto}
        >
          <Image contentFit="contain" source={zephImage} style={styles.zeph} />
          <Text style={styles.autoText}>
            {analyzing ? "Analyzing…" : "Auto"}
          </Text>
        </Pressable>
      </View>
      <Heading title="Sound" hint="Optional - replace the clip's audio." />
      {options.sound ? (
        <AssetChip
          asset={options.sound}
          label="sound track"
          disabled={options.busy}
          onRetry={() => {
            if (attachment.mediaId && options.sound) {
              void setGustAsset(
                attachment.localId,
                attachment.mediaId,
                "sound",
                options.sound.file
              );
            }
          }}
          onRemove={() => {
            if (attachment.mediaId) {
              void removeGustAsset(
                attachment.localId,
                attachment.mediaId,
                "sound"
              );
            }
          }}
        />
      ) : (
        <Pressable
          accessibilityLabel="Add sound"
          disabled={disabled}
          onPress={() => {
            void chooseAsset("sound");
          }}
          style={[styles.addSound, disabled && styles.disabled]}
        >
          <Music size={14} color={text.muted} />
          <Text style={[styles.chipText, { color: text.muted }]}>
            Add sound
          </Text>
        </Pressable>
      )}
      {options.error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.hint, { color: text.destructive }]}
        >
          {options.error}
        </Text>
      ) : null}
      <GustMetaPickers />
      <View style={styles.footer}>{footer}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  addSound: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
    padding: 8,
  },
  altBar: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  altInput: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 14,
    height: 36,
    lineHeight: 18,
    padding: 0,
    textAlignVertical: "top",
  },
  assetChip: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 20,
    flexDirection: "row",
    gap: 7,
    maxWidth: "100%",
    padding: 8,
  },
  assetName: { flexShrink: 1, fontFamily: "SofiaProMed", fontSize: 12 },
  auto: { alignItems: "center", flexDirection: "row", gap: 4, padding: 4 },
  autoText: { color: "#fb923c", fontFamily: "SofiaProMed", fontSize: 12 },
  chip: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 6,
    padding: 7,
  },
  chipText: { fontFamily: "SofiaProMed", fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cover: {
    aspectRatio: 9 / 16,
    borderRadius: 16,
    overflow: "hidden",
    width: "100%",
  },
  coverAction: {
    alignItems: "center",
    backgroundColor: RAIL_BUTTON.background,
    borderRadius: 16,
    bottom: 8,
    boxShadow: RAIL_BUTTON.shadows,
    height: 32,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    width: 32,
  },
  coverFallback: {
    alignItems: "center",
    flex: 1,
    gap: 8,
    justifyContent: "center",
  },
  createTag: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  disabled: { opacity: 0.45 },
  footer: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 2,
  },
  heading: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  hint: {
    flexShrink: 1,
    fontFamily: "SofiaProReg",
    fontSize: 11,
    lineHeight: 15,
  },
  mediaColumn: { flex: 1, gap: 8, minWidth: 0 },
  mediaRow: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  options: { gap: 8 },
  ratio: { color: "#ff9500", fontFamily: "SofiaProBold", fontSize: 10 },
  root: { gap: 10, padding: 16 },
  search: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontFamily: "SofiaProReg", fontSize: 14, height: 40 },
  title: { fontFamily: "SofiaProBold", fontSize: 12 },
  video: { marginTop: 4 },
  zeph: { height: 22, width: 22 },
});
