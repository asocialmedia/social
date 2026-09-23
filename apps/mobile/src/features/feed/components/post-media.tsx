import { useEvent, useEventListener } from "expo";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
// Post media gallery: single / 2-grid / 3-5 bento / 6+ overflow layouts,
// video tap-to-play, audio rows, the explicit-content gate and the moderated
// notice. Mirrors web's MediaPreviews + ExplicitContentGate arrangement.
// Image tiles open the fullscreen viewer when onPressMedia is set (the post
// detail screen passes it; the feed passes none, so feed tiles stay put).
// Videos keep tap-to-play (the tap drives playback, never navigation) and
// detail-only autoplay/captions stay out.
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  Pause,
  Play,
  ShieldAlert,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ViewStyle } from "react-native";

import noMediaImage from "@/assets/images/nomedia.png";
import nosearchImage from "@/assets/images/nosearch.png";
import { Gradient3D } from "@/components/surface/gradient-3d";
import { authClient } from "@/features/auth/lib/auth-client";
import {
  APPLE_PANEL_SHADOWS,
  APPLE_PANEL_SHADOWS_DARK,
  LOGIN_BUTTON_PRESSED_SHADOWS,
  LOGIN_BUTTON_PRESSED_SHADOWS_LIGHT,
  LOGIN_BUTTON_SHADOWS,
  LOGIN_BUTTON_SHADOWS_LIGHT,
  useAppTheme,
} from "@/theme";

import { fetchCaptionsVtt, fetchWavePeaks } from "../lib/feed-api";
import type { FeedMedia } from "../lib/feed-types";
import {
  formatFileName,
  isAudioMedia,
  isVideoMedia,
  mediaAudioUrl,
  mediaGridImageUrl,
  mediaImageUrl,
  mediaPosterUrl,
  mediaVideoUrl,
} from "../lib/media-url";
import {
  cuesFromTranscript,
  findActiveCue,
  parseWebVttCues,
  splitTranscriptIntoTimedLines,
} from "../lib/transcript-cues";
import type { TranscriptCue } from "../lib/transcript-cues";
import {
  isAutoplayPost,
  subscribeAutoplayPost,
  subscribePostVisibility,
} from "../lib/visible-posts";
import {
  EQ_BAR_COUNT,
  EQ_FALLBACK_HEIGHTS,
  EQ_PERIOD_MS,
  eqBarInterpolation,
  shapeWaveform,
} from "../lib/waveform";
import { useVideoCaptionsStore } from "../state/video-captions-store";
import { useVideoMuteStore } from "../state/video-mute-store";

interface GalleryProps {
  // Whether the containing screen/tab is on screen. A backgrounded feed (a
  // mounted-but-inactive home tab) passes false so its lone-video autoplay
  // stops; everything else leaves it unset (treated as active).
  active?: boolean;
  apiBase: string;
  attachments: FeedMedia[];
  // Opens the fullscreen media viewer at the tapped image index. Optional:
  // surfaces without a viewer route (the home feed) leave it unset and
  // image tiles render static, exactly as before.
  onPressMedia?: (index: number) => void;
  postId: string;
}

function useFailedImages() {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  return {
    failed,
    markFailed: (id: string) =>
      setFailed((current) => {
        if (current.has(id)) {
          return current;
        }
        return new Set([...current, id]);
      }),
  };
}

function SingleImage({
  apiBase,
  index = 0,
  media,
  onFailed,
  onPressMedia,
}: {
  apiBase: string;
  index?: number;
  media: FeedMedia;
  onFailed: (id: string) => void;
  onPressMedia?: (index: number) => void;
}) {
  const stored =
    media.width && media.height && media.height > 0
      ? { h: media.height, w: media.width }
      : null;
  // Web measures the natural size when stored dims are missing; without it
  // a portrait lands in a landscape frame and `contain` centers it with
  // square corners. The measured size keeps the frame hugging the picture.
  const [natural, setNatural] = useState<{ h: number; w: number } | null>(null);
  const dims = natural ?? stored;
  const ratio = dims && dims.h > 0 ? dims.w / dims.h : 4 / 3;
  // Portraits pin left at natural proportions (web w-fit); squares count as
  // portrait, like web's h >= w rule. Both cap at the feed max height. The
  // frame is transparent: it hugs the picture, so there is no surround fill.
  const portrait = ratio <= 1;
  const { isDark } = useAppTheme();
  const frame = (
    <View
      style={[
        styles.singleWrap,
        { boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS },
        portrait && styles.singleLeft,
      ]}
    >
      <Image
        accessibilityLabel={media.altText ?? "Post image"}
        contentFit="contain"
        onError={() => onFailed(media.id)}
        onLoad={(event) => {
          const { source } = event;
          if (source?.width > 0 && source?.height > 0) {
            setNatural({ h: source.height, w: source.width });
          }
        }}
        source={{ uri: mediaImageUrl(apiBase, media) }}
        style={
          portrait
            ? [styles.singlePortrait, { aspectRatio: ratio }]
            : [styles.single, { aspectRatio: ratio }]
        }
      />
      {media.aiGenerated ? <AiBadge /> : null}
    </View>
  );
  if (!onPressMedia) {
    return frame;
  }
  return (
    <Pressable
      accessibilityLabel={media.altText ?? "Open post media"}
      accessibilityRole="link"
      onPress={() => onPressMedia(index)}
    >
      {frame}
    </Pressable>
  );
}

