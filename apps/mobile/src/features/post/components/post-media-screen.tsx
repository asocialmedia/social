// Fullscreen post media screen: native 1:1 of web MediaViewer's MOBILE
// layout in standalone page mode (media-page.tsx -> MediaViewer standalone).
//
// Same composed phone screen: fullscreen media with prev/next + counter,
// close top-left, share top-right (v1 standby for the PostMoreButton
// media-page variant until MoreMenu's migration settles - see detail
// screen header), tap-blank toggles all chrome, and the stacked bottom
// panel (user, text, AI/ALT badges, eddies + aura + share + bookmark
// actions, video control row). Swipe pages between attachments; the URL
// index stays shareable via replace (no remount, like web onNavigate).
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import type { VideoView as VideoViewType } from "expo-video";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Pause,
  Play,
  Speech,
  Subtitles,
  Volume2,
  VolumeX,
  X,
  Share2,
  Maximize,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import errorImage from "@/assets/images/error.png";
import notFoundImage from "@/assets/images/notfound.png";
import { authClient } from "@/features/auth/lib/auth-client";
import { useSessionContext } from "@/features/auth/state/session";
import {
  BookmarkToggle,
  VoteCluster,
} from "@/features/feed/components/post-actions";
import { PostComments } from "@/features/feed/components/post-comments";
import {
  AudioRow,
  ExplicitGate,
  ModeratedNotice,
} from "@/features/feed/components/post-media";
import { ShareSheet } from "@/features/feed/components/share-sheet";
import { fetchCaptionsVtt } from "@/features/feed/lib/feed-api";
import type { FeedMedia, FeedPost } from "@/features/feed/lib/feed-types";
import {
  getUserVote,
  isBookmarkedByUser,
} from "@/features/feed/lib/feed-types";
import {
  isAudioMedia,
  isVideoMedia,
  mediaImageUrl,
  mediaPosterUrl,
  mediaVideoUrl,
} from "@/features/feed/lib/media-url";
import {
  cuesFromTranscript,
  findActiveCue,
  parseWebVttCues,
  splitTranscriptIntoTimedLines,
} from "@/features/feed/lib/transcript-cues";
import type { TranscriptCue } from "@/features/feed/lib/transcript-cues";
import { useVideoMuteStore } from "@/features/feed/state/video-mute-store";
import { BioContent } from "@/features/home/components/bio-content";
import { resolveProfileImageUrl } from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { getApiBaseUrl } from "@/lib/api-env";
import { logWarn } from "@/lib/telemetry";
import { useAppTheme } from "@/theme";

import { fetchPostDetail } from "../lib/post-api";

// Dark 3D chip for the viewer chrome, same recipe as the feed video pills.
const DARK_CHIP_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 2px 6px rgba(0, 0, 0, 0.35)";
const ACCENT_CHIP_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

function formatPlaybackTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function AiBadge({ label = "AI Generated" }: { label?: string }) {
  return (
    <View
      accessibilityLabel="AI-generated content"
      accessibilityRole="text"
      pointerEvents="none"
      style={[styles.aiBadge, { boxShadow: ACCENT_CHIP_SHADOWS }]}
    >
      <LinearGradient
        colors={["#7c5cff", "#5a3ae0"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.aiGradient}
      >
        <Text style={styles.aiText}>{label}</Text>
      </LinearGradient>
    </View>
  );
}

function AltBadge({ text }: { text: string }) {
  const repost = text.startsWith("originally from @");
  return (
    <View style={[styles.altBadge, { boxShadow: DARK_CHIP_SHADOWS }]}>
      <LinearGradient
        colors={["#71717a", "#3f3f46"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.altGradient}
      >
        <Text style={styles.altKind}>{repost ? "REPOST" : "ALT"}</Text>
        <Text numberOfLines={3} style={styles.altText}>
          {text}
        </Text>
      </LinearGradient>
    </View>
  );
}

function ChipButton({
  children,
  label,
  onPress,
}: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={[styles.chip, { boxShadow: DARK_CHIP_SHADOWS }]}
    >
      <LinearGradient
        colors={["#3a3f4a", "#23262e"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.chipFill}
      >
        {children}
      </LinearGradient>
    </Pressable>
  );
}

// Fullscreen video page: expo-video with the mobile panel's control row
// (play + clock, mute, speed, captions, transcript, fullscreen). Captions
// default on like web's video-captions-store; the transcript opens a cue
// sheet instead of web's drawer/sidebar.
function FullscreenVideo({
  apiBase,
  captionsEnabled,
  media,
  onToggleCaptions,
  onToggleTranscript,
}: {
  apiBase: string;
  captionsEnabled: boolean;
  media: FeedMedia;
  onToggleCaptions: () => void;
  onToggleTranscript: () => void;
}) {
  const isMuted = useVideoMuteStore((state) => state.isMuted);
  const setMuted = useVideoMuteStore((state) => state.setMuted);
  const viewRef = useRef<VideoViewType>(null);
  const player = useVideoPlayer(mediaVideoUrl(apiBase, media.id), (created) => {
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.muted = useVideoMuteStore.getState().isMuted;
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.timeUpdateEventInterval = 0.25;
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [failed, setFailed] = useState(false);
  const [fetchedCues, setFetchedCues] = useState<TranscriptCue[]>([]);

  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API
    player.muted = isMuted;
  }, [isMuted, player]);

  useEffect(() => {
    const subs = [
      player.addListener("timeUpdate", (payload) => {
        setCurrentTime(payload.currentTime);
        const next = player.duration;
        if (Number.isFinite(next) && next > 0) {
          setDuration(next);
        }
      }),
      player.addListener("playingChange", (payload) => {
        setPlaying(payload.isPlaying);
      }),
      player.addListener("statusChange", (payload) => {
        if (payload.status === "error") {
          setFailed(true);
        }
      }),
    ];
    player.play();
    return () => {
      for (const sub of subs) {
        sub.remove();
      }
      player.pause();
    };
  }, [player]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cookie = await authClient.getCookie();
        const vtt = await fetchCaptionsVtt(media.id, { apiBase, cookie });
        if (cancelled || !vtt) {
          return;
        }
        const parsed = parseWebVttCues(vtt);
        if (parsed.length > 0) {
          setFetchedCues(parsed);
        } else if (media.transcript) {
          setFetchedCues(
            splitTranscriptIntoTimedLines(
              media.transcript,
              player.duration || null
            )
          );
        }
      } catch {
        // Network errors leave the direct-transcript cues in place.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, media.id, media.transcript, player]);

  const directCues = useMemo(
    () => cuesFromTranscript(media.transcript),
    [media.transcript]
  );
  const cues = fetchedCues.length > 0 ? fetchedCues : directCues;
  const activeCue = captionsEnabled ? findActiveCue(cues, currentTime) : null;

  const cycleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const next = speeds[(speeds.indexOf(rate) + 1) % speeds.length] ?? 1;
    setRate(next);
    try {
      // oxlint-disable-next-line react/immutability -- expo-video's documented player API
      player.playbackRate = next;
    } catch {
      // Older runtimes ignore playbackRate; the label still updates.
    }
  };

  if (failed) {
    return (
      <View style={styles.videoFailed}>
        <Text style={styles.videoFailedText}>Couldn't load this video.</Text>
      </View>
    );
  }

  return (
    <View style={styles.videoWrap}>
      <VideoView
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls={false}
        player={player}
        ref={viewRef}
        style={styles.video}
      />
      {activeCue ? (
        <View pointerEvents="none" style={styles.captionRow}>
          <View style={styles.captionBox}>
            <Text numberOfLines={2} style={styles.captionText}>
              {activeCue.text}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={styles.videoControls}>
        <Pressable
          accessibilityLabel={playing ? "Pause video" : "Play video"}
          accessibilityRole="button"
          onPress={() => {
            if (player.playing) {
              player.pause();
              return;
            }
            player.play();
          }}
          style={[styles.playBtn, { boxShadow: ACCENT_CHIP_SHADOWS }]}
        >
          <LinearGradient
            colors={["#ff9500", "#e65500"]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={styles.playFill}
          >
            {playing ? (
              <Pause color="#ffffff" fill="#ffffff" size={20} />
            ) : (
              <Play color="#ffffff" fill="#ffffff" size={20} />
            )}
          </LinearGradient>
        </Pressable>
        <Text style={styles.videoTime}>
          {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
        </Text>
        <View style={styles.videoBtns}>
          <ChipButton
            label={isMuted ? "Unmute" : "Mute"}
            onPress={() => setMuted(!isMuted)}
          >
            {isMuted ? (
              <VolumeX color="#ffffff" size={18} />
            ) : (
              <Volume2 color="#ffffff" size={18} />
            )}
          </ChipButton>
          <ChipButton label="Playback speed" onPress={cycleSpeed}>
            <Text style={styles.speedText}>{rate}x</Text>
          </ChipButton>
          <ChipButton label="Toggle captions" onPress={onToggleCaptions}>
            <Subtitles
              color={captionsEnabled ? "#ff9500" : "#ffffff"}
              size={18}
            />
          </ChipButton>
          <ChipButton label="Transcript" onPress={onToggleTranscript}>
            <Speech color="#ffffff" size={18} />
          </ChipButton>
          <ChipButton
            label="Fullscreen"
            onPress={() => {
              void (async () => {
                try {
                  await viewRef.current?.enterFullscreen();
                } catch {
                  // Fullscreen unavailable (e.g. Expo Go); the video already
                  // fills the viewer, so this is a no-op enhancement.
                }
              })();
            }}
          >
            <Maximize color="#ffffff" size={18} />
          </ChipButton>
        </View>
      </View>
    </View>
  );
}

type MediaStatus = "error" | "loading" | "not-found" | "ready" | "unauthorized";

export function PostMediaScreen({
  initialIndex,
  postId,
}: {
  initialIndex: number;
  postId: string;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mediaId?: string }>();
  const { isPending, user } = useSessionContext();
  const viewerId = user?.id;
  const { width } = useWindowDimensions();

  const [status, setStatus] = useState<MediaStatus>("loading");
  const [post, setPost] = useState<FeedPost | null>(null);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [uiVisible, setUiVisible] = useState(true);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [showEddies, setShowEddies] = useState(false);
  const pagerRef = useRef<FlatList<FeedMedia>>(null);

  useEffect(() => {
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- media reload enters loading here; steady state is fetch-driven
    setStatus("loading");
    void (async () => {
      try {
        const apiBase = getApiBaseUrl();
        const cookie = await authClient.getCookie();
        const detail = await fetchPostDetail(postId, { apiBase, cookie });
        if (cancelled) {
          return;
        }
        // ?mediaId= (profile-gallery deep link) wins over the URL segment,
        // like web's resolveCanonicalMedia.
        let resolved = initialIndex;
        const mediaIdParam = params.mediaId;
        if (typeof mediaIdParam === "string" && mediaIdParam) {
          const found = detail.post.attachments?.findIndex(
            (entry) => entry.id === mediaIdParam
          );
          if (found !== undefined && found >= 0) {
            resolved = found;
          }
        }
        const count = detail.post.attachments?.length ?? 0;
        if (count === 0) {
          setStatus("not-found");
          return;
        }
        setPost(detail.post);
        setCurrentIndex(Math.min(resolved, count - 1));
        setStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }
        const code =
          error && typeof error === "object" && "status" in error
            ? Number((error as { status: unknown }).status)
            : 0;
        if (code === 401) {
          setStatus("unauthorized");
        } else if (code === 404) {
          setStatus("not-found");
        } else {
          setStatus("error");
        }
        logWarn("post.media_failed", {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Initial load only; index changes stay local (no remount, like web).
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- intentional media load keyed by post
  }, [postId, params.mediaId, initialIndex]);

  const apiBase = getApiBaseUrl();
  const media = useMemo(
    () => (Array.isArray(post?.attachments) ? post.attachments : []),
    [post]
  );
  const currentMedia = media[currentIndex];
  const viewerLoggedIn = Boolean(viewerId);

  const requireLogin = useCallback(() => {
    router.push("/(auth)/login");
  }, [router]);

  const handleClose = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({ params: { postId }, pathname: "/posts/[postId]" });
  }, [postId, router]);

  const goTo = useCallback(
    (index: number) => {
      if (media.length === 0) {
        return;
      }
      const next = (index + media.length) % media.length;
      setCurrentIndex(next);
      pagerRef.current?.scrollToIndex({ animated: true, index: next });
      // The route URL keeps the entry index (shareable entry point); paging
      // stays local with no remount, like web's replaceState onNavigate.
    },
    [media.length]
  );

  const author = post?.user;
  const displayName = author?.displayName || author?.username || "Anonymous";
  const username = author?.username ?? "unknown";
  const avatarUri = author?.avatarUrl
    ? resolveProfileImageUrl(author.avatarUrl, apiBase)
    : null;
  const [avatarFailed, setAvatarFailed] = useState(false);

  const transcriptCues = useMemo(() => {
    if (!currentMedia?.transcript) {
      return [];
    }
    return cuesFromTranscript(currentMedia.transcript);
  }, [currentMedia]);

  if (status === "loading") {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color="#ff9500" size="large" />
      </View>
    );
  }

  if (status === "unauthorized") {
    return (
      <View
        style={[styles.loadingRoot, { backgroundColor: theme.containerBg }]}
      >
        <Text style={[styles.stateTitle, { color: theme.inputText }]}>
          Log in to see this media
        </Text>
        <Pressable
          onPress={() => router.push("/(auth)/login")}
          style={styles.loginBtn}
        >
          <Text style={styles.loginText}>Log in</Text>
        </Pressable>
      </View>
    );
  }

  if (!post || !currentMedia || status !== "ready") {
    const missing = status === "not-found";
    return (
      <View
        style={[styles.loadingRoot, { backgroundColor: theme.containerBg }]}
      >
        <Image
          contentFit="contain"
          source={missing ? notFoundImage : errorImage}
          style={styles.stateArt}
        />
        <Text style={[styles.stateTitle, { color: theme.inputText }]}>
          {missing ? "Media not found" : "Couldn't load this media"}
        </Text>
        <Pressable
          accessibilityLabel="Back to post"
          accessibilityRole="button"
          onPress={handleClose}
          style={styles.loginBtn}
        >
          <Text style={styles.loginText}>Back to post</Text>
        </Pressable>
      </View>
    );
  }

  const renderPage = ({ item, index }: { item: FeedMedia; index: number }) => {
    const active = index === currentIndex;
    if (post.moderated) {
      return (
        <View style={[styles.page, { width }]}>
          <View style={styles.moderatedWrap}>
            <ModeratedNotice />
          </View>
        </View>
      );
    }
    const body = (() => {
      if (isVideoMedia(item)) {
        if (!active) {
          return (
            <Image
              contentFit="contain"
              source={{ uri: mediaPosterUrl(apiBase, item.id) }}
              style={styles.media}
            />
          );
        }
        return (
          <FullscreenVideo
            apiBase={apiBase}
            captionsEnabled={captionsEnabled}
            media={item}
            onToggleCaptions={() => setCaptionsEnabled((value) => !value)}
            onToggleTranscript={() => setShowTranscript((value) => !value)}
          />
        );
      }
      if (isAudioMedia(item)) {
        return (
          <View style={styles.audioWrap}>
            <AudioRow apiBase={apiBase} media={item} />
          </View>
        );
      }
      return (
        <Image
          accessibilityLabel={item.altText ?? `Media item ${index + 1}`}
          contentFit="contain"
          source={{ uri: mediaImageUrl(apiBase, item) }}
          style={styles.media}
        />
      );
    })();
    if (post.explicitContent) {
      return (
        <View style={[styles.page, { width }]}>
          <ExplicitGate
            apiBase={apiBase}
            attachments={media}
            revealKey={post.id}
          >
            {body}
          </ExplicitGate>
        </View>
      );
    }
    return <View style={[styles.page, { width }]}>{body}</View>;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        data={media}
        getItemLayout={(_, index) => ({
          index,
          length: width,
          offset: width * index,
        })}
        horizontal
        initialScrollIndex={Math.min(initialIndex, media.length - 1)}
        keyExtractor={(item) => item.id}
        onMomentumScrollEnd={(event) => {
          const next = Math.round(event.nativeEvent.contentOffset.x / width);
          if (next !== currentIndex && media[next]) {
            setCurrentIndex(next);
          }
        }}
        pagingEnabled
        ref={pagerRef}
        renderItem={renderPage}
        showsHorizontalScrollIndicator={false}
      />
      {/* Blank-area tap toggles chrome; the pager above stays interactive. */}
      <Pressable
        accessibilityLabel="Toggle viewer controls"
        onPress={() => setUiVisible((value) => !value)}
        style={styles.toggleLayer}
      />

      {uiVisible ? (
        <>
          <Pressable
            accessibilityLabel="Close viewer"
            accessibilityRole="button"
            onPress={handleClose}
            style={[styles.closeBtn, { boxShadow: DARK_CHIP_SHADOWS }]}
          >
            <LinearGradient
              colors={["#3a3f4a", "#23262e"]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={styles.chromeFill}
            >
              <X color="#ffffff" size={20} />
            </LinearGradient>
          </Pressable>
          <Pressable
            accessibilityLabel="Share this media"
            accessibilityRole="button"
            onPress={() => setShareOpen(true)}
            style={[styles.moreBtn, { boxShadow: DARK_CHIP_SHADOWS }]}
          >
            <LinearGradient
              colors={["#3a3f4a", "#23262e"]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={styles.chromeFill}
            >
              <Share2 color="#ffffff" size={18} />
            </LinearGradient>
          </Pressable>
          {media.length > 1 ? (
            <>
              <Pressable
                accessibilityLabel="Previous media"
                accessibilityRole="button"
                onPress={() => goTo(currentIndex - 1)}
                style={styles.prevBtn}
              >
                <ChevronLeft color="#ffffff" size={24} />
              </Pressable>
              <Pressable
                accessibilityLabel="Next media"
                accessibilityRole="button"
                onPress={() => goTo(currentIndex + 1)}
                style={styles.nextBtn}
              >
                <ChevronRight color="#ffffff" size={24} />
              </Pressable>
              <View style={styles.counter}>
                <Text style={styles.counterText}>
                  {currentIndex + 1} / {media.length}
                </Text>
              </View>
            </>
          ) : null}
        </>
      ) : null}

      {uiVisible ? (
        <View style={styles.panel}>
          <LinearGradient
            colors={[
              "rgba(0, 0, 0, 0)",
              "rgba(0, 0, 0, 0.7)",
              "rgba(0, 0, 0, 0.95)",
            ]}
            locations={[0, 0.4, 1]}
            style={styles.scrim}
          />
          <View
            style={[
              styles.panelBody,
              { paddingBottom: Math.max(12, insets.bottom) },
            ]}
          >
            <View style={styles.userRow}>
              <Image
                contentFit="cover"
                onError={() => setAvatarFailed(true)}
                source={
                  avatarUri && !avatarFailed
                    ? { uri: avatarUri }
                    : avatarPlaceholder
                }
                style={styles.avatar}
              />
              <View style={styles.userTitles}>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={styles.name}>
                    {displayName}
                  </Text>
                  <UserBadge
                    badge={author?.badge}
                    badges={author?.badges}
                    communityRoles={author?.communityMemberships}
                  />
                </View>
                <Text numberOfLines={1} style={styles.handle}>
                  @{username}
                </Text>
              </View>
            </View>

            {post.content ? (
              <View style={styles.contentWrap}>
                <BioContent apiBase={apiBase} bio={post.content} />
              </View>
            ) : null}

            {currentMedia.aiGenerated || currentMedia.altText ? (
              <View style={styles.badges}>
                {currentMedia.aiGenerated ? <AiBadge /> : null}
                {currentMedia.altText ? (
                  <AltBadge text={currentMedia.altText} />
                ) : null}
              </View>
            ) : null}

            <View style={styles.actions}>
              <View style={styles.actionsLeft}>
                <Pressable
                  accessibilityLabel="View eddies"
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({
                      params: { postId: post.id },
                      pathname: "/posts/[postId]",
                    })
                  }
                  style={[styles.eddiesChip, { boxShadow: DARK_CHIP_SHADOWS }]}
                >
                  <LinearGradient
                    colors={["#3a3f4a", "#23262e"]}
                    end={{ x: 0.5, y: 1 }}
                    start={{ x: 0.5, y: 0 }}
                    style={styles.eddiesFill}
                  >
                    <MessageSquare
                      color="#ffffff"
                      fill={
                        (post._count?.comments ?? 0) > 0 ? "#ffffff" : "none"
                      }
                      size={16}
                    />
                    <Text style={styles.eddiesText}>
                      {post._count?.comments ?? 0}
                    </Text>
                  </LinearGradient>
                </Pressable>
                <VoteCluster
                  aura={post.aura ?? 0}
                  onRequireLogin={requireLogin}
                  postId={post.id}
                  userVote={getUserVote(post)}
                  viewerLoggedIn={viewerLoggedIn}
                />
              </View>
              <View style={styles.actionsRight}>
                <Pressable
                  accessibilityLabel="Share this media"
                  accessibilityRole="button"
                  onPress={() => setShareOpen(true)}
                  style={styles.iconHit}
                >
                  <Share2 color="#ffffff" size={18} />
                </Pressable>
                <BookmarkToggle
                  initialBookmarked={isBookmarkedByUser(post, viewerId)}
                  onRequireLogin={requireLogin}
                  postId={post.id}
                  viewerLoggedIn={viewerLoggedIn}
                />
              </View>
            </View>
            <Text style={styles.views}>{post.viewCount ?? 0} views</Text>
          </View>
        </View>
      ) : null}

      {showEddies && !isPending ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setShowEddies(false)}
          transparent
          visible
        >
          <Pressable
            onPress={() => setShowEddies(false)}
            style={styles.sheetBackdrop}
          >
            <Pressable style={styles.sheet}>
              <ScrollView>
                <PostComments postId={post.id} viewerId={viewerId} />
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {showTranscript ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setShowTranscript(false)}
          transparent
          visible
        >
          <Pressable
            onPress={() => setShowTranscript(false)}
            style={styles.sheetBackdrop}
          >
            <Pressable style={styles.sheet}>
              <Text style={styles.sheetTitle}>Transcript</Text>
              <ScrollView style={styles.transcriptList}>
                {transcriptCues.length === 0 ? (
                  <Text style={styles.transcriptEmpty}>
                    No transcript for this video.
                  </Text>
                ) : (
                  transcriptCues.map((cue, index) => (
                    <Text key={index} style={styles.transcriptLine}>
                      {cue.text}
                    </Text>
                  ))
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      <ShareSheet
        onClose={() => setShareOpen(false)}
        post={shareOpen ? post : null}
      />
      {isPending ? null : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    borderTopColor: "rgba(255, 255, 255, 0.1)",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
  },
  actionsLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  actionsRight: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  aiBadge: {
    borderRadius: 9999,
  },
  aiGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    height: 24,
    paddingHorizontal: 10,
  },
  aiText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
  altBadge: {
    borderRadius: 12,
    flex: 1,
    minWidth: 0,
  },
  altGradient: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  altKind: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
  altText: {
    color: "#ffffff",
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 10,
    fontWeight: "normal",
    minWidth: 0,
  },
  audioWrap: {
    paddingHorizontal: 16,
    width: "100%",
  },
  avatar: {
    borderRadius: 9999,
    height: 40,
    width: 40,
  },
  badges: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  captionBox: {
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  captionRow: {
    alignItems: "center",
    bottom: 96,
    left: 12,
    paddingHorizontal: 8,
    position: "absolute",
    right: 12,
  },
  captionText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    lineHeight: 15,
    textAlign: "center",
  },
  chip: {
    borderRadius: 9999,
    height: 44,
    width: 44,
  },
  chipFill: {
    alignItems: "center",
    borderRadius: 9999,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  chromeFill: {
    alignItems: "center",
    borderRadius: 9999,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  closeBtn: {
    borderRadius: 9999,
    left: 12,
    position: "absolute",
    top: 12,
    zIndex: 30,
  },
  contentWrap: {
    marginTop: 10,
  },
  counter: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: 9999,
    left: "50%",
    paddingHorizontal: 12,
    paddingVertical: 4,
    position: "absolute",
    top: 16,
    transform: [{ translateX: -30 }],
    zIndex: 30,
  },
  counterText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontWeight: "normal",
  },
  eddiesChip: {
    borderRadius: 9999,
    height: 44,
  },
  eddiesFill: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
  },
  eddiesText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  handle: {
    color: "rgba(255, 255, 255, 0.7)",
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
  },
  iconHit: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  loadingRoot: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  loginBtn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  loginText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  media: {
    height: "100%",
    width: "100%",
  },
  moderatedWrap: {
    paddingHorizontal: 24,
    width: "100%",
  },
  moreBtn: {
    borderRadius: 9999,
    position: "absolute",
    right: 12,
    top: 12,
    zIndex: 30,
  },
  name: {
    color: "#ffffff",
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 15,
    fontWeight: "normal",
    minWidth: 0,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  nextBtn: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: 9999,
    padding: 10,
    position: "absolute",
    right: 12,
    top: "50%",
    zIndex: 30,
  },
  page: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  panel: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 20,
  },
  panelBody: {
    paddingHorizontal: 12,
    paddingTop: 64,
  },
  playBtn: {
    borderRadius: 9999,
    height: 48,
    width: 48,
  },
  playFill: {
    alignItems: "center",
    borderRadius: 9999,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  prevBtn: {
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: 9999,
    left: 12,
    padding: 10,
    position: "absolute",
    top: "50%",
    zIndex: 30,
  },
  root: {
    backgroundColor: "#000000",
    flex: 1,
  },
  scrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: "#171717",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    padding: 16,
  },
  sheetBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetTitle: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
    marginBottom: 12,
  },
  speedText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
  },
  stateArt: {
    height: 160,
    width: "100%",
  },
  stateTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 16,
    fontWeight: "normal",
    textAlign: "center",
  },
  toggleLayer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  transcriptEmpty: {
    color: "rgba(255, 255, 255, 0.6)",
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
  },
  transcriptLine: {
    color: "#ffffff",
    fontFamily: "SofiaProReg",
    fontSize: 14,
    fontWeight: "normal",
    marginBottom: 8,
  },
  transcriptList: {
    maxHeight: 320,
  },
  userRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  userTitles: {
    flex: 1,
    minWidth: 0,
  },
  video: {
    height: 320,
    width: "100%",
  },
  videoBtns: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  videoControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginTop: 12,
    width: "100%",
  },
  videoFailed: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  videoFailedText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 14,
    fontWeight: "normal",
  },
  videoTime: {
    color: "#ffffff",
    flex: 1,
    fontFamily: "SofiaProMed",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "normal",
    minWidth: 0,
  },
  videoWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  views: {
    color: "rgba(255, 255, 255, 0.6)",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 8,
  },
});
