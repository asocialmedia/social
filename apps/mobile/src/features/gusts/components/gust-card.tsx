import { useEvent, useEventListener } from "expo";
// One full-screen gust, a 1:1 port of web's gust-card.tsx at phone size:
// the video (object-contain on black, looping, poster until the first
// frame), the tap target (single tap toggles playback after 280ms, a double
// tap amplifies with a flame burst), the bottom scrim and info block
// (AI badge, author row with Follow, clamped caption with More, meta chips,
// alt text, views), the right rail (amplify + aura, mute author, eddies,
// share, bookmark, more, sound), the seek line, the live caption, the
// buffering spinner, the explicit gate and the transcript drawer.
//
// Playback follows the pager: only the active card plays, a card leaving
// the window pauses and rewinds, the app going to background pauses and
// coming back resumes only if it was playing. Only active +- 1 mounts a
// player at all (the source is null otherwise).
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  ArrowBigDown,
  ArrowBigUp,
  Bookmark,
  Eye,
  Flame,
  MessageSquare,
  MoreHorizontal,
  Share2,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";

import avatarPlaceholder from "@/assets/images/avatar-placeholder.png";
import { Spinner3D } from "@/components/feedback/spinner-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import { subscribeEddieCreated } from "@/features/eddies/lib/eddie-events";
import type { MenuAnchor } from "@/features/feed/components/more-menu";
import {
  isExplicitRevealed,
  markExplicitRevealed,
} from "@/features/feed/components/post-media";
import { fetchCaptionsVtt } from "@/features/feed/lib/feed-api";
import type { FeedPost } from "@/features/feed/lib/feed-types";
import { extractInlineMeta } from "@/features/feed/lib/feed-types";
import { mediaPosterUrl } from "@/features/feed/lib/media-url";
import {
  cuesFromTranscript,
  findActiveCue,
  parseWebVttCues,
  splitTranscriptIntoTimedLines,
} from "@/features/feed/lib/transcript-cues";
import type { TranscriptCue } from "@/features/feed/lib/transcript-cues";
import {
  BioContent,
  MentionChip,
  TagChip,
} from "@/features/home/components/bio-content";
import {
  formatNumber,
  getAuraFlameStyle,
  resolveProfileImageUrl,
} from "@/features/home/components/profile-utils";
import { UserBadge } from "@/features/home/components/user-badge";
import { logInfo, logWarn } from "@/lib/telemetry";

import { gustVideo, gustVideoUrl } from "../lib/gusts-api";
import {
  addBurst,
  BURST_CLEAR_MS,
  captionNeedsToggle,
  classifyTap,
  DOUBLE_TAP_MS,
} from "../lib/reel-gestures";
import type { FlameBurst } from "../lib/reel-gestures";
import { useGustMuteStore } from "../state/gust-mute-store";
import {
  useGustBookmark,
  useGustFollow,
  useGustVote,
} from "../state/use-gust-actions";
import { FollowButton } from "./follow-button";
import {
  FlameBurstView,
  GustExplicitGate,
  LiveCaption,
  PlayPulse,
  SeekBar,
} from "./gust-overlays";
import { RAIL_ICON_COLOR, RailButton } from "./rail-button";
import { TranscriptDrawer } from "./transcript-drawer";

// text-primary, hsl(22.93 92.59% 52.35%).
const PRIMARY = "#f66b15";
// Three lines of text-xs leading-relaxed (12px x 1.625).
const CAPTION_LINE = 19.5;
const CAPTION_CLAMP_HEIGHT = CAPTION_LINE * 3;
const AI_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.25)";

