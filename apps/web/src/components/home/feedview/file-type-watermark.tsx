import {
  AudioWaveform,
  CodeIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  VideoIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { FILE_CONFIGS, type FileTypeConfig } from "@/lib/utils/mime-utils";

interface FileTypeWatermarkProps {
  showCategory?: boolean;
  type: string;
}

const iconMap = {
  ImageIcon,
  VideoIcon,
  AudioWaveform,
  FileTextIcon,
  CodeIcon,
  FileIcon,
} as const;

const animations = {
  container: {
    initial: { opacity: 0, y: 5 },
    animate: { opacity: 1, y: 0 },
    hover: { scale: 1.05 },
  },
  text: {
    enter: { opacity: 0, x: -10 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 10 },
  },
};

export const FileTypeWatermark = ({
  type,
  showCategory = true,
}: FileTypeWatermarkProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const extension = type.toLowerCase();
  const config = FILE_CONFIGS[extension];

  const fallbackConfig: FileTypeConfig = {
    category: "DOCUMENT",
    mime: "application/octet-stream",
    tag: {
      bg: "bg-gray-500/30",
      text: "text-gray-100",
      icon: "FileIcon",
    },
  };

  const { category, tag } = config || fallbackConfig;
  const Icon = iconMap[tag.icon as keyof typeof iconMap] || FileIcon;

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  return (
    <motion.div
      className="absolute right-2 bottom-2 z-20 overflow-hidden"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      whileHover={animations.container.hover}
    >
      <motion.div
        animate={animations.container.animate}
        className={cn(
          "rounded-lg px-3 py-1.5",
          tag.bg,
          tag.text,
          "backdrop-blur-md backdrop-saturate-150",
          "border border-white/10",
          "shadow-lg",
          "transition-all duration-300"
        )}
        initial={animations.container.initial}
      >
        <AnimatePresence mode="wait">
          <motion.div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" />
            <AnimatePresence mode="wait">
              {isHovered ? (
                <motion.span
                  animate={animations.text.animate}
                  className="whitespace-nowrap font-medium text-xs"
                  exit={animations.text.exit}
                  initial={animations.text.enter}
                  key="file-type"
                >
                  {extension.toUpperCase()}
                </motion.span>
              ) : (
                showCategory && (
                  <motion.span
                    animate={animations.text.animate}
                    className="whitespace-nowrap font-medium text-xs"
                    exit={animations.text.exit}
                    initial={animations.text.enter}
                    key="category"
                  >
                    {category}
                  </motion.span>
                )
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <motion.div
        animate={{ opacity: isHovered ? 1 : 0 }}
        className={cn(
          "absolute inset-0 -z-10",
          "blur-xl",
          tag.bg,
          "opacity-50"
        )}
        initial={{ opacity: 0 }}
      />
    </motion.div>
  );
};
