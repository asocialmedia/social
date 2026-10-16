// oxlint-disable promise/avoid-new -- The crop UI resolves a promise when the user applies or cancels.
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, View, useWindowDimensions } from "react-native";

import { toast } from "@/components/feedback/toast";
import { SettingsCard } from "@/features/settings/components/settings-ui";
import { useAppTheme } from "@/theme";

import type {
  PickedProfileImage,
  ProfileImageKind,
} from "../lib/profile-media";
import { isAnimatedImage, isTooLarge } from "../lib/profile-media-crop";
import ProfileCropEngine from "./profile-crop-engine";

interface CropRequest {
  dataUrl: string;
  kind: ProfileImageKind | "post";
  picked: PickedProfileImage;
  resolve: (result: PickedProfileImage | null) => void;
}

export function useProfileMediaCropper() {
  const [request, setRequest] = useState<CropRequest | null>(null);
  const pending = useRef<CropRequest | null>(null);
  const finish = useCallback((result: PickedProfileImage | null) => {
    pending.current?.resolve(result);
    pending.current = null;
    setRequest(null);
  }, []);
  useEffect(() => () => pending.current?.resolve(null), []);
  const crop = useCallback(
    async (picked: PickedProfileImage, kind: ProfileImageKind | "post") => {
      const dimensions =
        picked.source.width && picked.source.height
          ? null
          : await Image.loadAsync(picked.source.uri);
      const measured = dimensions
        ? {
            ...picked,
            source: {
              ...picked.source,
              height: dimensions.height,
              width: dimensions.width,
            },
          }
        : picked;
      const base64 = await new File(picked.source.uri).base64();
      return await new Promise<PickedProfileImage | null>((resolve) => {
        pending.current?.resolve(null);
        const next = {
          dataUrl: `data:${picked.source.mimeType};base64,${base64}`,
          kind,
          picked: measured,
          resolve,
        };
        pending.current = next;
        setRequest(next);
      });
    },
    []
  );
  return {
    crop,
    cropper: request ? (
      <ProfileMediaCropper
        key={request.picked.source.uri}
        onFinish={finish}
        request={request}
      />
    ) : null,
  };
}

function ProfileMediaCropper({
  onFinish,
  request,
}: {
  onFinish: (result: PickedProfileImage | null) => void;
  request: CropRequest;
}) {
  const { isDark } = useAppTheme();
  const window = useWindowDimensions();
  const height = Math.min(
    window.height * 0.75,
    request.kind === "post" ? 620 : 580
  );
  const { source } = request.picked;
  const animated = isAnimatedImage(source.mimeType, source.name);
  const complete = (result: {
    dataUrl: string;
    width: number;
    height: number;
  }) => {
    const encoded = result.dataUrl.slice(result.dataUrl.indexOf(",") + 1);
    const bytes = Uint8Array.from(
      atob(encoded),
      (character) => character.codePointAt(0) ?? 0
    );
    if (
      request.kind === "post"
        ? bytes.length > 50 * 1024 * 1024
        : isTooLarge(bytes.length)
    ) {
      throw new Error("The cropped image is too large. Try a smaller crop.");
    }
    const extension = animated ? "gif" : "png";
    const target = new File(
      Paths.cache,
      `${request.kind}-crop-${Date.now()}.${extension}`
    );
    target.write(bytes);
    onFinish({
      ...request.picked,
      source: {
        ...source,
        height: result.height,
        mimeType: animated ? "image/gif" : "image/png",
        name: `${request.kind}.${extension}`,
        size: bytes.length,
        uri: target.uri,
        width: result.width,
      },
    });
    return Promise.resolve();
  };
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => onFinish(null)}
    >
      <View
        style={{
          backgroundColor: "rgba(0,0,0,0.6)",
          flex: 1,
          justifyContent: "center",
          padding: 16,
        }}
      >
        <SettingsCard
          padded={false}
          style={{
            alignSelf: "center",
            borderRadius: 16,
            maxWidth: 480,
            overflow: "hidden",
            width: "100%",
          }}
        >
          <ProfileCropEngine
            animated={animated}
            dataUrl={request.dataUrl}
            isDark={isDark}
            kind={request.kind}
            onComplete={complete}
            onCancel={() => {
              onFinish(null);
              return Promise.resolve();
            }}
            onError={(message) => {
              toast({
                description: message,
                title: "Couldn't crop",
                variant: "destructive",
              });
              return Promise.resolve();
            }}
            dom={{
              containerStyle: {
                backgroundColor: "transparent",
                flex: 0,
                height,
              },
              onError: () => {
                toast({
                  title: "Could not load the image editor",
                  variant: "destructive",
                });
                onFinish(null);
              },
              scrollEnabled: false,
              style: {
                backgroundColor: "transparent",
                flex: 0,
                height,
                width: "100%",
              },
              useExpoDOMWebView: true,
            }}
          />
        </SettingsCard>
      </View>
    </Modal>
  );
}
