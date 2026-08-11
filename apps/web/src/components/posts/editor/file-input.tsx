import { Button } from "@asm/ui/shadui/button";
import { FileAudioIcon, FileCode, FileIcon, ImageIcon } from "lucide-react";
import {
  type ChangeEvent,
  type RefObject,
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
  inputRef: RefObject<HTMLInputElement | null>;
  isMobile: boolean;
  label: string;
  setHoveredButton: (button: FileButtonType | null) => void;
  type: FileButtonType;
}

const useIsMobile = () => {
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
  isMobile,
  disabled,
  handleFileSelect,
}: FileButtonProps) => {
  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, [inputRef]);

  const handleMouseEnter = useCallback(() => {
    if (!isMobile) {
      setHoveredButton(type);
    }
  }, [isMobile, setHoveredButton, type]);

  const handleMouseLeave = useCallback(() => {
    if (!isMobile) {
      setHoveredButton(null);
    }
  }, [isMobile, setHoveredButton]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      handleFileSelect(e.target.files);
      e.target.value = "";
    },
    [handleFileSelect]
  );

  const isHovered = hoveredButton === buttonType;

  const ButtonContent = (
    <Button
      className={cn(
        "relative rounded-lg transition-all duration-200",
        isHovered ? "bg-muted/70" : "hover:bg-muted/40",
        disabled && "cursor-not-allowed opacity-50"
      )}
      disabled={disabled}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      variant="ghost"
    >
      <span className="relative z-10 flex items-center gap-1.5">
        <Icon className="text-muted-foreground" size={20} />
        <span
          className={cn(
            "max-w-0 overflow-hidden whitespace-nowrap font-medium text-muted-foreground text-xs transition-all duration-200 ease-in-out",
            isHovered && "max-w-32"
          )}
        >
          {label}
        </span>
      </span>
    </Button>
  );

  return (
    <>
      {isMobile ? (
        <>
          {ButtonContent}
          <input
            accept={accept}
            capture={capture}
            className="sr-only"
            multiple
            onChange={handleChange}
            ref={inputRef}
            type="file"
          />
        </>
      ) : (
        <>
          {ButtonContent}
          <input
            accept={accept}
            capture={capture}
            className="sr-only"
            multiple
            onChange={handleChange}
            ref={inputRef}
            type="file"
          />
        </>
      )}
    </>
  );
};

export function FileInput({ onFilesSelected, disabled }: FileInputProps) {
  const isMobile = useIsMobile();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const [hoveredButton, setHoveredButton] = useState<FileButtonType | null>(
    null
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
    <>
      {isMobile ? (
        <div className="flex items-center gap-3">
          <FileButton
            accept="image/*,video/*,.png,.jpg,.jpeg,.gif,.mp4,.mov,.avi"
            buttonType="image"
            capture="environment"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={ImageIcon}
            inputRef={imageInputRef}
            isMobile={isMobile}
            label="Photos & Videos"
            setHoveredButton={setHoveredButton}
            type="image"
          />
          <FileButton
            accept="audio/*,.mp3,.wav,.ogg,.m4a"
            buttonType="audio"
            capture="user"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={FileAudioIcon}
            inputRef={audioInputRef}
            isMobile={isMobile}
            label="Audio Files"
            setHoveredButton={setHoveredButton}
            type="audio"
          />
          <FileButton
            accept=".pdf,.doc,.docx,.txt,.md"
            buttonType="document"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={FileIcon}
            inputRef={documentInputRef}
            isMobile={isMobile}
            label="Documents"
            setHoveredButton={setHoveredButton}
            type="document"
          />
          <FileButton
            accept=".ts,.tsx,.js,.jsx,.html,.css,.scss,.less,.json,.md,.py,.java,.c,.cpp,.cs,.rb,.php,.rs,.go,.kt,.swift,.xml,.yaml,.yml,.sql"
            buttonType="code"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={FileCode}
            inputRef={codeInputRef}
            isMobile={isMobile}
            label="Code Files"
            setHoveredButton={setHoveredButton}
            type="code"
          />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <FileButton
            accept="image/*,video/*,.png,.jpg,.jpeg,.gif,.mp4,.mov,.avi"
            buttonType="image"
            capture="environment"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={ImageIcon}
            inputRef={imageInputRef}
            isMobile={isMobile}
            label="Photos & Videos"
            setHoveredButton={setHoveredButton}
            type="image"
          />
          <FileButton
            accept="audio/*,.mp3,.wav,.ogg,.m4a"
            buttonType="audio"
            capture="user"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={FileAudioIcon}
            inputRef={audioInputRef}
            isMobile={isMobile}
            label="Audio Files"
            setHoveredButton={setHoveredButton}
            type="audio"
          />
          <FileButton
            accept=".pdf,.doc,.docx,.txt,.md"
            buttonType="document"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={FileIcon}
            inputRef={documentInputRef}
            isMobile={isMobile}
            label="Documents"
            setHoveredButton={setHoveredButton}
            type="document"
          />
          <FileButton
            accept=".ts,.tsx,.js,.jsx,.html,.css,.scss,.less,.json,.md,.py,.java,.c,.cpp,.cs,.rb,.php,.rs,.go,.kt,.swift,.xml,.yaml,.yml,.sql"
            buttonType="code"
            disabled={disabled}
            handleFileSelect={handleFileSelect}
            hoveredButton={hoveredButton}
            icon={FileCode}
            inputRef={codeInputRef}
            isMobile={isMobile}
            label="Code Files"
            setHoveredButton={setHoveredButton}
            type="code"
          />
        </div>
      )}
    </>
  );
}
