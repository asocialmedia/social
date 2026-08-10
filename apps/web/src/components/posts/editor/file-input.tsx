import { Button } from "@asm/ui/shadui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
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

  const ButtonContent = (
    <Button
      className={cn(
        "relative overflow-hidden transition-all duration-300 ease-in-out",
        "hover:scale-110 active:scale-95",
        "before:absolute before:inset-0 before:z-0 before:opacity-0 before:transition-opacity",
        "before:duration-300 before:ease-in-out hover:before:opacity-100",
        hoveredButton === buttonType ? "ring-2 ring-primary" : "",
        buttonType === "image" &&
          "before:bg-gradient-to-r before:from-pink-500/10 before:to-purple-500/10",
        buttonType === "audio" &&
          "before:bg-gradient-to-r before:from-blue-500/10 before:to-cyan-500/10",
        buttonType === "document" &&
          "before:bg-gradient-to-r before:from-green-500/10 before:to-emerald-500/10",
        buttonType === "code" &&
          "before:bg-gradient-to-r before:from-orange-500/10 before:to-amber-500/10",
        disabled && "cursor-not-allowed opacity-50"
      )}
      disabled={disabled}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      size="icon"
      variant="ghost"
    >
      <Icon
        className={cn(
          "relative z-10 text-muted-foreground transition-transform duration-300",
          hoveredButton === buttonType && "rotate-12 transform"
        )}
        size={20}
      />
      <span
        className={cn(
          "absolute inset-0 z-0 bg-gradient-to-r opacity-0 transition-opacity duration-300",
          hoveredButton === buttonType && "opacity-10"
        )}
      />
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
        <Tooltip>
          <TooltipTrigger asChild>{ButtonContent}</TooltipTrigger>
          <TooltipContent
            className={cn(
              "fade-in-50 zoom-in-95 animate-in",
              "bg-gradient-to-r shadow-lg",
              buttonType === "image" && "from-pink-500/5 to-purple-500/5",
              buttonType === "audio" && "from-blue-500/5 to-cyan-500/5",
              buttonType === "document" && "from-green-500/5 to-emerald-500/5",
              buttonType === "code" && "from-orange-500/5 to-amber-500/5"
            )}
          >
            <p className="font-medium">{label}</p>
          </TooltipContent>
          <input
            accept={accept}
            capture={capture}
            className="sr-only"
            multiple
            onChange={handleChange}
            ref={inputRef}
            type="file"
          />
        </Tooltip>
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
        <TooltipProvider>
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
        </TooltipProvider>
      )}
    </>
  );
}
