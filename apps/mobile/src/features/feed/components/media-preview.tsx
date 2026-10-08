import { BottomSheet, Host } from "@expo/ui";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  ArrowBigDown,
  ArrowBigUp,
  Bookmark,
  CornerDownRight,
  Download,
  Maximize2,
  MessageSquare,
  Share2,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { toast } from "@/components/feedback/toast";
import { Gradient3D } from "@/components/surface/gradient-3d";
import {
  BOOKMARK_ACTIVE_SHADOWS,
  BOOKMARK_GRADIENT,
  ORANGE_GRADIENT,
  PURPLE_GRADIENT,
  VOTE_DOWN_SHADOWS,
  VOTE_DOWN_SHADOWS_DARK,
  VOTE_UP_SHADOWS,
  VOTE_UP_SHADOWS_DARK,
  panel3d,
} from "@/components/surface/recipes";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  replyTargetFromPost,
  useComposerStore,
} from "@/features/composer/state/composer-store";
import { getApiBaseUrl } from "@/lib/api-env";
import { withAuthHeaders } from "@/lib/auth-headers";
import { haptic } from "@/lib/haptics";
import { useAppTheme } from "@/theme";

import { getUserVote, isBookmarkedByUser } from "../lib/feed-types";
import {
  mediaDimensionsCache,
  mediaDimensionsKey,
} from "../lib/media-dimensions";
import { mediaDownloadDescriptor } from "../lib/media-download";
import { mediaPreviewLayout } from "../lib/media-preview-layout";
import {
  isVideoMedia,
  mediaImageUrl,
  mediaPosterUrl,
  mediaVideoUrl,
} from "../lib/media-url";
import { useMediaPreviewStore } from "../state/media-preview-store";
import type { MediaPreviewRequest } from "../state/media-preview-store";
import { usePostEngagement } from "../state/use-post-engagement";
import { MediaSheetContent } from "./media-sheet-content";

