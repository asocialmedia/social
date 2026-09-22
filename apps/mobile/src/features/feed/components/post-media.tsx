import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
// Post media gallery: single / 2-grid / 3-5 bento / 6+ overflow layouts,
// video tap-to-play, audio rows, the explicit-content gate and the moderated
// notice. Mirrors web's MediaPreviews + ExplicitContentGate arrangement;
// detail-only behaviors (autoplay, viewer routes, captions) stay out.
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
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ViewStyle } from "react-native";

import noMediaImage from "@/assets/images/nomedia.png";
import {
  APPLE_PANEL_SHADOWS,
  APPLE_PANEL_SHADOWS_DARK,
  LOGIN_BUTTON_SHADOWS,
  useAppTheme,
} from "@/theme";

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
import { isPostVisible, subscribePostVisibility } from "../lib/visible-posts";

interface GalleryProps {
  apiBase: string;
  attachments: FeedMedia[];
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
  media,
  onFailed,
}: {
  apiBase: string;
  media: FeedMedia;
  onFailed: (id: string) => void;
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
  return (
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
}

function GridImage({
  apiBase,
  media,
  onFailed,
}: {
  apiBase: string;
  media: FeedMedia;
  onFailed: (id: string) => void;
}) {
  const { isDark } = useAppTheme();
  return (
    <View
      style={[
        styles.gridTileWrap,
        { boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS },
      ]}
    >
      <Image
        accessibilityLabel={media.altText ?? "Post image"}
        contentFit="cover"
        onError={() => onFailed(media.id)}
        source={{ uri: mediaGridImageUrl(apiBase, media) }}
        style={styles.gridTileImage}
      />
      {media.aiGenerated ? <AiBadge /> : null}
    </View>
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

// Static waveform profile (native has no Web Audio decode like web's
// AudioPreview). Same deterministic 80-bar fallback web renders while its
// real waveform decodes.
const EQ_BAR_COUNT = 80;
const EQ_BAR_HEIGHTS: number[] = [];
for (let index = 0; index < EQ_BAR_COUNT; index += 1) {
  EQ_BAR_HEIGHTS.push((30 + ((index * 37) % 55)) / 100);
}

const DARK_PILL_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.18), 0 2px 6px rgba(0, 0, 0, 0.35)";

const ORANGE_PILL_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(170, 60, 0, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.25)";

// Web's `shadow-xs` on single/grid media frames.
const FRAME_SHADOWS = "0 1px 2px rgba(0, 0, 0, 0.05)";
const FRAME_SHADOWS_DARK = "0 1px 2px rgba(0, 0, 0, 0.25)";

// AI badge: web's violet dual-border 3D (same recipe as the mute-active
// vote button), reserved for special labels.
const AI_BADGE_SHADOWS =
  "inset 0 0 0 1px rgba(255, 255, 255, 0.25), inset 0 1.5px 2px rgba(255, 255, 255, 0.5), 0 0 0 1px rgba(70, 40, 170, 0.95), 0 1px 1px rgba(255, 255, 255, 0.4), 0 3px 5px rgba(0, 0, 0, 0.25)";
const AI_BADGE_SHADOWS_DARK = AI_BADGE_SHADOWS;

// AI-generated marker over media surfaces, ported from web's
// AiGeneratedBadge: violet 3D pill, bottom-left of the frame (lifted above
// the mute pill on video tiles). The flag arrives on Media.aiGenerated.
function AiBadge({ bottom = 8 }: { bottom?: number }) {
  const { isDark } = useAppTheme();
  return (
    <View
      accessibilityLabel="AI-generated content"
      accessibilityRole="text"
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
  const [playing, setPlaying] = useState(
    () => autoPlayEnabled === true && isPostVisible(postId)
  );
  const [muted, setMuted] = useState(
    () => autoPlayEnabled === true && isPostVisible(postId)
  );
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  // A broken poster shows web's nomedia still instead of an empty tile.
  const [posterFailed, setPosterFailed] = useState(false);
  const player = useVideoPlayer(mediaVideoUrl(apiBase, media.id));
  // expo-video surfaces load failure on the player status; an errored clip
  // renders the same nomedia still as a broken poster.
  const playerErrored = player.status === "error";
  // Control pills sit inside the tile's play Pressable and their taps bubble,
  // so they raise this flag to swallow the tile tap that follows.
  const suppressTapRef = useRef(false);
  // A manual pause holds while the post stays in the viewport; leaving the
  // viewport clears it, so scrolling back resumes autoplay.
  const manualPausedRef = useRef(false);

  // The native mute flag mirrors state for tiles that mount already visible;
  // later changes go through the subscription and the mute controls.
  useEffect(() => {
    if (autoPlayEnabled && isPostVisible(postId)) {
      // oxlint-disable-next-line react/immutability -- muting is expo-video's documented player API; no setter exists
      player.muted = true;
    }
  }, [autoPlayEnabled, player, postId]);

  // Viewport autoplay, muted like web's feed previews. State only changes
  // inside the subscription callback, never synchronously in the effect.
  useEffect(() => {
    if (!autoPlayEnabled) {
      return;
    }
    return subscribePostVisibility(postId, (visible) => {
      if (player.status === "error") {
        return;
      }
      if (visible) {
        if (!manualPausedRef.current) {
          // oxlint-disable-next-line react/immutability -- muting is expo-video's documented player API; no setter exists
          player.muted = true;
          setMuted(true);
          setPlaying(true);
        }
        return;
      }
      manualPausedRef.current = false;
      setPlaying(false);
    });
  }, [autoPlayEnabled, manualPausedRef, player, postId]);

  useEffect(() => {
    if (!playing) {
      player.pause();
      return;
    }
    player.play();
    const timer = setInterval(() => {
      try {
        setPosition(player.currentTime);
        setDuration(player.duration);
      } catch {
        // Player teardown races the poll; the tile unmounts anyway.
      }
    }, 500);
    return () => clearInterval(timer);
  }, [player, playing]);

  // Lone videos keep their stored aspect (web's natural preview frame);
  // grid cells force the frame instead. Lone radius is the feed rounded-xl.
  const { isDark } = useAppTheme();
  const videoRadius = tile ? 8 : 12;
  const videoRatio =
    media.width && media.height && media.height > 0
      ? media.width / media.height
      : 16 / 9;
  // Lone portrait videos hug their width at the 380 cap and pin left, like
  // web's h-[380px] w-auto portrait frame; squares count as portrait, like
  // web's h >= w rule. Landscapes fill the column width.
  // Grid tiles fill their cell instead.
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

  const toggleMute = () => {
    suppressTapRef.current = true;
    const next = !muted;
    // oxlint-disable-next-line react/immutability -- muting is expo-video's documented player API; no setter exists
    player.muted = next;
    setMuted(next);
  };

  // Dark 3D mute pill with its Sound/Muted label, bottom-left on both the
  // poster and the playing tile - web shows the label, not an icon alone.
  const mutePill = (
    <View style={[styles.mutePill, { boxShadow: DARK_PILL_SHADOWS }]}>
      <LinearGradient
        colors={["#3a3f4a", "#23262e"]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={styles.muteGradient}
      >
        <Pressable
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          accessibilityRole="button"
          hitSlop={6}
          onPress={toggleMute}
          style={styles.mutePress}
        >
          {muted ? (
            <VolumeX color="#ffffff" size={14} />
          ) : (
            <Volume2 color="#ffffff" size={14} />
          )}
          <Text style={styles.muteLabel}>{muted ? "Muted" : "Sound"}</Text>
        </Pressable>
      </LinearGradient>
    </View>
  );

  const manualPlay = () => {
    manualPausedRef.current = false;
    // oxlint-disable-next-line react/immutability -- muting is expo-video's documented player API; no setter exists
    player.muted = false;
    setMuted(false);
    setPlaying(true);
  };

  const manualPause = () => {
    manualPausedRef.current = true;
    setPlaying(false);
  };

  if (!playing) {
    // Poster: natural-aspect still with the bottom legibility scrim, the
    // orange 3D play badge pinned top-right, and the dark 3D mute pill with
    // its Sound/Muted label bottom-left - web's feed preview arrangement.
    // A broken poster falls back to the nomedia still, like web.
    if (posterFailed) {
      return (
        <View
          style={[
            styles.videoPosterWrap,
            {
              borderRadius: videoRadius,
              boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS,
            },
            videoFrameStyle,
          ]}
        >
          <Image
            accessibilityLabel="Video unavailable"
            contentFit="cover"
            source={noMediaImage}
            style={[
              styles.posterImage,
              { borderRadius: videoRadius, opacity: 0.6 },
            ]}
          />
        </View>
      );
    }
    return (
      <Pressable
        accessibilityLabel={media.altText ?? "Play video"}
        accessibilityRole="button"
        onPress={() => {
          if (suppressTapRef.current) {
            suppressTapRef.current = false;
            return;
          }
          manualPlay();
        }}
        style={[
          styles.videoPosterWrap,
          {
            borderRadius: videoRadius,
            boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS,
          },
          videoFrameStyle,
        ]}
      >
        <Image
          accessibilityLabel=""
          contentFit="cover"
          onError={() => setPosterFailed(true)}
          source={{ uri: mediaPosterUrl(apiBase, media.id) }}
          style={[styles.posterImage, { borderRadius: videoRadius }]}
        />
        <LinearGradient
          colors={["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.5)"]}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={styles.posterScrim}
        />
        <View style={[styles.posterPlay, { boxShadow: ORANGE_PILL_SHADOWS }]}>
          <LinearGradient
            colors={["#ff9500", "#e65500"]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={styles.posterPlayGradient}
          >
            <Play
              color="#ffffff"
              fill="#ffffff"
              size={14}
              style={styles.playNudge}
            />
          </LinearGradient>
        </View>
        {mutePill}
        {media.aiGenerated ? <AiBadge bottom={44} /> : null}
      </Pressable>
    );
  }
  if (playerErrored) {
    return (
      <View
        style={[
          styles.videoActive,
          {
            borderRadius: videoRadius,
            boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS,
            overflow: "hidden",
          },
          videoFrameStyle,
        ]}
      >
        <Image
          accessibilityLabel="Video unavailable"
          contentFit="cover"
          source={noMediaImage}
          style={[styles.videoPlayer, { opacity: 0.6 }]}
        />
      </View>
    );
  }
  return (
    <View
      style={[
        styles.videoActive,
        {
          borderRadius: videoRadius,
          boxShadow: isDark ? FRAME_SHADOWS_DARK : FRAME_SHADOWS,
          overflow: "hidden",
        },
        videoFrameStyle,
      ]}
    >
      <VideoView
        contentFit="cover"
        player={player}
        style={styles.videoPlayer}
      />
      <LinearGradient
        colors={["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.5)"]}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
        start={{ x: 0.5, y: 0 }}
        style={styles.posterScrim}
      />
      {mutePill}
      {media.aiGenerated ? <AiBadge bottom={44} /> : null}
      <View style={[styles.timePill, { boxShadow: DARK_PILL_SHADOWS }]}>
        <LinearGradient
          colors={["#3a3f4a", "#23262e"]}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={styles.timeGradient}
        >
          <Text style={styles.timeText}>
            {formatMediaTime(position)} / {formatMediaTime(duration)}
          </Text>
        </LinearGradient>
      </View>
      <Pressable
        accessibilityLabel="Pause video"
        accessibilityRole="button"
        hitSlop={6}
        onPress={manualPause}
        style={[styles.playToggle, { boxShadow: ORANGE_PILL_SHADOWS }]}
      >
        <LinearGradient
          colors={["#ff9500", "#e65500"]}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={styles.playGradient}
        >
          <Pause color="#ffffff" fill="#ffffff" size={14} />
        </LinearGradient>
      </Pressable>
      {media.transcript ? (
        <View style={styles.captionBox}>
          <Text numberOfLines={2} style={styles.captionText}>
            {media.transcript}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function AudioRow({ apiBase, media }: { apiBase: string; media: FeedMedia }) {
  const { isDark, theme } = useAppTheme();
  const player = useAudioPlayer(mediaAudioUrl(apiBase, media.id), {
    updateInterval: 500,
  });
  // Real-time status must come from useAudioPlayerStatus: reading the player
  // fields directly never re-renders, which froze the button, the clock and
  // the visualizer.
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);

  const { playing } = status;
  const { duration } = status;
  // Web resets the clock to 0:00 onEnded; the latched finish flag drives
  // the same display until the next play.
  const finished =
    status.didJustFinish ||
    (duration > 0 && !playing && status.currentTime >= duration - 0.25);
  const position = finished ? 0 : status.currentTime;

  // Equalizer motion, ported from web's asm-eq-bar keyframes (scaleY
  // 0.4 <-> 1.15, 0.8s bounce, per-bar phase offsets). One looping value
  // drives every bar: each bar peaks as the value sweeps past its index,
  // so a single native animation reads as a traveling wave.
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; no setter is ever needed
  const [eqPhase] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!playing) {
      return;
    }
    const wave = Animated.loop(
      Animated.timing(eqPhase, {
        duration: EQ_BAR_COUNT * 40,
        easing: Easing.linear,
        toValue: EQ_BAR_COUNT,
        useNativeDriver: true,
      })
    );
    wave.start();
    return () => {
      wave.stop();
      eqPhase.setValue(0);
    };
  }, [eqPhase, playing]);

  const barScales = useMemo(
    () =>
      EQ_BAR_HEIGHTS.map((_, index) =>
        eqPhase.interpolate({
          extrapolate: "clamp",
          inputRange: [index - 1.2, index, index + 1.2],
          outputRange: [0.4, 1.15, 0.4],
        })
      ),
    [eqPhase]
  );

  const toggle = () => {
    if (player.playing) {
      player.pause();
      return;
    }
    // Restart finished tracks like web's onEnded reset.
    if (duration > 0 && player.currentTime >= duration - 0.25) {
      player.seekTo(0);
    }
    player.play();
  };

  const seekToClientX = (x: number) => {
    const effective =
      Number.isFinite(player.duration) && player.duration > 0
        ? player.duration
        : duration;
    if (effective <= 0 || trackWidth <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, x / trackWidth));
    player.seekTo(ratio * effective);
    // Seeking a paused track starts it, like web's waveform seek.
    if (!player.playing) {
      player.play();
    }
  };

  const fraction =
    duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const playedUntilBar = Math.floor(fraction * EQ_BAR_COUNT);

  return (
    <View
      style={[
        styles.audioPanel,
        {
          backgroundColor: theme.cardBg,
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.12)"
            : "rgba(0, 0, 0, 0.12)",
          boxShadow: isDark ? APPLE_PANEL_SHADOWS_DARK : APPLE_PANEL_SHADOWS,
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
            <LinearGradient
              colors={["#ff9500", "#e65500"]}
              end={{ x: 0.5, y: 1 }}
              start={{ x: 0.5, y: 0 }}
              style={[
                styles.audioPlay,
                { boxShadow: LOGIN_BUTTON_SHADOWS },
                pressed && styles.pressedShift,
              ]}
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
            </LinearGradient>
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
              {formatMediaTime(position)} / {formatMediaTime(duration)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Audio seek bar"
            accessibilityRole="adjustable"
            onPress={(event) => {
              seekToClientX(event.nativeEvent.locationX);
            }}
            onLayout={(event) => {
              setTrackWidth(event.nativeEvent.layout.width);
            }}
            style={styles.waveform}
          >
            {EQ_BAR_HEIGHTS.map((height, index) => {
              const played = index <= playedUntilBar;
              return (
                <View key={index} style={styles.waveBar}>
                  <Animated.View
                    style={[
                      styles.waveBox,
                      { height: `${Math.max(12, height * 100)}%` },
                      playing &&
                        played && {
                          transform: [{ scaleY: barScales[index] }],
                        },
                    ]}
                  >
                    {played ? (
                      <LinearGradient
                        colors={["#ff9500", "#e65500"]}
                        end={{ x: 0.5, y: 1 }}
                        start={{ x: 0.5, y: 0 }}
                        style={styles.waveFill}
                      />
                    ) : (
                      <View
                        style={[
                          styles.waveFill,
                          {
                            backgroundColor: "rgba(113, 113, 122, 0.3)",
                          },
                        ]}
                      />
                    )}
                  </Animated.View>
                </View>
              );
            })}
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

export function ExplicitGate({
  apiBase,
  attachments,
  children,
}: {
  apiBase: string;
  attachments: FeedMedia[];
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) {
    return children;
  }
  // Concealment, not translucency: the live gallery (players included) is
  // NOT mounted until consent. The backdrop is a heavily blurred still (or
  // a dark wash when there is no visual attachment), under a full-area mask
  // and the consent panel - so nothing protected is legible beforehand.
  const cover = attachments.find((media) => !isAudioMedia(media));
  let coverUri: string | null = null;
  if (cover) {
    coverUri = isVideoMedia(cover)
      ? mediaPosterUrl(apiBase, cover.id)
      : mediaGridImageUrl(apiBase, cover);
  }
  return (
    <View style={styles.gateWrap}>
      {coverUri ? (
        <Image
          accessibilityLabel=""
          blurRadius={40}
          contentFit="cover"
          source={{ uri: coverUri }}
          style={styles.gateBackdrop}
        />
      ) : (
        <LinearGradient
          colors={["#2a2d34", "#17181c"]}
          end={{ x: 0.5, y: 1 }}
          start={{ x: 0.5, y: 0 }}
          style={styles.gateBackdrop}
        />
      )}
      <View pointerEvents="none" style={styles.gateMask} />
      <View style={styles.gateOverlay}>
        <View
          style={[styles.gatePanel, { backgroundColor: "rgba(0, 0, 0, 0.4)" }]}
        >
          <Text style={styles.gateTitle}>This post has explicit media</Text>
          <Text style={styles.gateBody}>Do you want to continue watching?</Text>
          <Pressable
            accessibilityLabel="Show explicit media"
            accessibilityRole="button"
            onPress={() => setRevealed(true)}
            style={styles.gateBtn}
          >
            <Text style={styles.gateBtnText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function MediaGallery({ apiBase, attachments, postId }: GalleryProps) {
  const { failed, markFailed } = useFailedImages();
  const visible = attachments.filter((media) => media && !failed.has(media.id));
  if (visible.length === 0) {
    return null;
  }
  return (
    <SingleOrGrid
      apiBase={apiBase}
      items={visible}
      onFailed={markFailed}
      postId={postId}
    />
  );
}

function SingleOrGrid({
  apiBase,
  items,
  onFailed,
  postId,
}: {
  apiBase: string;
  items: FeedMedia[];
  onFailed: (id: string) => void;
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
        postId={postId}
      />
    );
  }
  if (isVideoMedia(first)) {
    return (
      <VideoTile
        apiBase={apiBase}
        autoPlayEnabled
        media={first}
        postId={postId}
      />
    );
  }
  if (isAudioMedia(first)) {
    return <AudioRow apiBase={apiBase} media={first} />;
  }
  return <SingleImage apiBase={apiBase} media={first} onFailed={onFailed} />;
}

function MediaGrid({
  apiBase,
  items,
  onFailed,
  postId,
}: {
  apiBase: string;
  items: FeedMedia[];
  onFailed: (id: string) => void;
  postId: string;
}) {
  // Web FEED_BENTO_LAYOUTS: 2 = uniform squares; 3 = 2 cols with the first
  // spanning 2 rows; 4 = 3 cols with the first spanning 2 rows and the
  // second spanning 2 cols; 5 = 3 cols with the first spanning 2 rows.
  // 6+ keeps the lead pattern, then up to 3 thumbs plus an overflow tile.
  if (items.length === 2) {
    return (
      <View style={styles.grid2}>
        {items.map((media) => (
          <View key={media.id} style={styles.gridCell}>
            {mediaCell(apiBase, media, onFailed, postId)}
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
          {first ? mediaCell(apiBase, first, onFailed, postId) : null}
        </View>
        <View style={styles.bentoSide}>
          {second ? (
            <View style={styles.bentoCell}>
              {mediaCell(apiBase, second, onFailed, postId)}
            </View>
          ) : null}
          {rest[0] ? (
            <View style={styles.bentoCell}>
              {mediaCell(apiBase, rest[0], onFailed, postId)}
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
            {first ? mediaCell(apiBase, first, onFailed, postId) : null}
          </View>
          <View style={styles.bentoRightWide}>
            {wide ? (
              <View style={styles.bentoWide}>
                {mediaCell(apiBase, wide, onFailed, postId)}
              </View>
            ) : null}
            <View style={styles.bentoSideRow}>
              {pair.slice(0, 2).map((media) => (
                <View key={media.id} style={styles.bentoCell}>
                  {mediaCell(apiBase, media, onFailed, postId)}
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
          {first ? mediaCell(apiBase, first, onFailed, postId) : null}
        </View>
        <View style={styles.bentoRightWide}>
          <View style={styles.bentoSideRow}>
            {right.slice(0, 2).map((media) => (
              <View key={media.id} style={styles.bentoCell}>
                {mediaCell(apiBase, media, onFailed, postId)}
              </View>
            ))}
          </View>
          <View style={styles.bentoSideRow}>
            {right.slice(2, 4).map((media) => (
              <View key={media.id} style={styles.bentoCell}>
                {mediaCell(apiBase, media, onFailed, postId)}
              </View>
            ))}
          </View>
        </View>
      </View>
      {overflow.length > 0 ? (
        <View style={styles.bentoRest}>
          {overflow.slice(0, 3).map((media) => (
            <View key={media.id} style={styles.bentoRestCell}>
              {mediaCell(apiBase, media, onFailed, postId)}
            </View>
          ))}
          {overflow.length > 3 ? (
            <OverflowTile count={overflow.length - 3} />
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
  postId: string
) {
  if (isVideoMedia(media)) {
    return <VideoTile apiBase={apiBase} media={media} postId={postId} tile />;
  }
  if (isAudioMedia(media)) {
    return <AudioRow apiBase={apiBase} media={media} />;
  }
  return <GridImage apiBase={apiBase} media={media} onFailed={onFailed} />;
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
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: 8,
    bottom: 48,
    justifyContent: "center",
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
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
  gateBackdrop: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  gateBody: {
    color: "#ffffff",
    fontFamily: "SofiaProReg",
    fontSize: 12,
    fontWeight: "normal",
    textAlign: "center",
  },
  gateBtn: {
    alignItems: "center",
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  gateBtnText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 13,
    fontWeight: "normal",
  },
  gateMask: {
    backgroundColor: "rgba(0, 0, 0, 0.45)",
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
    position: "absolute",
    right: 0,
    top: 0,
  },
  gatePanel: {
    alignItems: "center",
    borderRadius: 16,
    maxWidth: 280,
    padding: 16,
  },
  gateTitle: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
    fontWeight: "normal",
    textAlign: "center",
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
  mutePress: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    height: 28,
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
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    borderRadius: 9999,
    height: 48,
    justifyContent: "center",
    position: "absolute",
    width: 48,
  },
  playGradient: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
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
  posterImage: {
    height: "100%",
    overflow: "hidden",
    width: "100%",
  },
  posterPlay: {
    borderRadius: 9999,
    height: 28,
    position: "absolute",
    right: 8,
    top: 8,
    width: 28,
  },
  posterPlayGradient: {
    alignItems: "center",
    borderRadius: 9999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  posterScrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  pressedShift: {
    opacity: 0.88,
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
    bottom: 44,
    height: 20,
    position: "absolute",
    right: 8,
  },
  timeText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 10,
    fontWeight: "normal",
  },
  videoActive: {
    position: "relative",
  },
  videoPlayer: {
    height: "100%",
    width: "100%",
  },
  videoPosterWrap: {
    overflow: "hidden",
  },
  waveBar: {
    flex: 1,
    justifyContent: "center",
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
    alignItems: "center",
    flexDirection: "row",
    gap: 1,
    height: 40,
    marginTop: 8,
  },
});
