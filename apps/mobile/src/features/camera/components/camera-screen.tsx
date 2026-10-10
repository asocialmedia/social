// Full-screen Instagram-style capture page. Front camera by default on every
// open, permissions requested only here (never at boot), and the session is
// torn down the moment the route blurs so nothing leaks in the background.
// Tap the orange shutter for a photo, press-and-hold for video (manual stop,
// no cap). Captures auto-save to the gallery, then open the floating composer
// with the file attached to the selected fleet / gust / community target.
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from "expo-camera";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as NavigationBar from "expo-navigation-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Images, RefreshCw, X, Zap, ZapOff } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Circle, Svg } from "react-native-svg";

import { toast } from "@/components/feedback/toast";
import { POST_SCOPE } from "@/features/composer/components/post-editor";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { RailButton } from "@/features/gusts/components/rail-button";
import { MAX_POST_ATTACHMENTS } from "@/features/media-upload/lib/upload-policy";
import { attachmentActions } from "@/features/media-upload/state/attachment-store";
import { haptic } from "@/lib/haptics";
import { logError, logInfo, logWarn } from "@/lib/telemetry";

import {
  CAMERA_TARGETS,
  composerModeForTarget,
  pickedFromCapture,
  targetAllowsKind,
} from "../lib/camera-handoff";
import { latestGalleryThumb, saveCaptureToGallery } from "../lib/camera-save";

type Facing = "back" | "front";

const TARGET_LABEL: Record<string, string> = {
  community: "Community",
  fleet: "Fleet",
  gust: "Gusts",
};

