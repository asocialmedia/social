import { useAudioPlayer } from "expo-audio";
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
  Volume2,
  VolumeX,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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

interface GalleryProps {
  apiBase: string;
  attachments: FeedMedia[];
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
  const { theme } = useAppTheme();
  const ratio =
    media.width && media.height && media.height > 0
      ? media.width / media.height
      : 4 / 3;
  // Portraits pin left at natural proportions (web w-fit); landscapes fill
  // the width. Both cap at the feed max height.
  const portrait = ratio < 1;
  return (
    <View
      style={[
        styles.singleWrap,
        { backgroundColor: theme.cardBg },
        portrait && styles.singleLeft,
      ]}
    >
      <Image
        accessibilityLabel={media.altText ?? "Post image"}
        contentFit="contain"
        onError={() => onFailed(media.id)}
        source={{ uri: mediaImageUrl(apiBase, media) }}
        style={
          portrait
            ? [styles.singlePortrait, { aspectRatio: ratio }]
            : [styles.single, { aspectRatio: ratio }]
        }
      />
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
  return (
    <Image
      accessibilityLabel={media.altText ?? "Post image"}
      contentFit="cover"
      onError={() => onFailed(media.id)}
      source={{ uri: mediaGridImageUrl(apiBase, media) }}
      style={styles.gridTile}
    />
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

function VideoTile({ apiBase, media }: { apiBase: string; media: FeedMedia }) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const player = useVideoPlayer(mediaVideoUrl(apiBase, media.id));

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

  if (!playing) {
    return (
      <Pressable
        accessibilityLabel={media.altText ?? "Play video"}
        accessibilityRole="button"
        onPress={() => setPlaying(true)}
        style={styles.videoPosterWrap}
      >
        <Image
          accessibilityLabel=""
          contentFit="cover"
          source={{ uri: mediaPosterUrl(apiBase, media.id) }}
          style={styles.gridTile}
        />
        <View style={styles.playBadge}>
          <Play color="#ffffff" fill="#ffffff" size={20} />
        </View>
      </Pressable>
    );
  }
  return (
    <View style={styles.videoActive}>
      <VideoView
        contentFit="cover"
        player={player}
        style={styles.videoPlayer}
      />
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
            onPress={() => {
              const next = !muted;
              // oxlint-disable-next-line react/immutability -- muting is expo-video's documented player API; no setter exists
              player.muted = next;
              setMuted(next);
            }}
          >
            {muted ? (
              <VolumeX color="#ffffff" size={14} />
            ) : (
              <Volume2 color="#ffffff" size={14} />
            )}
          </Pressable>
        </LinearGradient>
      </View>
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
        onPress={() => setPlaying(false)}
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
  // Subscribed (500ms): position/duration/playing re-render on change, so
  // no polling interval is needed.
  const player = useAudioPlayer(mediaAudioUrl(apiBase, media.id), {
    updateInterval: 500,
  });
  const [trackWidth, setTrackWidth] = useState(0);

  const { playing } = player;
  const position = player.currentTime;
  const { duration } = player;

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
                  {played ? (
                    <LinearGradient
                      colors={["#ff9500", "#e65500"]}
                      end={{ x: 0.5, y: 1 }}
                      start={{ x: 0.5, y: 0 }}
                      style={[
                        styles.waveFill,
                        { height: `${Math.max(12, height * 100)}%` },
                      ]}
                    />
                  ) : (
                    <View
                      style={[
                        styles.waveFill,
                        {
                          backgroundColor: "rgba(113, 113, 122, 0.3)",
                          height: `${Math.max(12, height * 100)}%`,
                        },
                      ]}
                    />
                  )}
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

function ExplicitGate({
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

export function MediaGallery({
  apiBase,
  attachments,
  explicitContent,
}: GalleryProps & {
  explicitContent?: boolean;
}) {
  const { failed, markFailed } = useFailedImages();
  const visible = attachments.filter((media) => media && !failed.has(media.id));
  if (visible.length === 0) {
    return null;
  }
  const gallery = (
    <SingleOrGrid apiBase={apiBase} items={visible} onFailed={markFailed} />
  );
  if (explicitContent) {
    return (
      <ExplicitGate apiBase={apiBase} attachments={attachments}>
        {gallery}
      </ExplicitGate>
    );
  }
  return gallery;
}

function SingleOrGrid({
  apiBase,
  items,
  onFailed,
}: {
  apiBase: string;
  items: FeedMedia[];
  onFailed: (id: string) => void;
}) {
  const [first, ...rest] = items;
  if (!first) {
    return null;
  }
  if (rest.length > 0) {
    return <MediaGrid apiBase={apiBase} items={items} onFailed={onFailed} />;
  }
  if (isVideoMedia(first)) {
    return <VideoTile apiBase={apiBase} media={first} />;
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
}: {
  apiBase: string;
  items: FeedMedia[];
  onFailed: (id: string) => void;
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
            {mediaCell(apiBase, media, onFailed)}
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
          {first ? mediaCell(apiBase, first, onFailed) : null}
        </View>
        <View style={styles.bentoSide}>
          {second ? (
            <View style={styles.bentoCell}>
              {mediaCell(apiBase, second, onFailed)}
            </View>
          ) : null}
          {rest[0] ? (
            <View style={styles.bentoCell}>
              {mediaCell(apiBase, rest[0], onFailed)}
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
            {first ? mediaCell(apiBase, first, onFailed) : null}
          </View>
          <View style={styles.bentoRightWide}>
            {wide ? (
              <View style={styles.bentoWide}>
                {mediaCell(apiBase, wide, onFailed)}
              </View>
            ) : null}
            <View style={styles.bentoSideRow}>
              {pair.slice(0, 2).map((media) => (
                <View key={media.id} style={styles.bentoCell}>
                  {mediaCell(apiBase, media, onFailed)}
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
          {first ? mediaCell(apiBase, first, onFailed) : null}
        </View>
        <View style={styles.bentoRightWide}>
          <View style={styles.bentoSideRow}>
            {right.slice(0, 2).map((media) => (
              <View key={media.id} style={styles.bentoCell}>
                {mediaCell(apiBase, media, onFailed)}
              </View>
            ))}
          </View>
          <View style={styles.bentoSideRow}>
            {right.slice(2, 4).map((media) => (
              <View key={media.id} style={styles.bentoCell}>
                {mediaCell(apiBase, media, onFailed)}
              </View>
            ))}
          </View>
        </View>
      </View>
      {overflow.length > 0 ? (
        <View style={styles.bentoRest}>
          {overflow.slice(0, 3).map((media) => (
            <View key={media.id} style={styles.bentoRestCell}>
              {mediaCell(apiBase, media, onFailed)}
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
  onFailed: (id: string) => void
) {
  if (isVideoMedia(media)) {
    return <VideoTile apiBase={apiBase} media={media} />;
  }
  if (isAudioMedia(media)) {
    return <AudioRow apiBase={apiBase} media={media} />;
  }
  return <GridImage apiBase={apiBase} media={media} onFailed={onFailed} />;
}

const styles = StyleSheet.create({
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
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    borderRadius: 8,
    bottom: 44,
    left: 8,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: "absolute",
  },
  captionText: {
    color: "#ffffff",
    fontFamily: "SofiaProMed",
    fontSize: 12,
    fontWeight: "normal",
    lineHeight: 15,
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
  mutePill: {
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
    bottom: 8,
    height: 28,
    position: "absolute",
    right: 8,
    width: 28,
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
    aspectRatio: 16 / 9,
    borderRadius: 8,
    width: "100%",
  },
  videoPosterWrap: {
    alignItems: "center",
    aspectRatio: 16 / 9,
    borderRadius: 8,
    justifyContent: "center",
    overflow: "hidden",
  },
  waveBar: {
    flex: 1,
    justifyContent: "center",
  },
  waveFill: {
    borderRadius: 9999,
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