export interface GustCardProps {
  apiBase: string;
  captionsOn: boolean;
  isActive: boolean;
  mountVideo: boolean;
  onCloseTranscript: () => void;
  onMore: (post: FeedPost, anchor: MenuAnchor) => void;
  onOpenEddies: (post: FeedPost) => void;
  onShare: (post: FeedPost) => void;
  post: FeedPost;
  showAlt: boolean;
  // The screen lost focus (another route on top): hold playback without
  // rewinding, so coming back resumes where it was.
  suspended: boolean;
  onToggleAlt: () => void;
  transcriptOpen: boolean;
  viewerId: string | null;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GustCard({
  apiBase,
  captionsOn,
  isActive,
  mountVideo,
  onCloseTranscript,
  onMore,
  onOpenEddies,
  onShare,
  onToggleAlt,
  post,
  showAlt,
  suspended,
  transcriptOpen,
  viewerId,
}: GustCardProps) {
  const video = gustVideo(post);
  const source = mountVideo && video ? gustVideoUrl(apiBase, video.id) : null;
  const isMuted = useGustMuteStore((state) => state.isMuted);
  const toggleMuted = useGustMuteStore((state) => state.toggleMuted);
  const player = useVideoPlayer(source, (created) => {
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.loop = true;
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.muted = useGustMuteStore.getState().isMuted;
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.timeUpdateEventInterval = 0.25;
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // The source whose first frame is on screen; the poster covers until then.
  const [frameSource, setFrameSource] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(
    () => !post.explicitContent || isExplicitRevealed(post.id)
  );
  const [appActive, setAppActive] = useState(
    () => AppState.currentState === "active"
  );
  const [pulse, setPulse] = useState<{
    icon: "pause" | "play";
    id: number;
  } | null>(null);
  const [bursts, setBursts] = useState<FlameBurst[]>([]);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [eddieCount, setEddieCount] = useState(post._count?.comments ?? 0);
  const [fetchedCues, setFetchedCues] = useState<TranscriptCue[] | null>(null);
  const [cuesLoading, setCuesLoading] = useState(false);
  // A tap pause holds while the card stays active; leaving clears it.
  const userPausedRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const lastTapRef = useRef<number | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstIdRef = useRef(0);
  const moreRef = useRef<View>(null);

  const vote = useGustVote(post, viewerId, isActive);
  const bookmark = useGustBookmark(post, viewerId, isActive);
  const follow = useGustFollow(post, viewerId);

  const posterUri = video ? mediaPosterUrl(apiBase, video.id) : null;
  const hasFrame = source !== null && frameSource === source;

  useEventListener(player, "timeUpdate", (payload) => {
    setCurrentTime(payload.currentTime);
    const next = player.duration;
    if (Number.isFinite(next) && next > 0) {
      setDuration((previous) => (previous === next ? previous : next));
    }
  });
  useEventListener(player, "sourceLoad", (payload) => {
    if (Number.isFinite(payload.duration) && payload.duration > 0) {
      setDuration(payload.duration);
    }
  });
  useEventListener(player, "statusChange", (payload) => {
    if (payload.status === "error") {
      logWarn("gusts.playback_failed", {
        reason: payload.error?.message ?? "unknown",
      });
    }
  });

  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    player.muted = isMuted;
  }, [isMuted, player]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
    });
    return () => subscription.remove();
  }, []);

  // Web's autoplay gate. Active + revealed + foreground plays (unless the
  // viewer paused it); anything else holds. Leaving the window rewinds.
  useEffect(() => {
    if (!source) {
      return;
    }
    if (!isActive) {
      userPausedRef.current = false;
      player.pause();
      // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
      player.currentTime = 0;
      return;
    }
    if (!appActive || suspended) {
      if (player.playing) {
        wasPlayingRef.current = true;
      }
      player.pause();
      return;
    }
    const resume = wasPlayingRef.current;
    wasPlayingRef.current = false;
    if (revealed && (!userPausedRef.current || resume)) {
      userPausedRef.current = false;
      player.play();
    }
  }, [appActive, isActive, player, revealed, source, suspended]);

  // Inactive cards drop their progress, like web's render-phase reset.
  useEffect(() => {
    if (!isActive) {
      // oxlint-disable-next-line react/set-state-in-effect -- leaving the active slot resets the seek line and caption clamp
      setCurrentTime(0);
      // oxlint-disable-next-line react/set-state-in-effect -- same reset as above
      setCaptionExpanded(false);
    }
  }, [isActive]);

  useEffect(
    () =>
      subscribeEddieCreated(post.id, () => {
        setEddieCount((count) => count + 1);
      }),
    [post.id]
  );

  useEffect(
    () => () => {
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
      }
      if (burstClearTimer.current) {
        clearTimeout(burstClearTimer.current);
      }
    },
    []
  );

  // Cues load when captions or the transcript need them, only for the
  // active card: the stored WebVTT track, else the transcript spread over
  // the clip.
  const wantsCues =
    isActive && video !== undefined && (captionsOn || transcriptOpen);
  useEffect(() => {
    if (!wantsCues || fetchedCues !== null || !video) {
      return;
    }
    let cancelled = false;
    // oxlint-disable-next-line react/set-state-in-effect -- the transcript drawer shows its spinner while the track loads
    setCuesLoading(true);
    void (async () => {
      try {
        const vtt = await fetchCaptionsVtt(video.id, {
          apiBase,
          cookie: await authClient.getCookie(),
        });
        if (cancelled) {
          return;
        }
        const parsed = vtt ? parseWebVttCues(vtt) : [];
        setFetchedCues(
          parsed.length > 0
            ? parsed
            : splitTranscriptIntoTimedLines(
                video.transcript ?? "",
                player.duration || null
              )
        );
      } catch (error) {
        logWarn("gusts.captions_failed", { reason: reason(error) });
        if (!cancelled) {
          setFetchedCues([]);
        }
      }
      if (!cancelled) {
        setCuesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, fetchedCues, player, video, wantsCues]);

  const directCues = useMemo(
    () => cuesFromTranscript(video?.transcript),
    [video?.transcript]
  );
  const cues =
    fetchedCues !== null && fetchedCues.length > 0 ? fetchedCues : directCues;
  const activeCue =
    captionsOn && isActive && source ? findActiveCue(cues, currentTime) : null;

  const togglePlay = () => {
    if (!source || !revealed) {
      return;
    }
    if (player.playing) {
      userPausedRef.current = true;
      player.pause();
      setPulse({ icon: "pause", id: Date.now() });
      return;
    }
    userPausedRef.current = false;
    player.play();
    setPulse({ icon: "play", id: Date.now() });
  };

  const spawnBurst = (x: number, y: number) => {
    burstIdRef.current += 1;
    const id = burstIdRef.current;
    setBursts((current) => addBurst(current, { id, x, y }));
    if (burstClearTimer.current) {
      clearTimeout(burstClearTimer.current);
    }
    burstClearTimer.current = setTimeout(() => {
      burstClearTimer.current = null;
      setBursts([]);
    }, BURST_CLEAR_MS);
  };

  const handleTap = (event: GestureResponderEvent) => {
    const now = Date.now();
    const { locationX, locationY } = event.nativeEvent;
    if (classifyTap(now, lastTapRef.current) === "double") {
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      lastTapRef.current = null;
      vote.amplify();
      spawnBurst(locationX, locationY);
      return;
    }
    lastTapRef.current = now;
    if (singleTapTimer.current) {
      clearTimeout(singleTapTimer.current);
    }
    singleTapTimer.current = setTimeout(() => {
      singleTapTimer.current = null;
      togglePlay();
    }, DOUBLE_TAP_MS);
  };

  const seek = (seconds: number) => {
    if (!source) {
      return;
    }
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    player.currentTime = seconds;
    setCurrentTime(seconds);
  };

  const continueExplicit = () => {
    markExplicitRevealed(post.id);
    setRevealed(true);
    logInfo("gusts.explicit_revealed", {});
  };

  const { user } = post;
  const name = user?.displayName || user?.username || "Unknown";
  const avatarUri = user?.avatarUrl
    ? resolveProfileImageUrl(user.avatarUrl, apiBase)
    : null;
  const content = post.content?.trim() ?? "";
  const inline = extractInlineMeta(content);
  const extraTags = (post.tags ?? []).filter(
    (tag) => !inline.tags.has(tag.name.toLowerCase())
  );
  const extraMentions = (post.mentions ?? []).filter(
    (mention) =>
      mention.user.username &&
      !inline.usernames.has(mention.user.username.toLowerCase())
  );
  const altText = (post.attachments ?? []).find(
    (media) => media?.altText
  )?.altText;
  const aiGenerated = (post.attachments ?? []).some(
    (media) => media?.aiGenerated
  );
  const needsToggle = captionNeedsToggle(content);
  const flame = getAuraFlameStyle(vote.aura);
  const progress = duration > 0 ? currentTime / duration : 0;
  const showBuffering =
    isActive && revealed && source !== null && status === "loading";

  return (
    <View style={styles.card}>
      {source ? (
        <VideoView
          contentFit="contain"
          nativeControls={false}
          onFirstFrameRender={() => setFrameSource(source)}
          player={player}
          pointerEvents="none"
          style={styles.fill}
          surfaceType="textureView"
        />
      ) : null}
      {hasFrame || !posterUri ? null : (
        <Image
          accessibilityLabel=""
          contentFit="contain"
          source={{ uri: posterUri }}
          style={[styles.fill, styles.poster]}
        />
      )}

      <Pressable
        accessibilityHint="Double tap to amplify"
        accessibilityLabel={isPlaying ? "Pause gust" : "Play gust"}
        onPress={handleTap}
        style={styles.fill}
      />

      {pulse ? (
        <PlayPulse
          icon={pulse.icon}
          key={pulse.id}
          onDone={() => setPulse(null)}
        />
      ) : null}
      {showBuffering ? (
        <View pointerEvents="none" style={styles.center}>
          <Spinner3D size={48} />
        </View>
      ) : null}
      {bursts.map((burst) => (
        <FlameBurstView burst={burst} key={burst.id} />
      ))}
      {activeCue ? (
        <LiveCaption key={`${activeCue.start}`} text={activeCue.text} />
      ) : null}
      {revealed ? null : (
        <GustExplicitGate onContinue={continueExplicit} posterUri={posterUri} />
      )}

      <LinearGradient
        colors={[
          "rgba(0, 0, 0, 0)",
          "rgba(0, 0, 0, 0.35)",
          "rgba(0, 0, 0, 0.85)",
        ]}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={styles.scrim}
      />

      <View pointerEvents="box-none" style={styles.info}>
        {aiGenerated ? (
          <View style={styles.aiRow}>
            <View
              accessibilityLabel="AI-generated content"
              style={[styles.aiBadge, { boxShadow: AI_BADGE_SHADOWS }]}
            >
              <LinearGradient
                colors={["#7c5cff", "#5a3ae0"]}
                end={{ x: 0.5, y: 1 }}
                start={{ x: 0.5, y: 0 }}
                style={styles.aiFill}
              >
                <Sparkles color="#ffffff" size={12} />
                <Text style={styles.aiText}>AI Generated</Text>
              </LinearGradient>
            </View>
          </View>
        ) : null}

        <View style={styles.authorRow}>
          <Image
            accessibilityLabel={`${name}'s avatar`}
            contentFit="cover"
            source={avatarUri ? { uri: avatarUri } : avatarPlaceholder}
            style={styles.avatar}
          />
          <View style={styles.authorCopy}>
            <View style={styles.nameRow}>
              <Text numberOfLines={1} style={styles.name}>
                {name}
              </Text>
              <UserBadge
                badge={user?.badge ?? null}
                badges={user?.badges ?? null}
                communityRoles={user?.communityMemberships ?? null}
              />
              {follow.visible ? (
                <FollowButton
                  following={follow.following}
                  onPress={() => follow.toggle()}
                  pending={follow.pending}
                />
              ) : null}
            </View>
            {user?.username ? (
              <Text numberOfLines={1} style={styles.handle}>
                @{user.username}
              </Text>
            ) : null}
          </View>
        </View>

        {content ? (
          <View style={styles.captionWrap}>
            <View
              style={
                needsToggle && !captionExpanded ? styles.captionClamp : null
              }
            >
              <BioContent
                apiBase={apiBase}
                bio={content}
                textColor="rgba(255, 255, 255, 0.95)"
                textSize={{ fontSize: 12, lineHeight: CAPTION_LINE }}
              />
            </View>
            {needsToggle ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => setCaptionExpanded((value) => !value)}
              >
                <Text style={styles.toggleText}>
                  {captionExpanded ? "Show less" : "More"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {extraTags.length > 0 || extraMentions.length > 0 ? (
          <View style={styles.metaRow}>
            {extraTags.map((tag) => (
              <TagChip key={tag.id} tag={tag.name} />
            ))}
            {extraMentions.map((mention) => (
              <MentionChip
                avatarUrl={
                  mention.user.avatarUrl
                    ? resolveProfileImageUrl(mention.user.avatarUrl, apiBase)
                    : null
                }
                key={mention.user.id}
                username={mention.user.username ?? ""}
              />
            ))}
          </View>
        ) : null}

        {altText ? (
          <View>
            <Pressable
              accessibilityRole="button"
              hitSlop={6}
              onPress={onToggleAlt}
            >
              <Text style={styles.toggleText}>
                {showAlt ? "Hide alt" : "Show alt"}
              </Text>
            </Pressable>
            {showAlt ? (
              <View style={styles.altPanel}>
                <Text style={styles.altText}>{altText}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.viewsRow}>
          <Eye color="rgba(255, 255, 255, 0.85)" size={16} />
          <Text style={styles.views}>
            {formatNumber(post.viewCount ?? 0)}
            <Text style={styles.viewsLabel}> views</Text>
          </Text>
        </View>
      </View>

      <View pointerEvents="box-none" style={styles.rail}>
        <View style={styles.railItem}>
          <RailButton
            accessibilityLabel={
              vote.userVote === 1 ? "Remove amplification" : "Amplify gust"
            }
            active={vote.userVote === 1}
            onPress={() => vote.toggleVote(1)}
            tone="orange"
          >
            <ArrowBigUp
              color={RAIL_ICON_COLOR}
              fill={vote.userVote === 1 ? "#ffffff" : "none"}
              size={20}
            />
          </RailButton>
          <View style={styles.auraRow}>
            <Flame
              color={flame.color}
              fill={flame.filled ? flame.color : "none"}
              size={20}
            />
            <Text style={styles.auraText}>{formatNumber(vote.aura)}</Text>
          </View>
        </View>
        <RailButton
          accessibilityLabel={
            vote.userVote === -1 ? "Remove mute" : "Mute author's gust"
          }
          active={vote.userVote === -1}
          onPress={() => vote.toggleVote(-1)}
          tone="purple"
        >
          <ArrowBigDown
            color={RAIL_ICON_COLOR}
            fill={vote.userVote === -1 ? "#ffffff" : "none"}
            size={20}
          />
        </RailButton>
        <View style={styles.railItem}>
          <RailButton
            accessibilityLabel="Open eddies"
            onPress={() => onOpenEddies(post)}
          >
            <MessageSquare
              color={RAIL_ICON_COLOR}
              fill={eddieCount > 0 ? RAIL_ICON_COLOR : "none"}
              size={20}
            />
          </RailButton>
          <Text style={styles.countText}>{formatNumber(eddieCount)}</Text>
        </View>
        <RailButton
          accessibilityLabel="Share gust"
          onPress={() => onShare(post)}
        >
          <Share2 color={RAIL_ICON_COLOR} size={16} />
        </RailButton>
        <RailButton
          accessibilityLabel={
            bookmark.bookmarked ? "Remove bookmark" : "Bookmark gust"
          }
          active={bookmark.bookmarked}
          onPress={() => bookmark.toggle()}
          tone="gold"
        >
          <Bookmark
            color={RAIL_ICON_COLOR}
            fill={bookmark.bookmarked ? "#ffffff" : "none"}
            size={16}
          />
        </RailButton>
        <View collapsable={false} ref={moreRef}>
          <RailButton
            accessibilityLabel="Gust options"
            onPress={() => {
              moreRef.current?.measureInWindow((x, y, width, height) => {
                onMore(post, { height, width, x, y });
              });
            }}
          >
            <MoreHorizontal color={RAIL_ICON_COLOR} size={16} />
          </RailButton>
        </View>
        <RailButton
          accessibilityLabel={isMuted ? "Unmute video" : "Mute video"}
          onPress={toggleMuted}
        >
          {isMuted ? (
            <VolumeX color={RAIL_ICON_COLOR} size={20} />
          ) : (
            <Volume2 color={RAIL_ICON_COLOR} size={20} />
          )}
        </RailButton>
      </View>

      <SeekBar duration={duration} onSeek={seek} progress={progress} />

      {transcriptOpen && isActive ? (
        <TranscriptDrawer
          cues={cues}
          currentTime={currentTime}
          loading={cuesLoading && fetchedCues === null}
          onClose={onCloseTranscript}
          onSeek={(seconds) => {
            seek(seconds);
            userPausedRef.current = false;
            player.play();
          }}
          rawTranscript={video?.transcript}
        />
      ) : null}
    </View>
  );
}

const TEXT_SHADOW = {
  textShadowColor: "rgba(0, 0, 0, 0.45)",
  textShadowOffset: { height: 1, width: 0 },
  textShadowRadius: 3,
} as const;

const styles = StyleSheet.create({
  aiBadge: {
    borderRadius: 9999,
    height: 24,
    overflow: "hidden",
  },
  aiFill: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    height: 24,
    paddingHorizontal: 8,
  },
  aiRow: {
    flexDirection: "row",
  },
  aiText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
  },
  altPanel: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 8,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  altText: {
    color: "rgba(255, 255, 255, 0.9)",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  auraRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  auraText: {
    ...TEXT_SHADOW,
    color: PRIMARY,
    fontFamily: "SofiaProBold",
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "normal",
  },
  authorCopy: {
    flexShrink: 1,
  },
  authorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    borderColor: "rgba(255, 255, 255, 0.6)",
    borderRadius: 12,
    borderWidth: 2,
    height: 40,
    width: 40,
  },
  captionClamp: {
    maxHeight: CAPTION_CLAMP_HEIGHT,
    overflow: "hidden",
  },
  captionWrap: {
    maxWidth: "78%",
  },
  card: {
    backgroundColor: "#000000",
    flex: 1,
    overflow: "hidden",
  },
  center: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  countText: {
    ...TEXT_SHADOW,
    color: "rgba(255, 255, 255, 0.9)",
    fontFamily: "SofiaProBold",
    fontSize: 11,
    fontWeight: "normal",
  },
  fill: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  handle: {
    ...TEXT_SHADOW,
    color: "rgba(255, 255, 255, 0.8)",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
  },
  info: {
    bottom: 0,
    gap: 12,
    left: 0,
    paddingBottom: 32,
    paddingLeft: 16,
    paddingRight: 96,
    position: "absolute",
    right: 0,
    zIndex: 20,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: -2,
  },
  name: {
    ...TEXT_SHADOW,
    color: "#ffffff",
    flexShrink: 1,
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  poster: {
    backgroundColor: "#000000",
  },
  rail: {
    alignItems: "center",
    bottom: 96,
    gap: 16,
    position: "absolute",
    right: 12,
    zIndex: 20,
  },
  railItem: {
    alignItems: "center",
    gap: 4,
  },
  scrim: {
    bottom: 0,
    height: 224,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 10,
  },
  toggleText: {
    color: "rgba(255, 255, 255, 0.8)",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
    marginTop: 2,
  },
  views: {
    ...TEXT_SHADOW,
    color: "rgba(255, 255, 255, 0.85)",
    fontFamily: "SofiaProBold",
    fontSize: 12,
    fontWeight: "normal",
  },
  viewsLabel: {
    color: "rgba(255, 255, 255, 0.6)",
  },
  viewsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
});
