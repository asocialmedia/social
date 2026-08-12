import { FileAudioIcon, FileCode, FileIcon, ImageIcon } from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

interface FileInputProps {
  disabled: boolean;
  onFilesSelected: (files: File[]) => void;
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
}

const _useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
};

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
          "group inline-flex h-8 items-center justify-center rounded-full border-0 px-2 font-medium text-muted-foreground text-sm outline-none transition-all duration-200 ease-out hover:bg-gradient-to-b hover:from-[#8f96a3] hover:to-[#5c6370] hover:text-white hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1.5px_2px_rgba(255,255,255,0.5),0_0_0_1px_rgba(45,50,60,0.95),0_1px_1px_rgba(255,255,255,0.4),0_3px_5px_rgba(0,0,0,0.12)] active:translate-y-px",
          disabled &&
            "cursor-not-allowed opacity-50 hover:bg-none hover:from-none hover:to-none hover:shadow-none"
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
          <Icon className="size-5" size={20} />
          <span
            className={cn(
              "max-w-0 overflow-hidden whitespace-nowrap font-medium text-xs transition-all duration-200 ease-in-out",
              isHovered && "max-w-32"
            )}
          >
            {label}
          </span>
        </span>
      </button>
      <input
        accept={accept}
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

export function FileInput({ onFilesSelected, disabled }: FileInputProps) {
  const inputRefs = useRef<Record<FileButtonType, HTMLInputElement | null>>({
    image: null,
    audio: null,
    document: null,
    code: null,
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
      const fileArray = Array.from(files || []);
      if (fileArray.length) {
        onFilesSelected(fileArray);
      }
    },
    [onFilesSelected]
  );

  return (
    <div className="flex items-center gap-1.5">
      {FILE_BUTTONS.map((config) => (
        <FileButton
          {...config}
          disabled={disabled}
          handleFileSelect={handleFileSelect}
          hoveredButton={hoveredButton}
          inputRef={setInputRef(config.buttonType)}
          key={config.buttonType}
          setHoveredButton={setHoveredButton}
        />
      ))}
    </div>
  );
}