function GridImage({
  apiBase,
  index = 0,
  media,
  onFailed,
  onPressMedia,
}: {
  apiBase: string;
  index?: number;
  media: FeedMedia;
  onFailed: (id: string) => void;
  onPressMedia?: (index: number) => void;
}) {
  const { isDark } = useAppTheme();
  const frameStyle = [
    styles.gridTileWrap,
    { boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS },
  ];
  const content = (
    <>
      <Image
        accessibilityLabel={media.altText ?? "Post image"}
        contentFit="cover"
        onError={() => onFailed(media.id)}
        source={{ uri: mediaGridImageUrl(apiBase, media) }}
        style={styles.gridTileImage}
      />
      {media.aiGenerated ? <AiBadge /> : null}
    </>
  );
  if (!onPressMedia) {
    return <View style={frameStyle}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityLabel={media.altText ?? "Open post media"}
      accessibilityRole="link"
      onPress={() => onPressMedia(index)}
      style={frameStyle}
    >
      {content}
    </Pressable>
  );
}

function formatMediaTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "0:00";
  }
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Web VideoPreview's pills: the dark 3D mute/time surfaces, the orange
// top-right play badge (with the dark-orange ring) and the bottom-right
// play/pause toggle (no ring, deeper drop).
const DARK_PILL_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 2px 6px rgba(0, 0, 0, 0.35)";
const PLAY_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";
const PLAY_TOGGLE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.25)";

// Web's `shadow-xs` on single/grid media frames.
const FRAME_SHADOWS = "0 1px 2px rgba(0, 0, 0, 0.05)";
const FRAME_SHADOWS_DARK = "0 1px 2px rgba(0, 0, 0, 0.25)";

// AI badge: web's violet dual-border 3D (same recipe as the mute-active
// vote button), reserved for special labels.
const AI_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.25)";
const AI_BADGE_SHADOWS_DARK = AI_BADGE_SHADOWS;

// Web's poster reveal: opacity over 500ms on cubic-bezier(0.16, 1, 0.3, 1);
// the top-right badge follows the CSS default `ease` over 300ms.
const POSTER_FADE = Easing.bezier(0.16, 1, 0.3, 1);
const CSS_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);

// AI-generated marker over media surfaces, ported from web's
// AiGeneratedBadge: violet 3D pill, bottom-left of the frame (lifted above
// the mute pill on video tiles). The flag arrives on Media.aiGenerated.
function AiBadge({ bottom = 8 }: { bottom?: number }) {
  const { isDark } = useAppTheme();
  return (
    <View
      accessibilityLabel="AI-generated content"
      accessibilityRole="text"
      pointerEvents="none"
      style={[
        styles.aiBadge,
        {
          bottom,
          boxShadow: isDark ? AI_BADGE_SHADOWS_DARK : AI_BADGE_SHADOWS,
        },
      ]}
    >
      <LinearGradient
        colors={["#7c5cff", "#5a3ae0"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.aiGradient}
      >
        <Sparkles color="#ffffff" size={12} />
        <Text style={styles.aiText}>AI Generated</Text>
      </LinearGradient>
    </View>
  );
}

// Animates one value toward 1 while `on`, back to 0 when not.
function useFade(on: boolean, duration: number, easing: (t: number) => number) {
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [value] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    const fade = Animated.timing(value, {
      duration,
      easing,
      toValue: on ? 1 : 0,
      useNativeDriver: true,
    });
    fade.start();
    return () => {
      fade.stop();
    };
  }, [duration, easing, on, value]);
  return value;
}

