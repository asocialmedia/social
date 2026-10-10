// Native port of web's PostEditor (components/posts/editor/post-editor.tsx),
// modal variant. Top to bottom:
//   Respond banner (when responding) ->
//   [48px squircle avatar | premium-input caption ("What's crack-a-lackin'?"
//   or "Add a caption for your gust..."), @/# suggestions, inline GIF
//   picker, gust caption counter, n/10 capacity chip, attachment tiles, alt
//   editor, toolbar: Photos & Videos + "..." (GIFs, Audio Files) on the left,
//   Fleets/Gust toggle + Fleet/Gust publish on the right]
//
// Media rules come from web's createMediaTypeGate (audio/GIF exclusive,
// images+videos mix, 10 max, gusts take one video) with web's toasts.
// Publishing is gated like web (text or publishable media; nothing
// uploading; nothing errored; gust caption within limits) and posts through
// POST /api/posts with an idempotency key, so a retried publish can never
// double-post.
import { useRouter } from "expo-router";
import {
  Clapperboard,
  FileAudio,
  GripVertical,
  ImageIcon,
  MoreHorizontal,
  Video,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  UserAvatar,
  useViewerAvatarUrl,
} from "@/components/avatar/user-avatar";
import { AnimatedWordCounter } from "@/components/feedback/animated-word-counter";
import { toast } from "@/components/feedback/toast";
import { GifPicker, reelsPanel } from "@/components/media/gif-picker";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { IconButton3D } from "@/components/surface/icon-button-3d";
import {
  APPLE_PANEL_TOKENS,
  ORANGE_GRADIENT,
  ORANGE_PRESSED_GRADIENT,
  orangeSurfaceShadows,
  premiumInput,
  pressedPill,
  themeText,
} from "@/components/surface/recipes";
import { useSessionContext } from "@/features/auth/state/session";
import { revealPublishedPost } from "@/features/feed/state/publish-reveal";
import { MAX_POST_ATTACHMENTS } from "@/features/media-upload/lib/upload-policy";
import {
  attachmentActions,
  scopeReadiness,
  useScopeAttachments,
} from "@/features/media-upload/state/attachment-store";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";
import {
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

import { gustRelations } from "../lib/gust-options";
import {
  activeTrigger,
  applySuggestion,
  collectRelations,
} from "../lib/inline-relations";
import type { ActiveTrigger } from "../lib/inline-relations";
import {
  downloadGif,
  pickAudioFile,
  pickPhotosAndVideos,
} from "../lib/pick-media";
import type { KlipyGif } from "../lib/pick-media";
import { newIdempotencyKey, publishPost } from "../lib/publish-api";
import { useComposerStore } from "../state/composer-store";
import {
  clearGustOptions,
  flushGustAlt,
  useGustOptions,
} from "../state/gust-options-store";
import { AltTextPanel } from "./alt-text-panel";
import { AttachmentTile } from "./attachment-tile";
import { GustEditor } from "./gust-editor";
import { InlineSuggestions } from "./inline-suggestions";
import { ResponsePreview } from "./response-preview";

export const POST_SCOPE = "post";

const GUST_CAPTION_MAX_WORDS = 150;
const GUST_CAPTION_MAX_CHARS = 900;
const MORE_MENU_WIDTH = 176;
const MORE_MENU_HEIGHT = 86;
const MORE_SIDE_OFFSET = 4;
const MORE_EDGE_MARGIN = 8;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Toolbar pill (`pill-3d-hover`): icon-only on phones, like web below md.
function ToolbarButton({
  active = false,
  disabled = false,
  icon: Icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: ComponentType<{ color?: string; size?: number }>;
  label: string;
  onPress: () => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const pressedTone = pressedPill(isDark);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={disabled && styles.disabled}
    >
      {({ pressed }) => {
        let iconColor: string = active ? "#f66b15" : text.muted;
        if (pressed) {
          iconColor = pressedTone.color;
        }
        return (
          <View style={[styles.toolButton, pressed && styles.pressed]}>
            {pressed ? (
              <Gradient3D
                colors={pressedTone.gradient}
                shadows={pressedTone.shadows}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <Icon color={iconColor} size={18} />
          </View>
        );
      }}
    </Pressable>
  );
}

function ModeToggle({
  disabled,
  isGust,
  onChange,
}: {
  disabled: boolean;
  isGust: boolean;
  onChange: (gust: boolean) => void;
}) {
  const { isDark } = useAppTheme();
  const text = themeText(isDark);
  const segment = (gust: boolean, label: string) => {
    const active = gust === isGust;
    const content = (
      <Text
        style={[styles.segmentText, { color: active ? "#ffffff" : text.muted }]}
      >
        {label}
      </Text>
    );
    return (
      <Pressable
        accessibilityLabel={gust ? "Create a gust" : "Create a fleet post"}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected: active }}
        disabled={disabled}
        onPress={() => onChange(gust)}
      >
        {active ? (
          <Gradient3D
            colors={ORANGE_GRADIENT}
            shadows={orangeSurfaceShadows(isDark)}
            style={styles.segment}
          >
            {content}
          </Gradient3D>
        ) : (
          <View style={styles.segment}>{content}</View>
        )}
      </Pressable>
    );
  };
  return (
    <View
      style={[
        styles.toggle,
        {
          backgroundColor: isDark ? "#232323" : "#f9f9f9",
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.1)"
            : "rgba(0, 0, 0, 0.1)",
        },
        disabled && styles.disabled,
      ]}
    >
      {segment(false, "Fleets")}
      {segment(true, "Gust")}
    </View>
  );
}