// Recording progress ring: one dash of a fixed circumference, spun in a loop
// so the stroke travels around the shutter while a video is recording. It
// laps the shutter from just outside the track, so it is sized a touch larger
// than the stage.
const SHUTTER_SIZE = 96;
const RING_SIZE = 104;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView | null>(null);
  // Front by default, reset on every focus so back never sticks across opens.
  const [facing, setFacing] = useState<Facing>("front");
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [target, setTarget] =
    useState<(typeof CAMERA_TARGETS)[number]>("fleet");
  const [focused, setFocused] = useState(true);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const longPressFired = useRef(false);
  const recordPromise = useRef<Promise<{ uri: string } | undefined> | null>(
    null
  );
  const mounted = useRef(true);
  // oxlint-disable-next-line react/hook-use-state -- single stable Animated.Value created once; driven by the effect below
  const [ringSpin] = useState(() => new Animated.Value(0));
  // The recording ring loops for as long as recording is true. Animated.loop
  // on the native driver keeps the spin off the JS thread, and stopping
  // resets the value so the next recording starts from the top.
  useEffect(() => {
    if (!recording) {
      ringSpin.stopAnimation();
      ringSpin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ringSpin, {
        duration: 1100,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [recording, ringSpin]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setFacing("front");
      logInfo("camera.opened", { facing: "front" });
      void NavigationBar.setVisibilityAsync("hidden");
      return () => {
        setFocused(false);
        // Stop any in-flight recording before the view unmounts so the mic
        // and camera sessions never outlive the page.
        try {
          cameraRef.current?.stopRecording();
        } catch {
          // Already stopped, nothing to do.
        }
        recordPromise.current = null;
        void NavigationBar.setVisibilityAsync("visible");
        logInfo("camera.closed", {});
      };
    }, [])
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Permissions are requested only after the user opens this page, never at
  // boot. Undetermined states auto-prompt once here, denied states render a
  // gate with a settings shortcut instead of looping the system dialog.
  useEffect(() => {
    if (
      !cameraPermission ||
      cameraPermission.granted ||
      !cameraPermission.canAskAgain
    ) {
      return;
    }
    void (async () => {
      try {
        const next = await requestCameraPermission();
        if (!next.granted) {
          logWarn("camera.permission_denied", {});
        }
      } catch (error) {
        logWarn("camera.permission_failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    })();
  }, [cameraPermission, requestCameraPermission]);

  useEffect(() => {
    if (micPermission && !micPermission.granted && micPermission.canAskAgain) {
      void (async () => {
        try {
          await requestMicPermission();
        } catch {
          // Mic stays denied, video records muted.
        }
      })();
    }
  }, [micPermission, requestMicPermission]);

  useEffect(() => {
    if (!focused || !cameraPermission?.granted) {
      return;
    }
    void (async () => {
      const uri = await latestGalleryThumb();
      if (mounted.current) {
        setThumb(uri);
      }
    })();
  }, [focused, cameraPermission?.granted]);

  const close = useCallback(() => {
    haptic();
    router.back();
  }, [router]);

  const toggleFlash = useCallback(() => {
    haptic();
    setFlash((prev) => {
      const next = prev === "on" ? "off" : "on";
      logInfo("camera.flash", { flash: next });
      return next;
    });
  }, []);

  const flip = useCallback(() => {
    if (recording) {
      return;
    }
    haptic();
    setFacing((prev) => {
      const next = prev === "front" ? "back" : "front";
      logInfo("camera.flip", { facing: next });
      return next;
    });
  }, [recording]);

  const openComposerWith = useCallback(
    (uri: string, kind: "photo" | "video") => {
      const picked = pickedFromCapture(uri, kind);
      const mode = composerModeForTarget(target);
      // A photo while gust is selected cannot publish as a gust (video-only),
      // so fall back to fleet instead of stranding the draft.
      const effectiveMode =
        !targetAllowsKind(target, kind) && kind === "photo" ? "post" : mode;
      const result = attachmentActions.add(POST_SCOPE, [picked], {
        gust: effectiveMode === "gust",
        max: MAX_POST_ATTACHMENTS,
        purpose: "post",
        waitForProcessing: false,
      });
      if (result.added === 0) {
        toast({
          description: "Couldn't attach that capture, try again?",
          title: "Capture Failed",
          variant: "destructive",
        });
        return;
      }
      if (!targetAllowsKind(target, kind)) {
        toast({
          description: "Gusts need video, opened as a fleet.",
          title: "Opened As Fleet",
        });
      }
      useComposerStore.getState().open(effectiveMode);
      router.back();
    },
    [router, target]
  );

  const takePhoto = useCallback(async () => {
    if (!cameraReady || capturing || recording) {
      return;
    }
    setCapturing(true);
    haptic();
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        exif: false,
        quality: 1,
      });
      if (!photo?.uri) {
        logError("camera.photo_failed", "empty photo uri");
        toast({
          description: "Couldn't take that photo, try again?",
          title: "Capture Failed",
          variant: "destructive",
        });
        if (mounted.current) {
          setCapturing(false);
        }
        return;
      }
      logInfo("camera.photo", { facing, flash });
      void saveCaptureToGallery(photo.uri);
      const fresh = await latestGalleryThumb();
      if (mounted.current && fresh) {
        setThumb(fresh);
      }
      openComposerWith(photo.uri, "photo");
    } catch (error) {
      logError("camera.photo_failed", error);
      toast({
        description: "Couldn't take that photo, try again?",
        title: "Capture Failed",
        variant: "destructive",
      });
    }
    if (mounted.current) {
      setCapturing(false);
    }
  }, [cameraReady, capturing, recording, facing, flash, openComposerWith]);

  const startVideo = useCallback(async () => {
    if (!cameraReady || capturing || recording) {
      return;
    }
    setRecording(true);
    haptic();
    logInfo("camera.record_start", { facing });
    try {
      // No maxDuration: manual stop on release, per product call.
      const promise = cameraRef.current?.recordAsync();
      if (promise) {
        recordPromise.current = promise;
        const result = await promise;
        recordPromise.current = null;
        if (!mounted.current) {
          return;
        }
        setRecording(false);
        if (result?.uri) {
          logInfo("camera.record_stop", {});
          void saveCaptureToGallery(result.uri);
          openComposerWith(result.uri, "video");
        }
      } else {
        setRecording(false);
      }
    } catch (error) {
      logError("camera.record_failed", error);
      if (mounted.current) {
        setRecording(false);
      }
    }
  }, [cameraReady, capturing, recording, facing, openComposerWith]);

  const stopVideo = useCallback(() => {
    if (!recording) {
      return;
    }
    try {
      cameraRef.current?.stopRecording();
    } catch (error) {
      logWarn("camera.stop_failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      setRecording(false);
    }
  }, [recording]);

  const openGallery = useCallback(async () => {
    haptic();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ["images", "videos"],
        quality: 1,
      });
      if (result.canceled) {
        return;
      }
      const [asset] = result.assets;
      if (!asset) {
        return;
      }
      logInfo("camera.gallery_pick", { type: asset.type ?? "unknown" });
      openComposerWith(asset.uri, asset.type === "video" ? "video" : "photo");
    } catch (error) {
      logError("camera.gallery_failed", error);
      toast({
        description: "Couldn't open your gallery, try again?",
        title: "Gallery Unavailable",
        variant: "destructive",
      });
    }
  }, [openComposerWith]);

  const permissionLoading = !cameraPermission || !micPermission;
  const cameraGranted = cameraPermission?.granted === true;
  const cameraActive = focused && cameraGranted && !permissionLoading;
  const showGate = permissionLoading === false && cameraGranted === false;
  const showDock = permissionLoading === false && cameraGranted === true;
  const showCaptureSpinner = capturing === true && recording === false;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {cameraActive ? (
        <CameraView
          active
          facing={facing}
          flash={flash}
          mirror={facing === "front"}
          onCameraReady={() => setCameraReady(true)}
          onMountError={(event) => {
            logError("camera.mount", new Error(event.message));
            toast({
              description: event.message,
              title: "Camera Unavailable",
              variant: "destructive",
            });
          }}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={styles.previewFallback} />
      )}
      <View
        style={[styles.topRow, { paddingTop: Math.max(insets.top, 12) + 8 }]}
      >
        <RailButton accessibilityLabel="Close camera" onPress={close} size={40}>
          <X color="rgba(255,255,255,0.95)" size={20} />
        </RailButton>
        <RailButton
          accessibilityLabel={
            flash === "on" ? "Turn flash off" : "Turn flash on"
          }
          active={flash === "on"}
          onPress={toggleFlash}
          size={40}
        >
          {flash === "on" ? (
            <Zap color="rgba(255,255,255,0.95)" size={18} />
          ) : (
            <ZapOff color="rgba(255,255,255,0.95)" size={18} />
          )}
        </RailButton>
      </View>
      {permissionLoading ? (
        <View style={styles.centerGate}>
          <ActivityIndicator color="#ffffff" />
          <Text style={styles.gateText}>Warming up the camera…</Text>
        </View>
      ) : null}
      {showGate ? (
        <View style={styles.centerGate}>
          <Text style={styles.gateTitle}>Camera is off</Text>
          <Text style={styles.gateText}>
            Allow camera access to capture fleets and gusts. Nothing runs until
            you do.
          </Text>
          {cameraPermission?.canAskAgain ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void requestCameraPermission();
              }}
              style={styles.gateButton}
            >
              <Text style={styles.gateButtonText}>Allow Camera</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void Linking.openSettings();
              }}
              style={styles.gateButton}
            >
              <Text style={styles.gateButtonText}>Open Settings</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={styles.gateGhost}
          >
            <Text style={styles.gateGhostText}>Not now</Text>
          </Pressable>
        </View>
      ) : null}
      {showDock ? (
        <View style={styles.bottomDock}>
          <View style={styles.shutterRow}>
            <Pressable
              accessibilityLabel={
                recording
                  ? "Release to stop recording"
                  : "Take photo, hold for video"
              }
              accessibilityRole="button"
              delayLongPress={350}
              onLongPress={() => {
                longPressFired.current = true;
                void startVideo();
              }}
              onPress={() => {
                // Suppress the tap that fires after a hold-to-record gesture.
                if (longPressFired.current) {
                  longPressFired.current = false;
                  return;
                }
                void takePhoto();
              }}
              onPressOut={() => {
                if (recording) {
                  stopVideo();
                }
              }}
              style={styles.shutterWrap}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.shutterStage,
                    pressed && !recording && styles.shutterPressed,
                  ]}
                >
                  {/* Recessed track: the dark ring the white core sits in. */}
                  <View
                    style={[
                      styles.shutterTrack,
                      recording && styles.shutterTrackRecording,
                    ]}
                  >
                    {/* Core: glass fill that turns solid red while recording. */}
                    <View
                      style={[
                        styles.shutterCore,
                        recording && styles.shutterCoreRecording,
                      ]}
                    >
                      {showCaptureSpinner ? (
                        <ActivityIndicator color="#8a8a8a" />
                      ) : null}
                    </View>
                  </View>
                  {/* Recording progress: a dash that laps the shutter, drawn
                      above the bezel so it reads as a lit running track. */}
                  {recording ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.ring,
                        {
                          transform: [
                            {
                              rotate: ringSpin.interpolate({
                                inputRange: [0, 1],
                                outputRange: ["0deg", "360deg"],
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <Svg
                        height={RING_SIZE}
                        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                        width={RING_SIZE}
                      >
                        <Circle
                          cx={RING_SIZE / 2}
                          cy={RING_SIZE / 2}
                          fill="none"
                          r={RING_RADIUS}
                          stroke="#ff453a"
                          strokeDasharray={`${RING_CIRCUMFERENCE * 0.28} ${RING_CIRCUMFERENCE}`}
                          strokeLinecap="round"
                          strokeWidth={RING_STROKE}
                        />
                      </Svg>
                    </Animated.View>
                  ) : null}
                </View>
              )}
            </Pressable>
          </View>
          {recording ? (
            <Text style={styles.recHint}>Release to stop</Text>
          ) : null}
          <View
            style={[
              styles.modeRow,
              { paddingBottom: Math.max(insets.bottom, 10) },
            ]}
          >
            <View style={styles.modeSide}>
              <Pressable
                accessibilityLabel="Open gallery"
                accessibilityRole="button"
                onPress={openGallery}
                style={styles.thumbWrap}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.thumb} />
                ) : (
                  <View style={styles.thumbFallback}>
                    <Images color="rgba(255,255,255,0.9)" size={17} />
                  </View>
                )}
              </Pressable>
            </View>
            <View style={styles.targetRow}>
              {CAMERA_TARGETS.map((item) => {
                const active = item === target;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    hitSlop={8}
                    key={item}
                    onPress={() => {
                      haptic();
                      setTarget(item);
                      logInfo("camera.target", { target: item });
                    }}
                    style={styles.targetHit}
                  >
                    <Text
                      style={
                        active ? styles.targetTextActive : styles.targetText
                      }
                    >
                      {TARGET_LABEL[item]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.modeSide}>
              <RailButton
                accessibilityLabel="Flip camera"
                onPress={flip}
                size={40}
              >
                <RefreshCw color="rgba(255,255,255,0.95)" size={18} />
              </RailButton>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bottomDock: {
    alignItems: "center",
    bottom: 0,
    gap: 12,
    left: 0,
    position: "absolute",
    right: 0,
  },
  centerGate: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  gateButton: {
    backgroundColor: "#ff9500",
    borderRadius: 9999,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  gateButtonText: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 14,
  },
  gateGhost: {
    padding: 8,
  },
  gateGhostText: {
    color: "rgba(255,255,255,0.8)",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  gateText: {
    color: "rgba(255,255,255,0.75)",
    fontFamily: "SofiaProReg",
    fontSize: 14,
    textAlign: "center",
  },
  gateTitle: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 20,
  },
  modeRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    width: "100%",
  },
  modeSide: {
    alignItems: "center",
    justifyContent: "center",
    width: 56,
  },
  previewFallback: {
    backgroundColor: "#000000",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  recHint: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: "SofiaProMed",
    fontSize: 12,
  },
  ring: {
    alignItems: "center",
    height: RING_SIZE,
    justifyContent: "center",
    left: (SHUTTER_SIZE - RING_SIZE) / 2,
    position: "absolute",
    top: (SHUTTER_SIZE - RING_SIZE) / 2,
    width: RING_SIZE,
  },
  root: {
    backgroundColor: "#000000",
    flex: 1,
  },
  shutterCore: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "rgba(0, 0, 0, 0.14)",
    borderRadius: 9999,
    borderWidth: 1,
    boxShadow:
      "inset 0 -2px 3px rgba(0, 0, 0, 0.18), inset 0 2px 2px rgba(255, 255, 255, 0.9), 0 1px 2px rgba(0, 0, 0, 0.3)",
    height: 70,
    justifyContent: "center",
    width: 70,
  },
  shutterCoreRecording: {
    backgroundColor: "#ff3b30",
    borderColor: "rgba(0, 0, 0, 0.25)",
    borderRadius: 9999,
    boxShadow:
      "inset 0 -3px 6px rgba(0, 0, 0, 0.35), inset 0 3px 5px rgba(255, 255, 255, 0.35), 0 1px 4px rgba(255, 59, 48, 0.6)",
    height: 70,
    width: 70,
  },
  shutterPressed: {
    transform: [{ scale: 0.95 }],
  },
  shutterRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  shutterStage: {
    alignItems: "center",
    height: SHUTTER_SIZE,
    justifyContent: "center",
    width: SHUTTER_SIZE,
  },
  shutterTrack: {
    alignItems: "center",
    backgroundColor: "#0b0b0b",
    borderRadius: 9999,
    boxShadow:
      "inset 0 2px 5px rgba(0, 0, 0, 0.8), inset 0 -1px 2px rgba(255, 255, 255, 0.1)",
    height: 82,
    justifyContent: "center",
    width: 82,
  },
  shutterTrackRecording: {
    boxShadow:
      "inset 0 2px 5px rgba(0, 0, 0, 0.8), inset 0 -1px 2px rgba(255, 59, 48, 0.3)",
  },
  shutterWrap: {
    borderRadius: 9999,
  },
  targetHit: {
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  targetRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 26,
    justifyContent: "center",
  },
  targetText: {
    color: "rgba(255, 255, 255, 0.55)",
    fontFamily: "SofiaProMed",
    fontSize: 14,
  },
  targetTextActive: {
    color: "#ffffff",
    fontFamily: "SofiaProBold",
    fontSize: 15,
  },
  thumb: {
    borderRadius: 10,
    height: 40,
    width: 40,
  },
  thumbFallback: {
    alignItems: "center",
    backgroundColor: "rgba(18,20,24,0.55)",
    borderRadius: 10,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  thumbWrap: {
    borderRadius: 10,
    height: 40,
    overflow: "hidden",
    width: 40,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: 16,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