// 1:1 port of web's feed VideoPreview (media-previews.tsx). The native
// player chrome is off: the tile is the poster that cross-fades into the
// playing video, the orange play badge top-right until playback shows, the
// dark 3D mute pill bottom-left, the orange play/pause toggle bottom-right
// with the time pill above it, the AI badge above the mute pill, timed
// captions, and the soft bottom scrim. Mute is the shared session
// preference. Web's tile opens the post page on tap and plays on hover;
// native has neither, so a lone video autoplays muted in the viewport (web's
// autoPlay arrangement, all pills visible) and a tap toggles playback.
function VideoTile({
  apiBase,
  autoPlayEnabled,
  media,
  postId,
  tile,
}: {
  apiBase: string;
  // Only a lone video autoplays in the viewport; grid tiles stay
  // tap-to-play so a multi-video post does not blast them all at once.
  autoPlayEnabled?: boolean;
  media: FeedMedia;
  postId: string;
  // Inside a grid cell the tile forces the frame; a lone video keeps its
  // natural aspect and the larger feed radius, like web's single preview.
  tile?: boolean;
}) {
  const { isDark } = useAppTheme();
  const isMuted = useVideoMuteStore((state) => state.isMuted);
  // Shared captions preference, toggled from the post's More menu.
  const showCaptions = useVideoCaptionsStore((state) => state.showCaptions);
  const setMuted = useVideoMuteStore((state) => state.setMuted);
  const player = useVideoPlayer(mediaVideoUrl(apiBase, media.id), (created) => {
    // oxlint-disable-next-line react/immutability -- muting is expo-video's documented player API; no setter exists
    created.muted = useVideoMuteStore.getState().isMuted;
    // oxlint-disable-next-line react/immutability -- expo-video's documented player API; no setter exists
    created.timeUpdateEventInterval = 0.25;
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const { status: videoStatus } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Web's isFailed: a broken poster or clip shows the nomedia still.
  const [posterFailed, setPosterFailed] = useState(false);
  // Web's isVideoActive: set once frames are actually on screen while
  // playing, and kept through a pause so the paused frame stays visible.
  const [firstFrame, setFirstFrame] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  // Web shows the pills on hover; a grid tile shows them once started.
  const [engaged, setEngaged] = useState(false);
  const [fetchedCues, setFetchedCues] = useState<TranscriptCue[]>([]);
  // A manual pause holds while the post stays in the viewport; leaving the
  // viewport clears it, so scrolling back resumes autoplay.
  const manualPausedRef = useRef(false);
  const endedRef = useRef(false);

  const isFailed = posterFailed || videoStatus === "error";
  const isVideoActive = firstFrame && hasPlayed;
  const controlsVisible = autoPlayEnabled === true || engaged;

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
  useEventListener(player, "playToEnd", () => {
    endedRef.current = true;
  });
  useEventListener(player, "playingChange", (payload) => {
    if (payload.isPlaying) {
      endedRef.current = false;
      setHasPlayed(true);
    }
  });

  // Every tile follows the shared mute preference.
  useEffect(() => {
    // oxlint-disable-next-line react/immutability -- muting is expo-video's documented player API; no setter exists
    player.muted = isMuted;
  }, [isMuted, player]);

  const startPlayback = () => {
    if (endedRef.current) {
      endedRef.current = false;
      player.replay();
      return;
    }
    player.play();
  };

  // Viewport autoplay, muted by default like web's autoPlay previews.
  //
  // Two gates, and both are needed:
  //   1. Ownership. The enabled feed nominates ONE autoplay post (the topmost
  //      visible video), so a post mounted in two tabs - or two half-visible
  //      cards in one tab - cannot play twice at once, which is heard as
  //      doubled, slightly detuned audio.
  //   2. Feed activity. `autoPlayEnabled` is three-valued: true (this tab is
  //      on screen and may autoplay), false (mounted but backgrounded, so stop
  //      - otherwise swiping away leaves the old tab's video playing), and
  //      undefined (a tap-to-play grid tile that owns its playback, so this
  //      lane must never touch it).
  useEffect(() => {
    if (autoPlayEnabled !== true) {
      if (autoPlayEnabled === false) {
        player.pause();
      }
      return;
    }
    if (isAutoplayPost(postId)) {
      player.play();
    }
    // Losing the slot pauses; gaining it resumes, unless the viewer paused by
    // hand. Leaving the viewport also clears that manual pause, so scrolling
    // back resumes autoplay like web.
    const unsubscribeAutoplay = subscribeAutoplayPost(postId, (isOwner) => {
      if (!isOwner) {
        manualPausedRef.current = false;
        player.pause();
        return;
      }
      if (player.status === "error") {
        return;
      }
      if (endedRef.current) {
        endedRef.current = false;
        player.replay();
        return;
      }
      player.play();
    });
    const unsubscribeVisibility = subscribePostVisibility(postId, (visible) => {
      if (player.status === "error") {
        return;
      }
      if (visible) {
        return;
      }
      manualPausedRef.current = false;
      if (!isAutoplayPost(postId)) {
        player.pause();
      }
    });
    return () => {
      unsubscribeAutoplay();
      unsubscribeVisibility();
    };
  }, [autoPlayEnabled, player, postId]);

  // Web fetches the WebVTT track once the preview is live; an empty track
  // falls back to spreading the transcript across the clip.
  const wantsCaptions = showCaptions && (autoPlayEnabled === true || engaged);
  useEffect(() => {
    if (!wantsCaptions || fetchedCues.length > 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const vtt = await fetchCaptionsVtt(media.id, {
          apiBase,
          cookie: await authClient.getCookie(),
        });
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
  }, [
    apiBase,
    fetchedCues.length,
    media.id,
    media.transcript,
    player,
    wantsCaptions,
  ]);

  const directCues = useMemo(
    () => cuesFromTranscript(media.transcript),
    [media.transcript]
  );
  const cues = fetchedCues.length > 0 ? fetchedCues : directCues;
  const activeCue =
    showCaptions && (isVideoActive || isPlaying || engaged)
      ? findActiveCue(cues, currentTime)
      : null;

  const posterOpacity = useFade(!isVideoActive, 500, POSTER_FADE);
  const badgeOpacity = useFade(!isVideoActive, 300, CSS_EASE);
  const controlsOpacity = useFade(controlsVisible, 200, CSS_EASE);

  const togglePlayback = () => {
    setEngaged(true);
    if (player.playing) {
      manualPausedRef.current = true;
      player.pause();
      return;
    }
    manualPausedRef.current = false;
    startPlayback();
  };

  const toggleMute = () => {
    setEngaged(true);
    setMuted(!isMuted);
  };

  // Lone videos keep their stored aspect (web's natural preview frame);
  // grid cells force the frame instead. Lone radius is the feed rounded-xl.
  const videoRadius = tile ? 8 : 12;
  const videoRatio =
    media.width && media.height && media.height > 0
      ? media.width / media.height
      : 16 / 9;
  // Lone portrait videos hug their width at the 380 cap and pin left, like
  // web's h-[380px] w-auto portrait frame; squares count as portrait, like
  // web's h >= w rule. Landscapes fill the column width.
  const singlePortrait = !tile && videoRatio <= 1;
  let videoFrameStyle: ViewStyle;
  if (tile) {
    videoFrameStyle = styles.tileFill;
  } else if (singlePortrait) {
    videoFrameStyle = {
      alignSelf: "flex-start",
      aspectRatio: videoRatio,
      height: 380,
      maxWidth: "100%",
    };
  } else {
    videoFrameStyle = {
      aspectRatio: videoRatio,
      maxHeight: 380,
      width: "100%",
    };
  }
  const frameStyle = [
    styles.videoFrame,
    {
      borderRadius: videoRadius,
      boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS,
    },
    videoFrameStyle,
  ];

  if (isFailed) {
    return (
      <View style={[frameStyle, styles.videoFailed]}>
        <Image
          accessibilityLabel="Video unavailable"
          contentFit="cover"
          source={noMediaImage}
          style={[styles.fill, { opacity: 0.6 }]}
        />
      </View>
    );
  }

  return (
    <View style={frameStyle}>
      <VideoView
        contentFit="cover"
        nativeControls={false}
        onFirstFrameRender={() => setFirstFrame(true)}
        player={player}
        pointerEvents="none"
        style={styles.fill}
        surfaceType="textureView"
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.fill, { opacity: posterOpacity }]}
      >
        <Image
          accessibilityLabel=""
          contentFit="cover"
          onError={() => setPosterFailed(true)}
          source={{ uri: mediaPosterUrl(apiBase, media.id) }}
          style={styles.fill}
        />
      </Animated.View>
      <LinearGradient
        colors={["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.2)"]}
        end={{ x: 0.5, y: 1 }}
        locations={[0, 0.5, 1]}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={styles.fill}
      />
      <Pressable
        accessibilityLabel={
          media.altText ?? (isPlaying ? "Pause video" : "Play video")
        }
        accessibilityRole="button"
        onPress={togglePlayback}
        style={styles.fill}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.playBadge, { opacity: badgeOpacity }]}
      >
        <Gradient3D
          colors={["#ff9500", "#e65500"]}
          shadows={PLAY_BADGE_SHADOWS}
          style={styles.pillCircle}
        >
          <Play
            color="#ffffff"
            fill="#ffffff"
            size={14}
            style={styles.playNudge}
          />
        </Gradient3D>
      </Animated.View>
      <Animated.View
        pointerEvents={controlsVisible ? "box-none" : "none"}
        style={[styles.fill, { opacity: controlsOpacity }]}
      >
        <Pressable
          accessibilityLabel={isMuted ? "Unmute" : "Mute"}
          accessibilityRole="button"
          hitSlop={6}
          onPress={toggleMute}
          style={({ pressed }) => [
            styles.mutePill,
            pressed && styles.pressedNudge,
          ]}
        >
          <Gradient3D
            colors={["#3a3f4a", "#23262e"]}
            shadows={DARK_PILL_SHADOWS}
            style={styles.muteGradient}
          >
            {isMuted ? (
              <VolumeX color="#ffffff" size={14} />
            ) : (
              <Volume2 color="#ffffff" size={14} />
            )}
            <Text style={styles.muteLabel}>{isMuted ? "Muted" : "Sound"}</Text>
          </Gradient3D>
        </Pressable>
        <Pressable
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          accessibilityRole="button"
          hitSlop={6}
          onPress={togglePlayback}
          style={({ pressed }) => [
            styles.playToggle,
            pressed && styles.pressedNudge,
          ]}
        >
          <Gradient3D
            colors={["#ff9500", "#e65500"]}
            shadows={PLAY_TOGGLE_SHADOWS}
            style={styles.pillCircle}
          >
            {isPlaying ? (
              <Pause color="#ffffff" size={14} />
            ) : (
              <Play color="#ffffff" size={14} style={styles.playNudge} />
            )}
          </Gradient3D>
        </Pressable>
        <View pointerEvents="none" style={styles.timePill}>
          <Gradient3D
            colors={["#3a3f4a", "#23262e"]}
            radius={6}
            shadows={DARK_PILL_SHADOWS}
            style={styles.timeGradient}
          >
            <Text style={styles.timeText}>
              {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
            </Text>
          </Gradient3D>
        </View>
      </Animated.View>
      {media.aiGenerated ? <AiBadge bottom={44} /> : null}
      {activeCue ? (
        <View pointerEvents="none" style={styles.captionRow}>
          <View style={styles.captionBox}>
            <Text numberOfLines={2} style={styles.captionText}>
              {activeCue.text}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Web's `apple-panel` on hsl(var(--background-alt)): the audio row and the
// explicit-media gate panel.
const APPLE_PANEL_LIGHT = {
  background: "#f3f4f6",
  border: "rgba(0, 0, 0, 0.12)",
  shadows: APPLE_PANEL_SHADOWS,
} as const;
const APPLE_PANEL_DARK = {
  background: "#171717",
  border: "rgba(255, 255, 255, 0.12)",
  shadows: APPLE_PANEL_SHADOWS_DARK,
} as const;

// The audio play button's inline web shadow (dark-orange ring, soft drop).
const AUDIO_PLAY_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.12)";

const WAVE_PLAYED = ["#ff9500", "#e65500"] as const;
// `brightness-125` on the bar under the playhead.
const WAVE_CURRENT = ["#ffba00", "#ff6a00"] as const;
const WAVE_UNPLAYED = "rgba(113, 113, 122, 0.3)";

// Peaks shaped once per media id for the session, like web's waveformCache.
const waveformCache = new Map<string, number[]>();
const waveDurationCache = new Map<string, number>();

// Per-bar keyframe tables are the same for every row, so build them once.
const EQ_TABLES = Array.from({ length: EQ_BAR_COUNT }, (_, index) =>
  eqBarInterpolation(index)
);

// 1:1 port of web's AudioPreview: orange 3D play button, file name with the
// elapsed / total clock, and the 80-bar waveform that doubles as the seek
// bar. While the waveform loads every bar is orange and bouncing; once it
// lands, played bars are orange and bounce only while playing, the bar under
// the playhead brightens, unplayed bars sit grey. Tapping the waveform seeks
// (and starts a paused track); the finished track resets to 0:00.
export function AudioRow({
  apiBase,
  media,
}: {
  apiBase: string;
  media: FeedMedia;
}) {
  const { isDark, theme } = useAppTheme();
  const player = useAudioPlayer(mediaAudioUrl(apiBase, media.id), {
    updateInterval: 250,
  });
  // Real-time status must come from useAudioPlayerStatus: reading the player
  // fields directly never re-renders.
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);
  const [waveform, setWaveform] = useState<number[] | null>(
    () => waveformCache.get(media.id) ?? null
  );
  const [peaksDuration, setPeaksDuration] = useState(
    () => waveDurationCache.get(media.id) ?? 0
  );

  // Web decodes the file for its bars; native reads the pipeline's peaks.
  // A missing or broken derivative settles on the fallback profile.
  useEffect(() => {
    if (waveformCache.has(media.id)) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let shaped: number[] = EQ_FALLBACK_HEIGHTS;
      try {
        const peaks = await fetchWavePeaks(media.id, {
          apiBase,
          cookie: await authClient.getCookie(),
        });
        if (peaks) {
          shaped = shapeWaveform(peaks.peaks);
          if (peaks.durationMs) {
            waveDurationCache.set(media.id, peaks.durationMs / 1000);
            if (!cancelled) {
              setPeaksDuration(peaks.durationMs / 1000);
            }
          }
        }
      } catch {
        // Fall through to the fallback profile.
      }
      waveformCache.set(media.id, shaped);
      if (!cancelled) {
        setWaveform(shaped);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, media.id]);

  const { playing } = status;
  const duration = status.duration > 0 ? status.duration : peaksDuration;
  // Web resets the clock to 0:00 onEnded; the latched finish flag drives
  // the same display until the next play.
  const finished =
    status.didJustFinish ||
    (duration > 0 && !playing && status.currentTime >= duration - 0.25);
  const currentTime = finished ? 0 : status.currentTime;

  const isWaveformLoading = waveform === null;
  const animating = isWaveformLoading || playing;

  // asm-eq: one looping 0..1 driver over the 0.8s period; every bar maps it
  // through its own phase-shifted keyframe table (web's -index * 0.04s
  // delays), so the row runs as 80 independent bounces on one native loop.
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [eqCycle] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!animating) {
      return;
    }
    const loop = Animated.loop(
      Animated.timing(eqCycle, {
        duration: EQ_PERIOD_MS,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
      eqCycle.setValue(0);
    };
  }, [animating, eqCycle]);
  const barScales = useMemo(
    () => EQ_TABLES.map((table) => eqCycle.interpolate(table)),
    [eqCycle]
  );

  const toggle = () => {
    if (player.playing) {
      player.pause();
      return;
    }
    // Restart finished tracks like web's onEnded reset.
    if (finished) {
      void player.seekTo(0);
    }
    player.play();
  };

  const seekTo = (seconds: number, startIfPaused: boolean) => {
    const effective =
      Number.isFinite(player.duration) && player.duration > 0
        ? player.duration
        : duration;
    if (effective <= 0) {
      return;
    }
    void player.seekTo(Math.min(effective, Math.max(0, seconds)));
    // Seeking a paused track starts it, like web's waveform seek.
    if (startIfPaused && !player.playing) {
      player.play();
    }
  };

  const seekToX = (x: number) => {
    if (trackWidth <= 0) {
      return;
    }
    const effective =
      Number.isFinite(player.duration) && player.duration > 0
        ? player.duration
        : duration;
    seekTo(Math.min(1, Math.max(0, x / trackWidth)) * effective, true);
  };

  const progressFraction =
    duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const bars = waveform ?? EQ_FALLBACK_HEIGHTS;
  const playedUntilBar = Math.floor(progressFraction * bars.length);
  const panel = isDark ? APPLE_PANEL_DARK : APPLE_PANEL_LIGHT;

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
      <View style={styles.audioTop}>
        <Pressable
          accessibilityLabel={playing ? "Pause audio" : "Play audio"}
          accessibilityRole="button"
          onPress={toggle}
        >
          {({ pressed }) => (
            <Gradient3D
              colors={["#ff9500", "#e65500"]}
              shadows={AUDIO_PLAY_SHADOWS}
              style={[styles.audioPlay, pressed && styles.pressedNudge]}
            >
              {playing ? (
                <Pause color="#ffffff" fill="#ffffff" size={20} />
              ) : (
                <Play
                  color="#ffffff"
                  fill="#ffffff"
                  size={20}
                  style={styles.playNudge}
                />
              )}
            </Gradient3D>
          )}
        </Pressable>
        <View style={styles.audioMeta}>
          <View style={styles.audioHead}>
            <Text
              numberOfLines={1}
              style={[styles.audioName, { color: theme.inputText }]}
            >
              {formatFileName(media.key)}
            </Text>
            <Text style={[styles.audioTime, { color: theme.dividerText }]}>
              {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
            </Text>
          </View>
          <Pressable
            accessibilityActions={[
              { name: "increment" },
              { name: "decrement" },
            ]}
            accessibilityLabel="Audio seek bar"
            accessibilityRole="adjustable"
            accessibilityValue={{
              max: 100,
              min: 0,
              now: Math.round(progressFraction * 100),
            }}
            onAccessibilityAction={(event) => {
              // Web's ArrowLeft / ArrowRight: 5s steps, no auto-start.
              const delta =
                event.nativeEvent.actionName === "increment" ? 5 : -5;
              seekTo(player.currentTime + delta, false);
            }}
            onLayout={(event) => {
              setTrackWidth(event.nativeEvent.layout.width);
            }}
            onPress={(event) => {
              seekToX(event.nativeEvent.locationX);
            }}
            style={styles.waveform}
          >
            {/* Bars never take the touch, so locationX is always measured
                against the whole row rather than whichever bar was hit. */}
            <View pointerEvents="none" style={styles.waveBars}>
              {bars.map((height, index) => {
                const isPlayed = isWaveformLoading || index <= playedUntilBar;
                const isCurrent = playing && index === playedUntilBar;
                const bouncing = isWaveformLoading || (playing && isPlayed);
                let fill: ReactNode = (
                  <View
                    style={[
                      styles.waveFill,
                      { backgroundColor: WAVE_UNPLAYED },
                    ]}
                  />
                );
                if (isPlayed) {
                  fill = (
                    <LinearGradient
                      colors={isCurrent ? WAVE_CURRENT : WAVE_PLAYED}
                      end={{ x: 0.5, y: 1 }}
                      start={{ x: 0.5, y: 0 }}
                      style={styles.waveFill}
                    />
                  );
                }
                return (
                  <View key={index} style={styles.waveBar}>
                    <Animated.View
                      style={[
                        styles.waveBox,
                        { height: `${Math.max(0.12, height) * 100}%` },
                        bouncing && {
                          transform: [{ scaleY: barScales[index] ?? 1 }],
                        },
                      ]}
                    >
                      {fill}
                    </Animated.View>
                  </View>
                );
              })}
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function OverflowTile({
  count,
  onPress,
}: {
  count: number;
  onPress?: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`Show ${count} more media`}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.gridTile,
        styles.overflowTile,
        { backgroundColor: theme.cardBg },
      ]}
    >
      <LinearGradient
        colors={["rgba(0, 0, 0, 0.55)", "rgba(0, 0, 0, 0.55)"]}
        style={styles.overflowScrim}
      />
      <Text style={styles.overflowText}>+{count} more</Text>
    </Pressable>
  );
}

export function ModeratedNotice() {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.moderated,
        {
          backgroundColor: theme.errorBannerBg,
          borderColor: theme.errorBannerBorder,
        },
      ]}
    >
      <ShieldAlert color={theme.errorBannerText} size={24} />
      <Text style={[styles.moderatedText, { color: theme.errorBannerText }]}>
        This post seemed harmful, so it&apos;s been tucked away while it&apos;s
        reviewed.
      </Text>
    </View>
  );
}

