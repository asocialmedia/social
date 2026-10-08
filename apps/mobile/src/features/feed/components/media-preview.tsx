import { BottomSheet, Host } from "@expo/ui";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
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
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const closing = useRef(false);
  const afterClose = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const target = mediaPreviewLayout(window, request.media, insets.top);
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
    };
  }, [progress]);
  const previewStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      opacity: reducedMotion ? value : 1,
      transform: reducedMotion
        ? []
        : [
            {
              translateX:
                (1 - value) *
                (bounds.x + bounds.width / 2 - target.x - target.width / 2),
            },
            {
              translateY:
                (1 - value) *
                (bounds.y + bounds.height / 2 - target.y - target.height / 2),
            },
            {
              scaleX:
                bounds.width / target.width +
                value * (1 - bounds.width / target.width),
            },
            {
              scaleY:
                bounds.height / target.height +
                value * (1 - bounds.height / target.height),
            },
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
  const run = async (
    label: string,
    action: () => Promise<unknown>,
    feedback = true
  ) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    if (feedback) {
      haptic();
    }
    setBusy(label);
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
      setBusy(null);
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
        void run("Saving…", save);
      },
      label: "Save media",
    },
    {
      action: () => {
        void run("Preparing share…", share);
      },
      label: "Share media",
    },
    {
      action: () =>
        requireUser(() =>
          close(() =>
            useComposerStore.getState().open("post", replyTargetFromPost(post))
          )
        ),
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
      label: "Eddie",
    },
    {
      action: () =>
        requireUser(() => {
          void run("Bookmarking…", toggleBookmark, false);
        }),
      label: engagement.isBookmarkedByUser ? "Bookmarked" : "Bookmark",
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
      label: "Open full screen",
    },
    {
      action: () =>
        requireUser(() => {
          void run("Amplifying…", () => vote(1), false);
        }),
      label: engagement.userVote === 1 ? "Amplified" : "Amplify",
    },
    {
      action: () =>
        requireUser(() => {
          void run("Muting…", () => vote(-1), false);
        }),
      label: engagement.userVote === -1 ? "Muted" : "Mute post",
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
              height: target.height,
              left: target.x,
              overflow: "hidden",
              position: "absolute",
              top: target.y,
              width: target.width,
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
            containerColor={theme.cardBg}
            scrimColor="transparent"
            testID="media-actions-sheet"
          >
            <MediaSheetContent>
              <View
                style={{
                  gap: 8,
                  paddingBottom: Math.max(insets.bottom, 12),
                  paddingHorizontal: 16,
                  width: window.width,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.inputText,
                    fontFamily: "SofiaProMed",
                    fontSize: 15,
                  }}
                >
                  Media · @{post.user?.username ?? "post"}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {/* oxlint-disable-next-line react/refs -- action descriptors contain event callbacks; their refs are read only on a press */}
                  {actions.map(({ label, action }) => (
                    <Pressable
                      key={label}
                      disabled={Boolean(busy)}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: Boolean(busy) }}
                      onPress={action}
                      style={({ pressed }) => ({
                        backgroundColor: pressed
                          ? theme.containerBg
                          : theme.cardBg,
                        borderColor: theme.cardBorder,
                        borderRadius: 12,
                        borderWidth: 1,
                        boxShadow: "inset 0 1px 1px rgba(255,255,255,0.12)",
                        minHeight: 44,
                        opacity: busy ? 0.5 : 1,
                        padding: 12,
                        width: (window.width - 40) / 2,
                      })}
                    >
                      <Text
                        style={{
                          color: theme.inputText,
                          fontFamily: "SofiaProMed",
                          fontSize: 14,
                        }}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {busy ? (
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      gap: 8,
                    }}
                  >
                    <ActivityIndicator color={theme.auxLink} />
                    <Text style={{ color: theme.inputText }}>{busy}</Text>
                  </View>
                ) : null}
              </View>
            </MediaSheetContent>
          </BottomSheet>
        </Host>
      </GestureHandlerRootView>
    </Modal>
  );
}