function MediaAction({
  action,
  busy,
  centered = false,
  color,
  icon: Icon,
  iconColor,
  label,
  selected,
  surface,
}: {
  action: () => void;
  busy: boolean;
  centered?: boolean;
  color: string;
  icon: LucideIcon;
  iconColor: string;
  label: string;
  selected?: boolean;
  surface?: Pick<ComponentProps<typeof Gradient3D>, "colors" | "shadows">;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy, selected }}
      disabled={busy}
      onPress={action}
      className="justify-center px-3 py-2"
      style={{
        alignItems: centered ? "center" : "stretch",
        minHeight: 44,
        width: centered ? "50%" : undefined,
      }}
    >
      {({ pressed }) => (
        <View
          className="flex-row items-center gap-3"
          collapsable={false}
          testID={`media-action-content-${label}`}
          style={{
            opacity: (busy ? 0.5 : 1) * (pressed ? 0.6 : 1),
          }}
        >
          <View
            className="items-center justify-center"
            style={{ height: 28, width: 28 }}
          >
            {selected && surface ? (
              <Gradient3D {...surface} style={{ height: 28, width: 28 }}>
                <Icon color="#ffffff" fill="#ffffff" size={16} />
              </Gradient3D>
            ) : (
              <Icon color={iconColor} size={22} />
            )}
          </View>
          <Text
            style={{
              color,
              fontFamily: "SofiaProMed",
              fontSize: 15,
              lineHeight: 22,
            }}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function PreviewVideo({ request }: { request: MediaPreviewRequest }) {
  const [ready, setReady] = useState(false);
  const player = useVideoPlayer(
    mediaVideoUrl(getApiBaseUrl(), request.media.id),
    (instance) => {
      instance.muted = true;
      instance.loop = true;
      instance.play();
    }
  );
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        player.play();
      } else {
        player.pause();
      }
    });
    return () => listener.remove();
  }, [player]);
  return (
    <>
      <VideoView
        player={player}
        nativeControls={false}
        pointerEvents="none"
        contentFit="contain"
        surfaceType="textureView"
        onFirstFrameRender={() => setReady(true)}
        style={{ height: "100%", width: "100%" }}
      />
      {ready ? null : (
        <Image
          cachePolicy="memory-disk"
          contentFit="contain"
          source={{ uri: mediaPosterUrl(getApiBaseUrl(), request.media.id) }}
          style={{ height: "100%", position: "absolute", width: "100%" }}
        />
      )}
    </>
  );
}
export function MediaPreview({ request }: { request: MediaPreviewRequest }) {
  const { theme, isDark } = useAppTheme();
  const { user } = useSessionContext();
  const router = useRouter();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const [presented, setPresented] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closing = useRef(false);
  const afterClose = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const sheetRef = useRef<View>(null);
  const measureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomPadding = Math.max(insets.bottom, 12);
  const menuHeight = Math.min(
    (window.height - insets.bottom) * 0.48,
    7 * 44 + 6 * 4 + 32 + bottomPadding + 16
  );
  const [sheetTop, setSheetTop] = useState(
    () => window.height - menuHeight - insets.bottom
  );
  const panel = panel3d(isDark);
  const knownDimensions = mediaDimensionsCache.get(
    mediaDimensionsKey(getApiBaseUrl(), request.media.id)
  );
  const target = mediaPreviewLayout(
    window,
    knownDimensions ?? request.media,
    insets.top,
    request.bounds,
    sheetTop
  );
  const stage = mediaPreviewLayout(
    window,
    knownDimensions ?? request.media,
    insets.top,
    request.bounds,
    window.height
  );
  const previewTarget = useSharedValue(target);
  const {
    height: targetHeight,
    width: targetWidth,
    x: targetX,
    y: targetY,
  } = target;
  useEffect(() => {
    previewTarget.set(
      withTiming(
        { height: targetHeight, width: targetWidth, x: targetX, y: targetY },
        { duration: 180, reduceMotion: ReduceMotion.System }
      )
    );
  }, [previewTarget, targetHeight, targetWidth, targetX, targetY]);
  const { bounds, media, post } = request;
  const { engagement, toggleBookmark, vote } = usePostEngagement({
    aura: post.aura ?? 0,
    initialBookmarked: isBookmarkedByUser(post, user?.id),
    postId: post.id,
    userVote: getUserVote(post),
    viewerId: user?.id ?? null,
  });
  const finishClose = useCallback(() => {
    if (useMediaPreviewStore.getState().request === request) {
      useMediaPreviewStore.getState().close();
    }
    afterClose.current?.();
  }, [request]);
  const close = useCallback(
    (next?: () => void) => {
      if (closing.current) {
        return;
      }
      closing.current = true;
      afterClose.current = next ?? null;
      setPresented(false);
      setVideoReady(false);
      progress.set(
        withTiming(
          0,
          { duration: 220, reduceMotion: ReduceMotion.System },
          (finished) => {
            if (finished) {
              scheduleOnRN(finishClose);
            }
          }
        )
      );
    },
    [finishClose, progress]
  );
  useEffect(() => {
    progress.set(
      withSpring(
        1,
        {
          dampingRatio: 0.92,
          duration: 300,
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          if (finished) {
            scheduleOnRN(setVideoReady, true);
          }
        }
      )
    );
    return () => {
      mounted.current = false;
      if (measureTimer.current) {
        clearTimeout(measureTimer.current);
      }
    };
  }, [progress]);
  const previewStyle = useAnimatedStyle(() => {
    const value = progress.get();
    const destination = previewTarget.get();
    const position = reducedMotion ? 1 : value;
    const width = bounds.width + (destination.width - bounds.width) * position;
    const height =
      bounds.height + (destination.height - bounds.height) * position;
    const centerX =
      bounds.x +
      bounds.width / 2 +
      (destination.x + destination.width / 2 - bounds.x - bounds.width / 2) *
        position;
    const centerY =
      bounds.y +
      bounds.height / 2 +
      (destination.y + destination.height / 2 - bounds.y - bounds.height / 2) *
        position;
    return {
      opacity: reducedMotion ? value : 1,
      transform: [
        { translateX: centerX - stage.width / 2 },
        { translateY: centerY - stage.height / 2 },
        { scaleX: width / stage.width },
        { scaleY: height / stage.height },
      ],
    };
  });
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get() * 0.78,
  }));
  const requireUser = (action: () => void) => {
    if (user) {
      action();
    } else {
      close(() => router.push("/login"));
    }
  };
  const download = async () => {
    const descriptor = mediaDownloadDescriptor(getApiBaseUrl(), media);
    const directory = new Directory(Paths.cache, "media-actions");
    directory.create({ idempotent: true, intermediates: true });
    const file = new File(directory, descriptor.fileName);
    // Retain shared files while another app reads them; prune on the next action.
    for (const older of directory.list()) {
      if (
        older instanceof File &&
        older.uri !== file.uri &&
        Date.now() - (older.modificationTime ?? 0) > 24 * 60 * 60 * 1000
      ) {
        older.delete();
      }
    }
    if (!file.exists || file.size === 0) {
      try {
        await File.downloadFileAsync(descriptor.url, file, {
          headers: withAuthHeaders({}, await authClient.getCookie()),
          idempotent: true,
        });
      } catch (error) {
        if (file.exists) {
          file.delete();
        }
        throw error;
      }
    }
    return { descriptor, file };
  };
  const run = async (action: () => Promise<unknown>, feedback = true) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    if (feedback) {
      haptic();
    }
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (feedback) {
        haptic("error");
      }
      toast({
        description:
          error instanceof Error ? error.message : "Please try again.",
        title: "Couldn't complete the action",
        variant: "destructive",
      });
    }
    busyRef.current = false;
    if (mounted.current) {
      setBusy(false);
    }
  };
  const save = async () => {
    // Android 10+ allows inserting our own downloads without reading the library.
    if (Platform.OS !== "android" || Number(Platform.Version) < 29) {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        throw new Error(
          "Allow saving photos in system settings and try again."
        );
      }
    }
    const { file } = await download();
    await MediaLibrary.Asset.create(file.uri);
    haptic("success");
    toast({ title: "Saved to your gallery" });
  };
  const share = async () => {
    if (!(await Sharing.isAvailableAsync())) {
      await Share.share({
        message: `https://asocialmedia.cc/posts/${post.id}`,
      });
      return;
    }
    const { descriptor, file } = await download();
    await Sharing.shareAsync(file.uri, {
      dialogTitle: "Share media",
      mimeType: descriptor.mimeType,
    });
  };
  const actions = [
    {
      action: () => {
        void run(save);
      },
      icon: Download,
      label: "Save media",
    },
    {
      action: () => {
        void run(share);
      },
      icon: Share2,
      label: "Share media",
    },
    {
      action: () =>
        requireUser(() =>
          close(() =>
            useComposerStore.getState().open("post", replyTargetFromPost(post))
          )
        ),
      icon: CornerDownRight,
      label: "Respond",
    },
    {
      action: () =>
        requireUser(() => {
          haptic();
          close(() =>
            router.push({
              params: { eddie: "1", postId: post.id },
              pathname: "/posts/[postId]",
            })
          );
        }),
      icon: MessageSquare,
      label: "Eddie",
    },
    {
      action: () =>
        requireUser(() => {
          void run(toggleBookmark, false);
        }),
      icon: Bookmark,
      label: engagement.isBookmarkedByUser ? "Bookmarked" : "Bookmark",
      selected: engagement.isBookmarkedByUser,
      surface: { colors: BOOKMARK_GRADIENT, shadows: BOOKMARK_ACTIVE_SHADOWS },
    },
    {
      action: () => {
        haptic();
        close(() =>
          router.push({
            params: {
              index: String(
                Math.max(
                  0,
                  (post.attachments ?? []).findIndex(
                    (item) => item.id === media.id
                  )
                )
              ),
              postId: post.id,
            },
            pathname: "/posts/[postId]/media/[index]",
          })
        );
      },
      icon: Maximize2,
      label: "Open full screen",
    },
  ];
  const voteActions = [
    {
      action: () =>
        requireUser(() => {
          void run(() => vote(1), false);
        }),
      icon: ArrowBigUp,
      label: engagement.userVote === 1 ? "Amplified" : "Amplify",
      selected: engagement.userVote === 1,
      surface: {
        colors: ORANGE_GRADIENT,
        shadows: isDark ? VOTE_UP_SHADOWS_DARK : VOTE_UP_SHADOWS,
      },
    },
    {
      action: () =>
        requireUser(() => {
          void run(() => vote(-1), false);
        }),
      icon: ArrowBigDown,
      label: engagement.userVote === -1 ? "Muted" : "Mute",
      selected: engagement.userVote === -1,
      surface: {
        colors: PURPLE_GRADIENT,
        shadows: isDark ? VOTE_DOWN_SHADOWS_DARK : VOTE_DOWN_SHADOWS,
      },
    },
  ];
  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onRequestClose={() => close()}
    >
      <GestureHandlerRootView className="flex-1">
        <Animated.View
          pointerEvents="none"
          style={[
            {
              backgroundColor: "black",
              bottom: 0,
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
            },
            backdropStyle,
          ]}
        />
        <Pressable
          accessibilityLabel="Close media preview"
          accessibilityRole="button"
          onPress={() => close()}
          className="absolute inset-0"
        />
        <Animated.View
          pointerEvents="none"
          style={[
            {
              backgroundColor: "#161616",
              borderColor: "rgba(255,255,255,0.22)",
              borderRadius: 18,
              borderWidth: 1,
              height: stage.height,
              left: 0,
              overflow: "hidden",
              position: "absolute",
              top: 0,
              width: stage.width,
            },
            previewStyle,
          ]}
        >
          {isVideoMedia(media) && videoReady ? (
            <PreviewVideo request={request} />
          ) : (
            <Image
              accessibilityLabel={media.altText ?? "Media preview"}
              cachePolicy="memory-disk"
              contentFit="contain"
              source={{
                uri: isVideoMedia(media)
                  ? mediaPosterUrl(getApiBaseUrl(), media.id)
                  : mediaImageUrl(getApiBaseUrl(), media),
              }}
              placeholder={media.blurDataUrl ?? undefined}
              style={{ height: "100%", width: "100%" }}
            />
          )}
        </Animated.View>
        <Host colorScheme={isDark ? "dark" : "light"}>
          <BottomSheet
            isPresented={presented}
            onDismiss={() => close()}
            contentPadding={0}
            showDragIndicator={false}
            containerColor={theme.cardBg}
            scrimColor="transparent"
            testID="media-actions-sheet"
          >
            <MediaSheetContent>
              <View
                ref={sheetRef}
                collapsable={false}
                onLayout={() => {
                  setSheetTop(window.height - menuHeight - insets.bottom);
                  if (measureTimer.current) {
                    clearTimeout(measureTimer.current);
                  }
                  // Native presentation translates the sheet after the React layout callback.
                  measureTimer.current = setTimeout(() => {
                    sheetRef.current?.measureInWindow((_x, y) => {
                      if (
                        mounted.current &&
                        !closing.current &&
                        y > insets.top + 24 &&
                        y < window.height
                      ) {
                        setSheetTop(y);
                      }
                    });
                  }, 350);
                }}
                style={{
                  backgroundColor: theme.cardBg,
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  height: menuHeight,
                  overflow: "hidden",
                  paddingBottom: bottomPadding,
                  width: window.width,
                }}
              >
                <View
                  pointerEvents="none"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: panel.border,
                    borderTopLeftRadius: 28,
                    borderTopRightRadius: 28,
                    borderWidth: 1,
                    bottom: -16,
                    boxShadow: panel.shadows,
                    left: 0,
                    position: "absolute",
                    right: 0,
                    top: 0,
                  }}
                />
                <View
                  pointerEvents="none"
                  style={{
                    alignItems: "center",
                    height: 32,
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      backgroundColor: theme.dividerText,
                      borderRadius: 2,
                      height: 4,
                      width: 36,
                    }}
                  />
                </View>
                <ScrollView
                  style={{ flex: 1 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    gap: 4,
                    paddingHorizontal: 16,
                    paddingVertical: 2,
                  }}
                >
                  <View
                    className="mb-1 flex-row pb-1"
                    style={{
                      borderBottomColor: panel.border,
                      borderBottomWidth: 1,
                    }}
                  >
                    {/* oxlint-disable-next-line react/refs -- descriptors contain press callbacks; refs are read only on a press */}
                    {voteActions.map((item) => (
                      <MediaAction
                        key={item.label}
                        {...item}
                        busy={busy}
                        centered
                        color={theme.inputText}
                        iconColor={theme.dividerText}
                      />
                    ))}
                  </View>
                  {/* oxlint-disable-next-line react/refs -- descriptors contain press callbacks; refs are read only on a press */}
                  {actions.map((item) => (
                    <MediaAction
                      key={item.label}
                      {...item}
                      busy={busy}
                      color={theme.inputText}
                      iconColor={theme.dividerText}
                    />
                  ))}
                </ScrollView>
              </View>
            </MediaSheetContent>
          </BottomSheet>
        </Host>
      </GestureHandlerRootView>
    </Modal>
  );
}