// Dismissed explicit gates, shared per post like web's revealKey store: one
// Continue covers every surface rendering the same post for the session.
const revealedExplicitIds = new Set<string>();

export function isExplicitRevealed(revealKey: string): boolean {
  return revealedExplicitIds.has(revealKey);
}

export function markExplicitRevealed(revealKey: string): void {
  revealedExplicitIds.add(revealKey);
}

// expo-image blurRadius renders through RenderEffect, which needs Android 14
// (API 34+ for the framework path expo-image uses) — older devices show the
// still sharp. Those fall back to a fully opaque veil so nothing leaks.
export function explicitBlurSupported(): boolean {
  if (Platform.OS === "ios" || Platform.OS === "web") {
    return true;
  }
  if (Platform.OS === "android") {
    const version = typeof Platform.Version === "number" ? Platform.Version : 0;
    return version >= 34;
  }
  return false;
}

export function ExplicitGate({
  apiBase,
  attachments,
  children,
  revealKey,
}: {
  apiBase: string;
  attachments: FeedMedia[];
  children: ReactNode;
  revealKey?: string;
}) {
  const { isDark, theme } = useAppTheme();
  const [revealed, setRevealed] = useState(() =>
    revealKey ? revealedExplicitIds.has(revealKey) : false
  );
  if (revealed) {
    return children;
  }
  // Concealment, not translucency: the live gallery (players included) is
  // NOT mounted until consent - so nothing protected is legible beforehand
  // and reveal needs no refetch. The veil below only styles the cover still.
  const cover = attachments.find((media) => !isAudioMedia(media));
  let coverUri: string | null = null;
  if (cover) {
    coverUri = isVideoMedia(cover)
      ? mediaPosterUrl(apiBase, cover.id)
      : mediaGridImageUrl(apiBase, cover);
  }
  const coverAspect =
    cover && cover.width && cover.height && cover.height > 0
      ? cover.width / cover.height
      : 16 / 10;
  const blurSupported = explicitBlurSupported();
  // The gate panel is web's `apple-panel` on hsl(var(--background-alt)).
  const panel = isDark ? APPLE_PANEL_DARK : APPLE_PANEL_LIGHT;

  const handleContinue = () => {
    if (revealKey) {
      revealedExplicitIds.add(revealKey);
    }
    setRevealed(true);
  };

  return (
    <View style={[styles.gateWrap, { aspectRatio: coverAspect }]}>
      {coverUri ? (
        <Image
          accessibilityLabel=""
          blurRadius={blurSupported ? 24 : 0}
          contentFit="cover"
          source={{ uri: coverUri }}
          style={[
            styles.gateBackdrop,
            { opacity: 0.6, transform: [{ scale: 1.05 }] },
          ]}
        />
      ) : (
        <LinearGradient
          colors={["#2a2d34", "#17181c"]}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={styles.gateBackdrop}
        />
      )}
      <View
        pointerEvents="none"
        style={[
          styles.gateMask,
          {
            backgroundColor: blurSupported
              ? "rgba(0, 0, 0, 0.4)"
              : theme.containerBg,
          },
        ]}
      />
      <View style={styles.gateOverlay}>
        <View
          style={[
            styles.gatePanel,
            {
              backgroundColor: panel.background,
              borderColor: panel.border,
              boxShadow: panel.shadows,
            },
          ]}
        >
          <View style={styles.gateRow}>
            <Image
              accessibilityLabel=""
              contentFit="contain"
              source={nosearchImage}
              style={styles.gateArt}
            />
            <View style={styles.gateCopy}>
              <Text style={[styles.gateTitle, { color: theme.inputText }]}>
                This post has explicit media.
              </Text>
              <Text style={[styles.gateBody, { color: theme.dividerText }]}>
                Do you want to continue watching?
              </Text>
            </View>
          </View>
          <View style={styles.gateAction}>
            {/* Web's `<Button variant="premium" className="rounded-full
                px-6">`: btn-3d on a 36px pill, text-sm semibold with the
                recipe's text shadow, and the :active press (deeper
                gradient, recessed lip, 1px drop). */}
            <Pressable
              accessibilityLabel="Show explicit media"
              accessibilityRole="button"
              onPress={handleContinue}
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
                    colors={
                      pressed ? ["#e65500", "#d44a00"] : ["#ff9500", "#e65500"]
                    }
                    shadows={shadows}
                    style={[styles.gateBtnFill, pressed && styles.pressedNudge]}
                  >
                    <Text style={styles.gateBtnText}>Continue</Text>
                  </Gradient3D>
                );
              }}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