function PublishButton({
  disabled,
  label,
  loading,
  onPress,
}: {
  disabled: boolean;
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  const { isDark } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled || loading}
      onPress={onPress}
      style={(disabled || loading) && styles.dimmed}
    >
      {({ pressed }) => {
        let shadows = isDark
          ? LOGIN_BUTTON_SHADOWS
          : LOGIN_BUTTON_SHADOWS_LIGHT;
        if (pressed) {
          shadows = isDark
            ? LOGIN_BUTTON_PRESSED_SHADOWS
            : LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT;
        }
        return (
          <Gradient3D
            colors={pressed ? ORANGE_PRESSED_GRADIENT : ORANGE_GRADIENT}
            shadows={shadows}
            style={[styles.publish, pressed && styles.pressed]}
          >
            {loading ? <ActivityIndicator color="#ffffff" size={12} /> : null}
            <Text style={styles.publishText}>{label}</Text>
          </Gradient3D>
        );
      }}
    </Pressable>
  );
}

export function PostEditor({
  onPublished,
  variant = "modal",
}: {
  onPublished?: () => void;
  // "modal" is the floating composer (ComposerModal): transparent, no edge
  // treatment, and the caption field takes focus the moment it opens. "feed"
  // is the inline row that heads the home feed's list, so it carries web's
  // edge-to-edge border/fill and must NOT autofocus - stealing focus there
  // would pop the keyboard over the feed on every visit.
  variant?: "feed" | "modal";
}) {
  const router = useRouter();
  const { isDark, theme } = useAppTheme();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const text = themeText(isDark);
  // Aliased, not `user`: the render helpers below take a `user` of their own.
  const { user: viewer } = useSessionContext();
  // Whose feed the published post lands in: the Latest tab is keyed per viewer,
  // so the optimistic insert has to use the same id the list will read.
  const viewerId = viewer?.id;
  const viewerAvatar = useViewerAvatarUrl();
  const mode = useComposerStore((state) => state.mode);
  const setMode = useComposerStore((state) => state.setMode);
  const replyTo = useComposerStore((state) => state.replyTo);
  const clearReplyTo = useComposerStore((state) => state.clearReplyTo);
  const draft = useComposerStore((state) => state.draft);
  const setDraft = useComposerStore((state) => state.setDraft);
  const clearDraft = useComposerStore((state) => state.clearDraft);
  const attachments = useScopeAttachments(POST_SCOPE);
  const gustVideo = attachments.find((item) => item.family === "VIDEO");
  const gustOptions = useGustOptions(gustVideo?.localId ?? "");

  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState({ end: 0, start: 0 });
  // A controlled selection makes the caret jump while typing on Android, so
  // it is only forced for the render right after a suggestion is inserted.
  const [forcedSelection, setForcedSelection] = useState<{
    end: number;
    start: number;
  } | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<{
    height: number;
    width: number;
    x: number;
    y: number;
  } | null>(null);
  const moreAnchorRef = useRef<View>(null);
  const [altTarget, setAltTarget] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  // One key per composed post, reused across retries of that post.
  const idempotencyKeyRef = useRef<string | null>(null);

  const toggleMore = () => {
    if (moreAnchor) {
      setMoreAnchor(null);
      return;
    }
    moreAnchorRef.current?.measureInWindow((x, y, width, height) => {
      setMoreAnchor({ height, width, x, y });
    });
  };

  const moreBelow =
    (moreAnchor?.y ?? 0) + (moreAnchor?.height ?? 0) + MORE_SIDE_OFFSET;
  const moreRoomBelow =
    window.height -
    insets.bottom -
    MORE_EDGE_MARGIN -
    (moreBelow + MORE_MENU_HEIGHT);
  const moreMenuTop =
    moreRoomBelow >= 0
      ? moreBelow
      : Math.max(
          insets.top + MORE_EDGE_MARGIN,
          (moreAnchor?.y ?? 0) - MORE_SIDE_OFFSET - MORE_MENU_HEIGHT
        );
  const moreMenuLeft = Math.max(
    MORE_EDGE_MARGIN,
    Math.min(
      moreAnchor?.x ?? 0,
      window.width - MORE_MENU_WIDTH - MORE_EDGE_MARGIN
    )
  );

  const isGust = mode === "gust";
  const isResponse = replyTo !== null;
  const input = premiumInput(isDark, focused);
  const { hasError, isBusy, mediaIds } = scopeReadiness(attachments);
  const hasAudioOrGif = attachments.some(
    (item) => item.family === "AUDIO" || item.isGif
  );
  const capacityFull = attachments.length >= MAX_POST_ATTACHMENTS;
  const exclusiveLocked = hasAudioOrGif;
  const hasVideo = attachments.some((item) => item.family === "VIDEO");
  const modeLocked =
    gustOptions.busy ||
    isResponse ||
    attachments.length > 1 ||
    hasAudioOrGif ||
    (attachments.length === 1 && !hasVideo);
  const trimmed = draft.text.trim();
  const words = wordCount(draft.text);
  const gustNearLimit =
    isGust &&
    (words >= GUST_CAPTION_MAX_WORDS * 0.8 ||
      draft.text.length >= GUST_CAPTION_MAX_CHARS * 0.8);
  const gustExceeded =
    isGust &&
    (words > GUST_CAPTION_MAX_WORDS ||
      draft.text.length > GUST_CAPTION_MAX_CHARS);
  const canPublish =
    (isGust ? hasVideo : trimmed.length > 0 || mediaIds.length > 0) &&
    !isBusy &&
    !hasError &&
    !gustExceeded &&
    !gustOptions.busy &&
    (!isGust ||
      (!gustOptions.error &&
        gustOptions.sound?.status !== "error" &&
        gustOptions.thumbnail?.status !== "error"));

  const trigger: ActiveTrigger | null = focused
    ? activeTrigger(draft.text, selection.start)
    : null;

  const addPicked = (picked: PickedMedia[]) => {
    if (picked.length === 0) {
      return;
    }
    const result = attachmentActions.add(POST_SCOPE, picked, {
      gust: isGust,
      max: MAX_POST_ATTACHMENTS,
      purpose: "post",
      waitForProcessing: false,
    });
    if (result.rejected === "limit") {
      toast({
        description: `Posts hold up to ${MAX_POST_ATTACHMENTS} attachments.`,
        title: "Attachment Limit",
        variant: "destructive",
      });
      return;
    }
    if (result.rejected === "unsupported") {
      toast({
        description: "That file type isn't supported.",
        title: "Not allowed with this media",
        variant: "destructive",
      });
      return;
    }
    if (result.rejected) {
      toast({
        description: "Audio and GIFs go solo, and gusts take one video.",
        title: "Not allowed with this media",
        variant: "destructive",
      });
    }
  };

  const openPhotos = async () => {
    try {
      const remaining = isGust ? 1 : MAX_POST_ATTACHMENTS - attachments.length;
      addPicked(await pickPhotosAndVideos({ remaining, videoOnly: isGust }));
    } catch {
      toast({
        description: "Couldn't open your photos, check app permissions?",
        title: "Photos Unavailable",
        variant: "destructive",
      });
    }
  };

  const openAudio = async () => {
    setMoreAnchor(null);
    try {
      addPicked(await pickAudioFile());
    } catch {
      toast({
        description: "Couldn't open your files, try again?",
        title: "Files Unavailable",
        variant: "destructive",
      });
    }
  };

  const pickGif = async (gif: KlipyGif) => {
    setGifOpen(false);
    try {
      addPicked([await downloadGif(gif)]);
    } catch {
      toast({
        description: "Couldn't add that GIF, try another?",
        title: "GIF Failed",
        variant: "destructive",
      });
    }
  };

  const saveAlt = async (localId: string, alt: string) => {
    setAltTarget(null);
    const saved = await attachmentActions.setAltText(localId, alt);
    if (!saved) {
      toast({
        description: "Couldn't save that alt text, try again?",
        title: "Alt Text Failed",
        variant: "destructive",
      });
    }
  };

  const successCopy = (): string => {
    if (isResponse) {
      return "Your response is live.";
    }
    if (isGust) {
      return "Your gust is live.";
    }
    return "Your fleet is live, nice one!";
  };

  const submit = async () => {
    if (!canPublish || publishing) {
      return;
    }
    setPublishing(true);
    if (idempotencyKeyRef.current === null) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }
    const inlineRelations = collectRelations(draft.text, {
      mentions: draft.mentions,
      tags: draft.tags,
    });
    const relations = isGust
      ? gustRelations(inlineRelations, {
          mentions: draft.gustMentions,
          tags: draft.gustTags,
        })
      : inlineRelations;
    try {
      if (isGust && gustVideo) {
        await flushGustAlt(gustVideo.localId);
      }
      const result = await publishPost(
        {
          // A pure community reshare has no caption of its own: the server
          // allows that only because communitySharePostId is present.
          communityId: draft.communityId,
          communitySharePostId: draft.communitySharePostId,
          content: trimmed,
          hnStory: draft.hnStory,
          isGust: isResponse ? false : isGust,
          mediaIds,
          mentions: relations.mentions,
          parentPostId: replyTo?.id,
          tags: relations.tags,
        },
        idempotencyKeyRef.current
      );
      idempotencyKeyRef.current = null;
      for (const item of attachments) {
        clearGustOptions(item.localId);
      }
      attachmentActions.clear(POST_SCOPE, { discard: false });
      clearDraft();
      setAltTarget(null);
      setGifOpen(false);
      // Reveal fleets in Home; Gusts open their own feed after closing the composer.
      if (result.kind === "created" && !isResponse && !isGust) {
        revealPublishedPost(result.post, viewerId);
      }
      toast({
        description: successCopy(),
        title: isResponse ? "Response Posted" : "Posted",
      });
      onPublished?.();
      if (!isResponse && isGust) {
        router.push({
          params: {
            id: result.kind === "created" ? result.post.id : result.postId,
          },
          pathname: "/gusts",
        });
      }
    } catch (error) {
      toast({
        description:
          error instanceof Error && error.message
            ? error.message
            : "Couldn't create your post, try again?",
        title: "Post Failed",
        variant: "destructive",
      });
    }
    setPublishing(false);
  };

  const insertToken = (token: string, onPick: () => void) => {
    if (!trigger) {
      return;
    }
    const next = applySuggestion(draft.text, selection.start, trigger, token);
    setDraft({ text: next.text });
    setSelection({ end: next.cursor, start: next.cursor });
    setForcedSelection({ end: next.cursor, start: next.cursor });
    onPick();
  };

  const altAttachment = attachments.find((item) => item.localId === altTarget);
  const panel = isDark ? APPLE_PANEL_TOKENS.dark : APPLE_PANEL_TOKENS.light;
  const reels = reelsPanel(isDark);
  const allImages =
    attachments.length >= 3 &&
    attachments.every((item) => item.family === "IMAGE" && !item.isGif);

  let capacityChip: { background: string; color: string } = {
    background: isDark ? "#303030" : "#e8e8e8",
    color: text.muted,
  };
  if (capacityFull) {
    capacityChip = {
      background: "rgba(220, 38, 38, 0.1)",
      color: text.destructive,
    };
  } else if (attachments.length >= MAX_POST_ATTACHMENTS - 3) {
    capacityChip = {
      background: "rgba(245, 158, 11, 0.1)",
      color: isDark ? "#fbbf24" : "#d97706",
    };
  }

  let capacityHint: React.ReactNode = null;
  if (capacityFull) {
    capacityHint = (
      <Text style={[styles.capacityHint, { color: text.destructive }]}>
        limit reached
      </Text>
    );
  } else if (attachments.length > 1) {
    capacityHint = (
      <Text style={[styles.capacityHint, { color: text.muted }]}>
        tap the grip to move a tile up
      </Text>
    );
  }

  const inline = variant === "feed";
  const captionBlock = (
    <>
      <View
        style={[
          styles.inputBox,
          { backgroundColor: input.background, boxShadow: input.shadows },
        ]}
      >
        <TextInput
          accessibilityLabel={isGust ? "Gust caption" : "Post text"}
          autoFocus={!inline}
          multiline
          onBlur={() => setFocused(false)}
          onChangeText={(value) => setDraft({ text: value })}
          onFocus={() => setFocused(true)}
          onSelectionChange={(event) => {
            setSelection(event.nativeEvent.selection);
            setForcedSelection(null);
          }}
          placeholder={
            isGust
              ? "Add a caption for your gust..."
              : "What's crack-a-lackin'?"
          }
          placeholderTextColor={input.placeholder}
          selection={forcedSelection ?? undefined}
          style={[styles.input, { color: input.text }]}
          textAlignVertical="top"
          value={draft.text}
        />
      </View>
      <InlineSuggestions
        active={trigger}
        excludedTags={draft.tags}
        excludedUserIds={draft.mentions.map((mention) => mention.id)}
        onPickTag={(tag) =>
          insertToken(tag, () =>
            setDraft({
              tags: draft.tags.includes(tag)
                ? draft.tags
                : [...draft.tags, tag],
            })
          )
        }
        onPickUser={(user) =>
          insertToken(user.username, () =>
            setDraft({
              mentions: draft.mentions.some((m) => m.id === user.id)
                ? draft.mentions
                : [...draft.mentions, user],
            })
          )
        }
      />
    </>
  );
  const publishControls = (
    <>
      <ModeToggle
        disabled={modeLocked}
        isGust={isGust}
        onChange={(gust) => {
          setMoreAnchor(null);
          setMode(gust ? "gust" : "post");
        }}
      />
      <PublishButton
        disabled={!canPublish}
        label={isGust ? "Gust" : "Fleet"}
        loading={publishing}
        onPress={() => {
          void submit();
        }}
      />
    </>
  );
  if (isGust && gustVideo) {
    return (
      <GustEditor
        attachment={gustVideo}
        caption={captionBlock}
        footer={publishControls}
        viewerAvatar={viewerAvatar}
        counter={
          gustNearLimit ? (
            <View style={styles.counterRow}>
              <AnimatedWordCounter
                current={words}
                max={GUST_CAPTION_MAX_WORDS}
              />
              <Text style={[styles.counter, { color: text.muted }]}>
                {draft.text.length}/{GUST_CAPTION_MAX_CHARS} chars
              </Text>
            </View>
          ) : null
        }
      />
    );
  }

  return (
    <View
      style={[
        styles.root,
        // The inline row sits directly on the feed, so it wears the feed's own
        // page background (web's --background-alt) rather than a hardcoded
        // shade, and is separated by the app's standard hairline divider. Using
        // the tokens keeps it in step with the feed across both themes. It
        // needs no stacking of its own: it renders as the feed list's header,
        // so it scrolls with the content and nothing can overlap it.
        inline
          ? {
              backgroundColor: theme.containerBg,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderColor: theme.dividerLine,
              borderTopWidth: StyleSheet.hairlineWidth,
            }
          : null,
      ]}
    >
      {replyTo ? (
        <ResponsePreview onClear={clearReplyTo} replyTo={replyTo} />
      ) : null}
      <View style={styles.row}>
        <UserAvatar radius={16} size={48} url={viewerAvatar} />
        <View style={styles.column}>
          {captionBlock}

          {gifOpen && !isGust ? (
            <View
              style={[
                styles.gifPanel,
                {
                  backgroundColor: reels.background,
                  borderColor: reels.border,
                  boxShadow: reels.shadows,
                },
              ]}
            >
              <GifPicker
                disabled={isBusy}
                onSelect={(gif) => {
                  void pickGif(gif);
                }}
              />
            </View>
          ) : null}

          {gustNearLimit ? (
            <View style={styles.counterRow}>
              <AnimatedWordCounter
                current={words}
                max={GUST_CAPTION_MAX_WORDS}
              />
              <Text style={[styles.counter, { color: text.muted }]}>
                {draft.text.length}/{GUST_CAPTION_MAX_CHARS} chars
              </Text>
            </View>
          ) : null}

          {!isGust && attachments.length > 0 ? (
            <View style={styles.capacityRow}>
              <Text
                style={[
                  styles.capacity,
                  {
                    backgroundColor: capacityChip.background,
                    color: capacityChip.color,
                  },
                ]}
              >
                {attachments.length}/{MAX_POST_ATTACHMENTS}
              </Text>
              {capacityHint}
            </View>
          ) : null}

          {attachments.length > 0 ? (
            <View style={[styles.tiles, allImages && styles.tilesGrid]}>
              {attachments.map((item, index) => (
                <View
                  key={item.localId}
                  style={allImages ? styles.gridCell : styles.listCell}
                >
                  <AttachmentTile
                    attachment={item}
                    onEditAlt={
                      isGust ? undefined : () => setAltTarget(item.localId)
                    }
                    onRemove={() => {
                      if (altTarget === item.localId) {
                        setAltTarget(null);
                      }
                      attachmentActions.remove(item.localId);
                      clearGustOptions(item.localId);
                    }}
                    onRetry={() => attachmentActions.retry(item.localId)}
                  />
                  {attachments.length > 1 && index > 0 ? (
                    <View style={styles.grip}>
                      <IconButton3D
                        accessibilityLabel="Move attachment earlier"
                        icon={GripVertical}
                        iconSize={14}
                        onPress={() =>
                          attachmentActions.move(POST_SCOPE, index, index - 1)
                        }
                        size={28}
                      />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {altAttachment && !isGust ? (
            <AltTextPanel
              attachment={altAttachment}
              key={altAttachment.localId}
              onClose={() => setAltTarget(null)}
              onSave={(alt) => {
                void saveAlt(altAttachment.localId, alt);
              }}
            />
          ) : null}

          <View style={styles.toolbar}>
            <View style={styles.toolbarLeft}>
              <ToolbarButton
                disabled={
                  capacityFull || exclusiveLocked || (isGust && hasVideo)
                }
                icon={isGust ? Video : ImageIcon}
                label={isGust ? "Upload video" : "Photos & Videos"}
                onPress={() => {
                  void openPhotos();
                }}
              />
              {isGust ? null : (
                <>
                  <View collapsable={false} ref={moreAnchorRef}>
                    <ToolbarButton
                      active={moreAnchor !== null}
                      disabled={capacityFull}
                      icon={MoreHorizontal}
                      label="More attachment options"
                      onPress={toggleMore}
                    />
                  </View>
                  {moreAnchor ? (
                    <Modal
                      animationType="none"
                      navigationBarTranslucent
                      onRequestClose={() => setMoreAnchor(null)}
                      statusBarTranslucent
                      transparent
                      visible
                    >
                      <Pressable
                        accessibilityLabel="Close attachment options"
                        onPress={() => setMoreAnchor(null)}
                        style={StyleSheet.absoluteFill}
                      />
                      <View
                        onStartShouldSetResponder={() => true}
                        style={[
                          styles.moreMenu,
                          {
                            backgroundColor: panel.background,
                            borderColor: panel.border,
                            boxShadow: panel.shadows,
                            left: moreMenuLeft,
                            top: moreMenuTop,
                          },
                        ]}
                      >
                        <Pressable
                          accessibilityRole="button"
                          disabled={attachments.length > 0}
                          onPress={() => {
                            setMoreAnchor(null);
                            setGifOpen((open) => !open);
                          }}
                          style={({ pressed }) => [
                            styles.moreItem,
                            pressed && {
                              backgroundColor: isDark ? "#303030" : "#e8e8e8",
                            },
                            attachments.length > 0 && styles.disabled,
                          ]}
                        >
                          <Clapperboard color={text.muted} size={18} />
                          <Text
                            style={[
                              styles.moreText,
                              { color: text.foreground },
                            ]}
                          >
                            GIFs
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={attachments.length > 0}
                          onPress={() => {
                            setMoreAnchor(null);
                            void openAudio();
                          }}
                          style={({ pressed }) => [
                            styles.moreItem,
                            pressed && {
                              backgroundColor: isDark ? "#303030" : "#e8e8e8",
                            },
                            attachments.length > 0 && styles.disabled,
                          ]}
                        >
                          <FileAudio color={text.muted} size={18} />
                          <Text
                            style={[
                              styles.moreText,
                              { color: text.foreground },
                            ]}
                          >
                            Audio Files
                          </Text>
                        </Pressable>
                      </View>
                    </Modal>
                  ) : null}
                </>
              )}
            </View>
            <View style={styles.toolbarRight}>{publishControls}</View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capacity: {
    borderRadius: 9999,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  capacityHint: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  capacityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  counter: {
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    marginTop: 8,
  },
  counterRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  dimmed: {
    opacity: 0.5,
  },
  disabled: {
    opacity: 0.5,
  },
  gifPanel: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    padding: 10,
  },
  gridCell: {
    width: "31.5%",
  },
  grip: {
    left: 8,
    position: "absolute",
    top: 8,
  },
  input: {
    fontFamily: "SofiaProReg",
    fontSize: 15,
    lineHeight: 22,
    maxHeight: 296,
    minHeight: 24,
    padding: 0,
  },
  inputBox: {
    borderRadius: 12,
    maxHeight: 320,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  listCell: {
    width: "100%",
  },
  moreItem: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  moreMenu: {
    borderRadius: 12,
    borderWidth: 1,
    // Rendered inside an anchored Modal overlay to float above all FlatList
    // rows and avoid being painted over or clipped on Android.
    elevation: 8,
    minWidth: MORE_MENU_WIDTH,
    padding: 6,
    position: "absolute",
  },
  moreText: {
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  pressed: {
    transform: [{ translateY: 1 }],
  },
  publish: {
    flexDirection: "row",
    gap: 6,
    height: 32,
    minWidth: 72,
    paddingHorizontal: 16,
  },
  publishText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    letterSpacing: -0.3,
    ...({ textShadow: "0 1px 1px rgba(0, 0, 0, 0.2)" } as Record<
      string,
      string
    >),
  },
  root: {
    gap: 20,
    padding: 20,
  },
  row: {
    flexDirection: "row",
    gap: 20,
  },
  segment: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  segmentText: {
    fontFamily: "SofiaProBold",
    fontSize: 12,
  },
  tiles: {
    gap: 12,
    marginTop: 12,
  },
  tilesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  toggle: {
    alignItems: "center",
    borderRadius: 9999,
    borderWidth: 1,
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
    flexDirection: "row",
    gap: 2,
    height: 36,
    padding: 2,
  },
  toolButton: {
    alignItems: "center",
    borderRadius: 9999,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginTop: 12,
    zIndex: 20,
  },
  toolbarLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  toolbarRight: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
