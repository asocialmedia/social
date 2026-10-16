"use dom";

import { encodeProfileCrop } from "@asm/media/image-edit";
import { CROPPER_ACCENT } from "@asm/ui/lib/cropper-accent";
import { Asset } from "expo-asset";
import type { DOMProps } from "expo/dom";
import { useEffect, useRef, useState } from "react";
import { Cropper } from "react-cropper";
import type { ReactCropperElement } from "react-cropper";

import sofiaFont from "../../../../assets/fonts/SofiaProSoftReg.ttf";
import avatarPlaceholder from "../../../../assets/images/avatar-placeholder.png";

import "cropperjs/dist/cropper.css";
import "./profile-crop-engine.css";

function ControlIcon({
  name,
}: {
  name: "left" | "right" | "plus" | "minus" | "close";
}) {
  let paths = ["M18 6 6 18", "m6 6 12 12"];
  if (name === "left") {
    paths = ["M3 11a9 9 0 1 1 2.6 6.4", "M3 4v7h7"];
  }
  if (name === "right") {
    paths = ["M21 11a9 9 0 1 0-2.6 6.4", "M21 4v7h-7"];
  }
  if (name === "plus" || name === "minus") {
    paths = ["m21 21-4.3-4.3", "M8 11h6"];
  }
  if (name === "plus") {
    paths.push("M11 8v6");
  }
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "plus" || name === "minus" ? (
        <circle cx="11" cy="11" r="8" />
      ) : null}
      {paths.map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}

export default function ProfileCropEngine({
  animated,
  dataUrl,
  isDark,
  kind,
  onComplete,
  onCancel,
  onError,
}: {
  animated: boolean;
  dataUrl: string;
  dom: DOMProps;
  isDark: boolean;
  kind: "avatar" | "banner" | "post";
  onComplete: (result: {
    dataUrl: string;
    width: number;
    height: number;
  }) => Promise<void>;
  onCancel: () => Promise<void>;
  onError: (message: string) => Promise<void>;
}) {
  const cropperRef = useRef<ReactCropperElement>(null);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async () => {
    const cropper = cropperRef.current?.cropper;
    if (!cropper || !ready || saving) {
      return;
    }
    setSaving(true);
    setCropError(null);
    try {
      const crop = cropper.getData();
      const width = Math.max(
        1,
        Math.round(
          Math.min(
            kind === "avatar" ? 512 : 1500,
            crop.width,
            (2000 * crop.width) / crop.height
          )
        )
      );
      const height = Math.max(
        1,
        Math.round((width * crop.height) / crop.width)
      );
      const result = await encodeProfileCrop(
        dataUrl,
        animated,
        crop.width / crop.height,
        { x: 0, y: 0, zoom: 1 },
        { crop, outputWidth: width, rotation: crop.rotate }
      );
      if (mounted.current) {
        await onComplete({ dataUrl: result, height, width });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save this crop";
      if (mounted.current) {
        setCropError(message);
        await onError(message);
      }
    }
    if (mounted.current) {
      setSaving(false);
    }
  };
  // oxlint-disable react/refs -- Callbacks access the cropper only when a button is pressed.
  const controls: {
    label: string;
    icon: "left" | "right" | "plus" | "minus";
    handleClick: () => void;
  }[] = [];
  if (kind !== "post") {
    controls.push(
      {
        handleClick: () => cropperRef.current?.cropper.zoom(-0.1),
        icon: "minus",
        label: "Zoom out",
      },
      {
        handleClick: () => cropperRef.current?.cropper.zoom(0.1),
        icon: "plus",
        label: "Zoom in",
      }
    );
  }
  controls.push(
    {
      handleClick: () => cropperRef.current?.cropper.rotate(-90),
      icon: "left",
      label: "Rotate left",
    },
    {
      handleClick: () => cropperRef.current?.cropper.rotate(90),
      icon: "right",
      label: "Rotate right",
    }
  );
  // oxlint-enable react/refs
  let aspectRatio: number | undefined;
  if (kind === "avatar") {
    aspectRatio = 1;
  }
  if (kind === "banner") {
    aspectRatio = 3;
  }
  const saveLabel = kind === "post" ? "Save" : "Apply crop";
  return (
    <div className={isDark ? "native-crop-dialog dark" : "native-crop-dialog"}>
      <style>
        {`@font-face { font-family: SofiaPro; src: url("${Asset.fromModule(sofiaFont).uri}"); }`}
        {CROPPER_ACCENT}
      </style>
      <header className="native-crop-header">
        {kind === "post" ? null : (
          // oxlint-disable-next-line next/no-img-element -- Expo DOM uses a bundled image without Next.js.
          <img
            src={Asset.fromModule(avatarPlaceholder).uri}
            alt=""
            className="native-crop-avatar"
          />
        )}
        <div className="native-crop-heading">
          <h1>
            {kind === "post" ? "Edit" : "Crop"} {animated ? "GIF" : "Image"}
          </h1>
          <p>
            {animated
              ? "Crop and rotate while keeping the animation"
              : "Adjust your photo before saving"}
          </p>
        </div>
        <button
          className="native-crop-close"
          type="button"
          aria-label="Close"
          onClick={() => {
            void onCancel();
          }}
        >
          <ControlIcon name="close" />
        </button>
      </header>
      <div className="native-crop-body">
        <div className="native-crop-preview">
          <Cropper
            aspectRatio={aspectRatio}
            className="asm-cropper"
            guides={false}
            ref={cropperRef}
            src={dataUrl}
            viewMode={1}
            ready={() => setReady(true)}
          />
        </div>
        <div className="native-crop-controls">
          {controls.map((control) => (
            <button
              aria-label={control.label}
              key={control.label}
              type="button"
              disabled={saving || !ready}
              onClick={() => control.handleClick()}
            >
              <ControlIcon name={control.icon} />
            </button>
          ))}
        </div>
        {cropError ? (
          <p className="native-crop-error" role="alert">
            {cropError}
          </p>
        ) : null}
        <footer className="native-crop-footer">
          <button
            type="button"
            onClick={() => {
              void onCancel();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="native-crop-save"
            disabled={saving || !ready}
            onClick={() => {
              void save();
            }}
          >
            {saving ? "Processing…" : saveLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