export function MediaGallery({
  active,
  apiBase,
  attachments,
  onPressMedia,
  postId,
}: GalleryProps) {
  const { failed, markFailed } = useFailedImages();
  const visible = attachments.filter((media) => media && !failed.has(media.id));
  if (visible.length === 0) {
    return null;
  }
  return (
    <SingleOrGrid
      active={active}
      apiBase={apiBase}
      items={visible}
      onFailed={markFailed}
      onPressMedia={onPressMedia}
      postId={postId}
    />
  );
}

function SingleOrGrid({
  active = true,
  apiBase,
  items,
  onFailed,
  onPressMedia,
  postId,
}: {
  active?: boolean;
  apiBase: string;
  items: FeedMedia[];
  onFailed: (id: string) => void;
  onPressMedia?: (index: number) => void;
  postId: string;
}) {
  const [first, ...rest] = items;
  if (!first) {
    return null;
  }
  if (rest.length > 0) {
    return (
      <MediaGrid
        apiBase={apiBase}
        items={items}
        onFailed={onFailed}
        onPressMedia={onPressMedia}
        postId={postId}
      />
    );
  }
  if (isVideoMedia(first)) {
    return (
      <VideoTile
        apiBase={apiBase}
        autoPlayEnabled={active}
        media={first}
        postId={postId}
      />
    );
  }
  if (isAudioMedia(first)) {
    return <AudioRow apiBase={apiBase} media={first} />;
  }
  return (
    <SingleImage
      apiBase={apiBase}
      index={0}
      media={first}
      onFailed={onFailed}
      onPressMedia={onPressMedia}
    />
  );
}

