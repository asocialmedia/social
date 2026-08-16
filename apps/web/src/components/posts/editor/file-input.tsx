import {
  FileAudioIcon,
  FileCode,
  FileIcon,
  ImageIcon,
  Video,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import { cn } from "@/lib/utils";

interface FileInputProps {
  disabled: boolean;
  onFilesSelected: (files: File[]) => void;
  // Restrict which file buttons render; undefined = all. videoOnly (gusts)
  // keeps only the image button regardless.
  types?: FileButtonType[];
  videoOnly?: boolean;
}

type FileButtonType = "image" | "audio" | "document" | "code";

interface FileButtonProps {
  accept: string;
  buttonType: FileButtonType;
  capture?: boolean | "user" | "environment";
  disabled: boolean;
  handleFileSelect: (files: FileList | null) => void;
  hoveredButton: FileButtonType | null;
  icon:
    | typeof ImageIcon
    | typeof FileAudioIcon
    | typeof FileIcon
    | typeof FileCode;
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
        type="button"
      >
        <span className="flex items-center gap-1.5">
          {videoOnly ? (
            <Video className="size-5" size={20} />
          ) : (
            <Icon className="size-5" size={20} />
          )}
          <span
            className={cn(
              "max-w-0 overflow-hidden text-xs font-medium whitespace-nowrap transition-all duration-200 ease-in-out",
              isHovered && "max-w-32"
            )}
          >
            {videoOnly ? "Video" : label}
          </span>
        </span>
      </button>
      <input
        accept={accept}
        aria-label={label}
        capture={capture}
        className="sr-only"
        multiple
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
  {
    accept: ".pdf,.doc,.docx,.txt,.md",
    buttonType: "document",
    icon: FileIcon,
    label: "Documents",
    type: "document",
  },
  {
    accept:
      ".ts,.tsx,.js,.jsx,.html,.css,.scss,.less,.json,.md,.py,.java,.c,.cpp,.cs,.rb,.php,.rs,.go,.kt,.swift,.xml,.yaml,.yml,.sql",
    buttonType: "code",
    icon: FileCode,
    label: "Code Files",
    type: "code",
  },
];

export const FileInput = ({
  onFilesSelected,
  disabled,
  types,
  videoOnly = false,
}: FileInputProps) => {
  const inputRefs = useRef<Record<FileButtonType, HTMLInputElement | null>>({
    audio: null,
    code: null,
    document: null,
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
          disabled={disabled}
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
