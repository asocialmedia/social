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
import { File } from "expo-file-system";
import { Image } from "expo-image";
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
import { Gradient3D } from "@/components/surface/gradient-3d";
import { POST_SCOPE } from "@/features/composer/components/post-editor";
import { pickPhotosAndVideos } from "@/features/composer/lib/pick-media";
import { useComposerStore } from "@/features/composer/state/composer-store";
import { RailButton } from "@/features/gusts/components/rail-button";
import { MAX_POST_ATTACHMENTS } from "@/features/media-upload/lib/upload-policy";
import type { PickedMedia } from "@/features/media-upload/state/attachment-store";
import { attachmentActions } from "@/features/media-upload/state/attachment-store";
import { haptic } from "@/lib/haptics";
import { logError, logInfo, logWarn } from "@/lib/telemetry";
import { LOGIN_BUTTON_SHADOWS } from "@/theme";

import {
  CAMERA_TARGETS,
  composerModeForTarget,
  pickedFromCapture,
  targetAllowsKind,
} from "../lib/camera-handoff";
import { latestGalleryThumb, saveCaptureToGallery } from "../lib/camera-save";

type Facing = "back" | "front";

const TARGET_LABEL: Record<string, string> = {
  community: "Communities",
  fleet: "Fleets",
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
  const [cameraMode, setCameraMode] = useState<"picture" | "video">("picture");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [capturePreview, setCapturePreview] = useState<string | null>(null);
  const holding = useRef(false);
  const videoRequested = useRef(false);
  const captureBusy = useRef(false);
  const routeActive = useRef(true);
  useEffect(() => {
    if (!recording) {
      return;
    }
    const started = Date.now();
    const timer = setInterval(
      () => setRecordSeconds(Math.floor((Date.now() - started) / 1000)),
      250
    );
    return () => clearInterval(timer);
  }, [recording]);
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
      routeActive.current = true;
      setFocused(true);
      setFacing("front");
      logInfo("camera.opened", { facing: "front" });
      void NavigationBar.setVisibilityAsync("hidden");
      return () => {
        routeActive.current = false;
        holding.current = false;
        videoRequested.current = false;
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
      cameraPermission.status !== "undetermined" ||
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
    if (
      recording ||
      capturing ||
      captureBusy.current ||
      videoRequested.current
    ) {
      return;
    }
    haptic();
    setCameraReady(false);
    setFacing((prev) => {
      const next = prev === "front" ? "back" : "front";
      logInfo("camera.flip", { facing: next });
      return next;
    });
  }, [recording, capturing]);

  const openComposerWith = useCallback(
    (uri: string, kind: "photo" | "video", selected?: PickedMedia) => {
      const picked =
        selected ?? pickedFromCapture(uri, kind, { size: new File(uri).size });
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

  const finishCapture = useCallback(
    async (uri: string, kind: "photo" | "video") => {
      if (mounted.current) {
        setCapturing(true);
        if (kind === "photo") {
          setCapturePreview(uri);
        }
      }
      const result = await saveCaptureToGallery(uri);
      if (!mounted.current || !routeActive.current) {
        return;
      }
      if (!result.saved) {
        toast({
          description:
            result.reason === "denied"
              ? "Allow photo library access in Settings to save captures to your gallery."
              : "Couldn't save to your gallery. The capture is still attached to your draft.",
          title: "Capture kept in your draft",
          variant: "destructive",
        });
      }
      if (kind === "photo") {
        setThumb(uri);
      }
      openComposerWith(uri, kind);
    },
    [openComposerWith]
  );

  const takePhoto = useCallback(async () => {
    if (
      !cameraReady ||
      captureBusy.current ||
      recording ||
      cameraMode !== "picture"
    ) {
      return;
    }
    captureBusy.current = true;
    setCapturing(true);
    haptic("selection");
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        exif: false,
        quality: 1,
      });
      if (photo?.uri) {
        logInfo("camera.photo", { facing, flash });
        await finishCapture(photo.uri, "photo");
      } else {
        toast({
          description: "The camera returned no photo. Try again.",
          title: "Capture Failed",
          variant: "destructive",
        });
      }
    } catch (error) {
      logError("camera.photo_failed", error);
      if (mounted.current && routeActive.current) {
        toast({
          description: "Couldn't take that photo, try again?",
          title: "Capture Failed",
          variant: "destructive",
        });
      }
    }
    captureBusy.current = false;
    if (mounted.current) {
      setCapturing(false);
      setCapturePreview(null);
    }
  }, [cameraReady, recording, cameraMode, facing, flash, finishCapture]);

  const startVideo = useCallback(async () => {
    if (!videoRequested.current || !holding.current || captureBusy.current) {
      return;
    }
    videoRequested.current = false;
    captureBusy.current = true;
    setRecordSeconds(0);
    setRecording(true);
    haptic("selection");
    try {
      const promise = cameraRef.current?.recordAsync();
      if (promise) {
        recordPromise.current = promise;
        const result = await promise;
        recordPromise.current = null;
        if (mounted.current) {
          setRecording(false);
          setCapturing(true);
        }
        if (result?.uri && routeActive.current) {
          await finishCapture(result.uri, "video");
        } else if (routeActive.current) {
          toast({
            description:
              "No video was recorded. Hold the shutter a little longer.",
            title: "Recording failed",
            variant: "destructive",
          });
        }
      } else {
        toast({
          description: "The camera isn't ready to record. Try again.",
          title: "Recording failed",
          variant: "destructive",
        });
      }
    } catch (error) {
      logError("camera.record_failed", error);
      if (mounted.current && routeActive.current) {
        toast({
          description:
            "Couldn't record that video. Hold the shutter to try again.",
          title: "Recording failed",
          variant: "destructive",
        });
      }
    }
    recordPromise.current = null;
    captureBusy.current = false;
    if (mounted.current) {
      setRecording(false);
      setCapturing(false);
      setCameraReady(false);
      setCameraMode("picture");
    }
  }, [finishCapture]);

  const requestVideo = useCallback(async () => {
    if (!cameraReady || captureBusy.current || recording) {
      return;
    }
    const permission = micPermission?.granted
      ? micPermission
      : await requestMicPermission();
    if (!holding.current || !routeActive.current) {
      return;
    }
    if (!permission.granted) {
      toast({
        description: "Allow microphone access in Settings to include audio.",
        title: "Recording without sound",
      });
    }
    videoRequested.current = true;
    setCameraReady(false);
    setCameraMode("video");
  }, [cameraReady, recording, micPermission, requestMicPermission]);

  const stopVideo = useCallback(() => {
    holding.current = false;
    if (videoRequested.current) {
      videoRequested.current = false;
      setCameraReady(false);
      setCameraMode("picture");
      return;
    }
    if (!recordPromise.current) {
      return;
    }
    setCapturing(true);
    try {
      cameraRef.current?.stopRecording();
    } catch (error) {
      logError("camera.stop_failed", error);
    }
  }, []);

  const openGallery = useCallback(async () => {
    if (captureBusy.current || videoRequested.current) {
      return;
    }
    haptic();
    try {
      const [asset] = await pickPhotosAndVideos({ remaining: 1 });
      if (!asset) {
        return;
      }
      const kind = asset.mimeType.startsWith("video/") ? "video" : "photo";
      logInfo("camera.gallery_pick", { kind });
      openComposerWith(asset.uri, kind, asset);
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

  let captureStatus = "Tap for photo · Hold for video";
  if (cameraMode === "video") {
    captureStatus = "Preparing video…";
  }
  if (capturing) {
    captureStatus = "Saving capture…";
  }
  if (recording && !capturing) {
    captureStatus = `● ${Math.floor(recordSeconds / 60)
      .toString()
      .padStart(
        2,
        "0"
      )}:${(recordSeconds % 60).toString().padStart(2, "0")} · Release to stop`;
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {cameraActive ? (
        <CameraView
          active
          key={`${facing}:${cameraMode}`}
          mode={cameraMode}
          mute={!micPermission?.granted}
          facing={facing}
          flash={flash}
          mirror={facing === "front"}
          onCameraReady={() => {
            setCameraReady(true);
            if (
              cameraMode === "video" &&
              videoRequested.current &&
              holding.current
            ) {
              void startVideo();
            }
          }}
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
      {capturePreview ? (
        <Image
          source={{ uri: capturePreview }}
          contentFit="cover"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
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
          <View style={styles.recordStatus} pointerEvents="none">
            <Text style={styles.recHint}>{captureStatus} </Text>
          </View>
          <View style={styles.shutterRow}>
            <View style={styles.modeSide}>
              <Pressable
                accessibilityLabel="Open gallery"
                accessibilityRole="button"
                hitSlop={10}
                disabled={capturing || recording || cameraMode === "video"}
                onPress={openGallery}
                style={styles.thumbWrap}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.thumb} />
                ) : (
                  <View style={styles.thumbFallback}>
                    <Images color="rgba(255,255,255,0.9)" size={16} />
                  </View>
                )}
              </Pressable>
            </View>
            <Pressable
              accessibilityLabel={
                recording
                  ? "Release to stop recording"
                  : "Take photo, hold for video"
              }
              accessibilityRole="button"
              delayLongPress={350}
              disabled={capturing}
              onPressIn={() => {
                holding.current = true;
                longPressFired.current = false;
              }}
              onLongPress={() => {
                longPressFired.current = true;
                void requestVideo();
              }}
              onPress={() => {
                // Suppress the tap that fires after a hold-to-record gesture.
                if (longPressFired.current) {
                  longPressFired.current = false;
                  return;
                }
                void takePhoto();
              }}
              onPressOut={stopVideo}
              style={styles.shutterWrap}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.shutterStage,
                    pressed && !recording && styles.shutterPressed,
                  ]}
                >
                  <View>
                    <Gradient3D
                      colors={
                        recording
                          ? ["#ff594c", "#d92319"]
                          : ["#ffad20", "#f06b00"]
                      }
                      shadows={LOGIN_BUTTON_SHADOWS}
                      radius={9999}
                      style={styles.shutterCore}
                    >
                      {recording ? <View style={styles.stopMark} /> : null}
                      {showCaptureSpinner ? (
                        <ActivityIndicator color="#ffffff" />
                      ) : null}
                    </Gradient3D>
                  </View>
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
          <View
            style={[
              styles.modeRow,
              { paddingBottom: Math.max(insets.bottom, 10) },
            ]}
          >
            <View style={styles.targetRow}>
              {CAMERA_TARGETS.map((item) => {
                const active = item === target;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    disabled={capturing || recording || cameraMode === "video"}
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
  recordStatus: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 22,
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
  shutterCore: { height: 70, width: 70 },
  shutterPressed: {
    transform: [{ scale: 0.95 }],
  },
  shutterRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    width: "100%",
  },
  shutterStage: {
    alignItems: "center",
    height: SHUTTER_SIZE,
    justifyContent: "center",
    width: SHUTTER_SIZE,
  },
  shutterWrap: {
    borderRadius: 9999,
  },
  stopMark: {
    backgroundColor: "#ffffff",
    borderRadius: 7,
    boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
    height: 25,
    width: 25,
  },
  targetHit: {
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  targetRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 22,
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
    height: 34,
    width: 34,
  },
  thumbFallback: {
    alignItems: "center",
    backgroundColor: "rgba(18,20,24,0.55)",
    borderRadius: 10,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  thumbWrap: {
    borderRadius: 10,
    height: 34,
    overflow: "hidden",
    width: 34,
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