function MediaGrid({
  apiBase,
  items,
  onFailed,
  onPressMedia,
  postId,
}: {
  apiBase: string;
  items: FeedMedia[];
  onFailed: (id: string) => void;
  onPressMedia?: (index: number) => void;
  postId: string;
}) {
  // Web FEED_BENTO_LAYOUTS: 2 = uniform squares; 3 = 2 cols with the first
  // spanning 2 rows; 4 = 3 cols with the first spanning 2 rows and the
  // second spanning 2 cols; 5 = 3 cols with the first spanning 2 rows.
  // 6+ keeps the lead pattern, then up to 3 thumbs plus an overflow tile.
  if (items.length === 2) {
    return (
      <View style={styles.grid2}>
        {items.map((media, i) => (
          <View key={media.id} style={styles.gridCell}>
            {mediaCell(apiBase, media, onFailed, postId, i, onPressMedia)}
          </View>
        ))}
      </View>
    );
  }
  const [first, second, ...rest] = items;
  if (items.length === 3) {
    return (
      <View style={[styles.bentoRow, { aspectRatio: 1 }]}>
        <View style={styles.bentoTall}>
          {first
            ? mediaCell(apiBase, first, onFailed, postId, 0, onPressMedia)
            : null}
        </View>
        <View style={styles.bentoSide}>
          {second ? (
            <View style={styles.bentoCell}>
              {mediaCell(apiBase, second, onFailed, postId, 1, onPressMedia)}
            </View>
          ) : null}
          {rest[0] ? (
            <View style={styles.bentoCell}>
              {mediaCell(apiBase, rest[0], onFailed, postId, 2, onPressMedia)}
            </View>
          ) : null}
        </View>
      </View>
    );
  }
  // 4: the second tile spans two columns on top, two squares below.
  // 5+: a 2x2 block on the right; 6+ appends an overflow row.
  if (items.length === 4) {
    const [wide, ...pair] = [second, ...rest];
    return (
      <View style={styles.bento}>
        <View style={[styles.bentoRow, { aspectRatio: 3 / 2 }]}>
          <View style={styles.bentoTall}>
            {first
              ? mediaCell(apiBase, first, onFailed, postId, 0, onPressMedia)
              : null}
          </View>
          <View style={styles.bentoRightWide}>
            {wide ? (
              <View style={styles.bentoWide}>
                {mediaCell(apiBase, wide, onFailed, postId, 1, onPressMedia)}
              </View>
            ) : null}
            <View style={styles.bentoSideRow}>
              {pair.slice(0, 2).map((media, i) => (
                <View key={media.id} style={styles.bentoCell}>
                  {mediaCell(
                    apiBase,
                    media,
                    onFailed,
                    postId,
                    2 + i,
                    onPressMedia
                  )}
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    );
  }
  const right = [second, ...rest]
    .filter((media): media is FeedMedia => Boolean(media))
    .slice(0, 4);
  const overflow = items.slice(5);
  return (
    <View style={styles.bento}>
      <View style={[styles.bentoRow, { aspectRatio: 3 / 2 }]}>
        <View style={styles.bentoTall}>
          {first
            ? mediaCell(apiBase, first, onFailed, postId, 0, onPressMedia)
            : null}
        </View>
        <View style={styles.bentoRightWide}>
          <View style={styles.bentoSideRow}>
            {right.slice(0, 2).map((media, i) => (
              <View key={media.id} style={styles.bentoCell}>
                {mediaCell(
                  apiBase,
                  media,
                  onFailed,
                  postId,
                  1 + i,
                  onPressMedia
                )}
              </View>
            ))}
          </View>
          <View style={styles.bentoSideRow}>
            {right.slice(2, 4).map((media, i) => (
              <View key={media.id} style={styles.bentoCell}>
                {mediaCell(
                  apiBase,
                  media,
                  onFailed,
                  postId,
                  3 + i,
                  onPressMedia
                )}
              </View>
            ))}
          </View>
        </View>
      </View>
      {overflow.length > 0 ? (
        <View style={styles.bentoRest}>
          {overflow.slice(0, 3).map((media, i) => (
            <View key={media.id} style={styles.bentoRestCell}>
              {mediaCell(apiBase, media, onFailed, postId, 5 + i, onPressMedia)}
            </View>
          ))}
          {overflow.length > 3 ? (
            <OverflowTile
              count={overflow.length - 3}
              onPress={() => onPressMedia?.(5 + Math.min(3, overflow.length))}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function mediaCell(
  apiBase: string,
  media: FeedMedia,
  onFailed: (id: string) => void,
  postId: string,
  index: number,
  onPressMedia?: (index: number) => void
) {
  if (isVideoMedia(media)) {
    // Video tiles keep tap-to-play (the tap drives playback); the viewer
    // route is reached from the detail card's single-image tiles and the
    // overflow tile instead.
    return <VideoTile apiBase={apiBase} media={media} postId={postId} tile />;
  }
  if (isAudioMedia(media)) {
    return <AudioRow apiBase={apiBase} media={media} />;
  }
  return (
    <GridImage
      apiBase={apiBase}
      index={index}
      media={media}
      onFailed={onFailed}
      onPressMedia={onPressMedia}
    />
  );
}

const styles = StyleSheet.create({
  aiBadge: {
    alignItems: "center",
    borderRadius: 9999,
    height: 24,
    justifyContent: "center",
    left: 8,
    position: "absolute",
  },
  aiGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 4,
    height: 24,
    paddingHorizontal: 8,
  },
  aiText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 10,
    fontWeight: "normal",
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
    fontWeight: "normal",
    minWidth: 0,
  },
  audioPanel: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  audioPlay: {
    alignItems: "center",
    borderRadius: 9999,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  audioTime: {
    flexShrink: 0,
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "normal",
  },
  audioTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  bento: {
    gap: 8,
  },
  bentoCell: {
    flex: 1,
  },
  bentoRest: {
    flexDirection: "row",
    gap: 8,
  },
  bentoRestCell: {
    flex: 1,
  },
  bentoRightWide: {
    flex: 2,
    gap: 8,
  },
  bentoRow: {
    flexDirection: "row",
    gap: 8,
  },
  bentoSide: {
    flex: 1,
    gap: 8,
  },
  bentoSideRow: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  bentoTall: {
    flex: 1,
  },
  bentoWide: {
    flex: 1,
  },
  captionBox: {
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: 8,
    boxShadow:
      "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  captionRow: {
    alignItems: "center",
    bottom: 48,
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
  fill: {
    bottom: 0,
    height: "100%",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
  },
  gateAction: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  gateArt: {
    height: 48,
    width: 48,
  },
  gateBackdrop: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  gateBody: {
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    lineHeight: 15,
    marginTop: 2,
  },
  gateBtnFill: {
    alignItems: "center",
    borderRadius: 9999,
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  gateBtnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    letterSpacing: -0.35,
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 1,
  },
  gateCopy: {
    flex: 1,
    minWidth: 0,
  },
  gateMask: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  gateOverlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: 16,
    position: "absolute",
    right: 0,
    top: 0,
  },
  gatePanel: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    maxWidth: 320,
    padding: 16,
    width: "100%",
  },
  gateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  gateTitle: {
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    lineHeight: 18,
  },
  gateWrap: {
    aspectRatio: 16 / 10,
    borderRadius: 12,
    minHeight: 200,
    overflow: "hidden",
    position: "relative",
  },
  grid2: {
    flexDirection: "row",
    gap: 8,
  },
  gridCell: {
    aspectRatio: 1,
    flex: 1,
  },
  gridTile: {
    borderRadius: 8,
    height: "100%",
    overflow: "hidden",
    width: "100%",
  },
  gridTileImage: {
    height: "100%",
    width: "100%",
  },
  gridTileWrap: {
    borderRadius: 8,
    height: "100%",
    overflow: "hidden",
    width: "100%",
  },
  moderated: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  moderatedText: {
    flex: 1,
    fontFamily: "SofiaProReg",
    fontSize: 13,
    fontWeight: "normal",
  },
  muteGradient: {
    alignItems: "center",
    borderRadius: 9999,
    flexDirection: "row",
    gap: 6,
    height: 28,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  muteLabel: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
  },
  mutePill: {
    borderRadius: 9999,
    bottom: 8,
    height: 28,
    left: 8,
    position: "absolute",
  },
  overflowScrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  overflowText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
  },
  overflowTile: {
    alignItems: "center",
    aspectRatio: 1,
    flex: 1,
    justifyContent: "center",
    position: "relative",
  },
  pillCircle: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  playBadge: {
    borderRadius: 9999,
    height: 28,
    position: "absolute",
    right: 8,
    top: 8,
    width: 28,
  },
  playNudge: {
    marginLeft: 2,
  },
  playToggle: {
    borderRadius: 9999,
    bottom: 8,
    height: 28,
    position: "absolute",
    right: 8,
    width: 28,
  },
  pressedNudge: {
    transform: [{ translateY: 1 }],
  },
  single: {
    borderRadius: 12,
    maxHeight: 380,
    width: "100%",
  },
  singleLeft: {
    alignItems: "flex-start",
  },
  singlePortrait: {
    borderRadius: 12,
    height: 380,
    maxWidth: "100%",
  },
  singleWrap: {
    borderRadius: 12,
    justifyContent: "center",
    maxHeight: 380,
    overflow: "hidden",
  },
  tileFill: {
    height: "100%",
    width: "100%",
  },
  timeGradient: {
    alignItems: "center",
    borderRadius: 6,
    height: 20,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  timePill: {
    borderRadius: 6,
    bottom: 44,
    height: 20,
    position: "absolute",
    right: 8,
  },
  timeText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    fontWeight: "normal",
  },
  videoFailed: {
    backgroundColor: "rgba(128, 128, 128, 0.08)",
  },
  videoFrame: {
    overflow: "hidden",
    position: "relative",
  },
  waveBar: {
    flex: 1,
    justifyContent: "center",
  },
  waveBars: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 1,
  },
  waveBox: {
    width: "100%",
  },
  waveFill: {
    borderRadius: 9999,
    height: "100%",
    width: "100%",
  },
  waveform: {
    height: 40,
    marginTop: 8,
  },
});
