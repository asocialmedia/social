import { FileAudioIcon, ImageIcon, Video } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { cn } from "@/lib/utils";

interface FileInputProps {
  disabled: boolean;
  // Button types that are individually locked (e.g. audio when the draft
  // already carries a video or a GIF) while sibling buttons stay available.
  disabledTypes?: FileButtonType[];
  // Per-type lock reason shown as a native tooltip on the disabled button.
  explanations?: Partial<Record<FileButtonType, string>>;
  onFilesSelected: (files: File[]) => void;
  // Restrict which file buttons render; undefined = all. videoOnly (gusts)
  // keeps only the image button regardless.
  types?: FileButtonType[];
  videoOnly?: boolean;
}

export type FileButtonType = "image" | "audio";

interface FileButtonProps {
  accept: string;
  buttonType: FileButtonType;
  capture?: boolean | "user" | "environment";
  disabled: boolean;
  // Native tooltip explaining why the button is disabled (disabled buttons
  // swallow pointer events, so a title is the reliable way to surface this).
  explanation?: string;
  handleFileSelect: (files: FileList | null) => void;
  hoveredButton: FileButtonType | null;
  icon: typeof ImageIcon | typeof FileAudioIcon;
  inputRef: (node: HTMLInputElement | null) => void;
  label: string;
  setHoveredButton: (button: FileButtonType | null) => void;
  type: FileButtonType;
  videoOnly?: boolean;
}

const FileButton = ({
  icon: Icon,
  label,
  type,
  accept,
  inputRef,
  buttonType,
  capture,
  hoveredButton,
  setHoveredButton,
  disabled,
  explanation,
  handleFileSelect,
  videoOnly = false,
}: FileButtonProps) => {
  const [isFocused, setIsFocused] = useState(false);
  const innerRef = useRef<HTMLInputElement | null>(null);

  const handleRef = useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      inputRef(node);
    },
    [inputRef]
  );

  const handleClick = useCallback(() => {
    innerRef.current?.click();
  }, []);
  const handleMouseEnter = useCallback(() => {
    setHoveredButton(type);
  }, [setHoveredButton, type]);

  const handleMouseLeave = useCallback(() => {
    setHoveredButton(null);
  }, [setHoveredButton]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    setHoveredButton(type);
  }, [setHoveredButton, type]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setHoveredButton(null);
  }, [setHoveredButton]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      handleFileSelect(e.target.files);
      e.target.value = "";
    },
    [handleFileSelect]
  );

  const isHovered = hoveredButton === buttonType || isFocused;

  return (
    <>
      <button
        aria-label={label}
        aria-disabled={disabled || undefined}
        className={cn(
          "pill-3d-hover group text-muted-foreground inline-flex h-8 items-center justify-center rounded-full border-0 px-2 text-sm font-medium active:translate-y-px",
          disabled &&
            "hover:from-none hover:to-none cursor-not-allowed opacity-50 hover:bg-none hover:shadow-none"
        )}
        disabled={disabled}
        onBlur={handleBlur}
        onClick={handleClick}
        onFocus={handleFocus}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={disabled ? explanation : undefined}
        type="button"
      >
        <span className="flex items-center gap-1.5">
          {videoOnly ? (
            <Video className="size-[18px]" size={18} />
          ) : (
            <Icon className="size-[18px]" size={18} />
          )}
          <span
            className={cn(
              "max-w-0 overflow-hidden text-xs font-medium whitespace-nowrap transition-all duration-200 ease-in-out",
              // On mobile, keep icon-only button - disable label expansion even on hover/focus
              isHovered && "md:max-w-32"
            )}
          >
            {videoOnly ? "Video" : label}
          </span>
        </span>
      </button>
      <input
        accept={videoOnly ? "video/*,.mp4,.mov,.avi,.webm" : accept}
        aria-label={videoOnly ? "Upload video" : label}
        capture={capture}
        className="sr-only"
        multiple={!videoOnly}
        onChange={handleChange}
        ref={handleRef}
        type="file"
      />
    </>
  );
};

const FILE_BUTTONS: Omit<
  FileButtonProps,
  | "inputRef"
  | "hoveredButton"
  | "setHoveredButton"
  | "disabled"
  | "handleFileSelect"
  | "videoOnly"
>[] = [
  {
    accept: "image/*,video/*,.png,.jpg,.jpeg,.gif,.mp4,.mov,.avi",
    buttonType: "image",
    capture: "environment",
    icon: ImageIcon,
    label: "Photos & Videos",
    type: "image",
  },
  {
    accept: "audio/*,.mp3,.wav,.ogg,.m4a",
    buttonType: "audio",
    capture: "user",
    icon: FileAudioIcon,
    label: "Audio Files",
    type: "audio",
  },
];

export const FileInput = ({
  onFilesSelected,
  disabled,
  disabledTypes,
  explanations,
  types,
  videoOnly = false,
}: FileInputProps) => {
  const inputRefs = useRef<Record<FileButtonType, HTMLInputElement | null>>({
    audio: null,
    image: null,
  });

  const [hoveredButton, setHoveredButton] = useState<FileButtonType | null>(
    null
  );

  const setInputRef = useCallback(
    (type: FileButtonType) => (node: HTMLInputElement | null) => {
      inputRefs.current[type] = node;
    },
    []
  );

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      const fileArray = [...(files || [])];
      if (fileArray.length) {
        onFilesSelected(fileArray);
      }
    },
    [onFilesSelected]
  );

  // videoOnly (gusts) reduces to just the image/video button; otherwise filter
  // by the explicit `types` list when provided.
  const buttons = FILE_BUTTONS.filter(
    (config) => !videoOnly || config.buttonType === "image"
  ).filter((config) => !types || types.includes(config.buttonType));

  return (
    <div className="flex items-center gap-1.5">
      {buttons.map((config) => (
        <FileButton
          {...config}
          disabled={
            disabled || Boolean(disabledTypes?.includes(config.buttonType))
          }
          explanation={explanations?.[config.buttonType]}
          handleFileSelect={handleFileSelect}
          hoveredButton={hoveredButton}
          inputRef={setInputRef(config.buttonType)}
          key={config.buttonType}
          setHoveredButton={setHoveredButton}
          videoOnly={videoOnly}
        />
      ))}
    </div>
  );
};
