import type { FileCategory } from "../config/file-config";

export interface FileTypeConfig {
  category: FileCategory;
  mime: string;
  tag: {
    bg: string;
    text: string;
    icon: string;
  };
}

// eslint-disable-next-line eslint/sort-keys -- config map intentionally grouped by file category
export const FILE_CONFIGS: Record<string, FileTypeConfig> = {
  jpg: {
    category: "IMAGE",
    mime: "image/jpeg",
    tag: { bg: "bg-blue-500/30", icon: "ImageIcon", text: "text-blue-100" },
  },
  jpeg: {
    category: "IMAGE",
    mime: "image/jpeg",
    tag: { bg: "bg-blue-500/30", icon: "ImageIcon", text: "text-blue-100" },
  },
  png: {
    category: "IMAGE",
    mime: "image/png",
    tag: { bg: "bg-green-500/30", icon: "ImageIcon", text: "text-green-100" },
  },
  gif: {
    category: "IMAGE",
    mime: "image/gif",
    tag: { bg: "bg-purple-500/30", icon: "ImageIcon", text: "text-purple-100" },
  },
  webp: {
    category: "IMAGE",
    mime: "image/webp",
    tag: { bg: "bg-yellow-500/30", icon: "ImageIcon", text: "text-yellow-100" },
  },
  heic: {
    category: "IMAGE",
    mime: "image/heic",
    tag: { bg: "bg-indigo-500/30", icon: "ImageIcon", text: "text-indigo-100" },
  },
  heif: {
    category: "IMAGE",
    mime: "image/heif",
    tag: { bg: "bg-indigo-500/30", icon: "ImageIcon", text: "text-indigo-100" },
  },
  svg: {
    category: "IMAGE",
    mime: "image/svg+xml",
    tag: { bg: "bg-orange-500/30", icon: "ImageIcon", text: "text-orange-100" },
  },
  tiff: {
    category: "IMAGE",
    mime: "image/tiff",
    tag: { bg: "bg-cyan-500/30", icon: "ImageIcon", text: "text-cyan-100" },
  },
  raw: {
    category: "IMAGE",
    mime: "image/raw",
    tag: { bg: "bg-red-500/30", icon: "ImageIcon", text: "text-red-100" },
  },

  // Videos
  mp4: {
    category: "VIDEO",
    mime: "video/mp4",
    tag: { bg: "bg-red-500/30", icon: "VideoIcon", text: "text-red-100" },
  },
  webm: {
    category: "VIDEO",
    mime: "video/webm",
    tag: { bg: "bg-purple-500/30", icon: "VideoIcon", text: "text-purple-100" },
  },
  mov: {
    category: "VIDEO",
    mime: "video/quicktime",
    tag: { bg: "bg-blue-500/30", icon: "VideoIcon", text: "text-blue-100" },
  },
  avi: {
    category: "VIDEO",
    mime: "video/x-msvideo",
    tag: { bg: "bg-gray-500/30", icon: "VideoIcon", text: "text-gray-100" },
  },
  mkv: {
    category: "VIDEO",
    mime: "video/x-matroska",
    tag: { bg: "bg-green-500/30", icon: "VideoIcon", text: "text-green-100" },
  },
  flv: {
    category: "VIDEO",
    mime: "video/x-flv",
    tag: { bg: "bg-yellow-500/30", icon: "VideoIcon", text: "text-yellow-100" },
  },

  // Audio
  mp3: {
    category: "AUDIO",
    mime: "audio/mpeg",
    tag: { bg: "bg-pink-500/30", icon: "AudioWaveform", text: "text-pink-100" },
  },
  wav: {
    category: "AUDIO",
    mime: "audio/wav",
    tag: { bg: "bg-blue-500/30", icon: "AudioWaveform", text: "text-blue-100" },
  },
  ogg: {
    category: "AUDIO",
    mime: "audio/ogg",
    tag: {
      bg: "bg-purple-500/30",
      icon: "AudioWaveform",
      text: "text-purple-100",
    },
  },
  aac: {
    category: "AUDIO",
    mime: "audio/aac",
    tag: { bg: "bg-red-500/30", icon: "AudioWaveform", text: "text-red-100" },
  },
  flac: {
    category: "AUDIO",
    mime: "audio/flac",
    tag: {
      bg: "bg-green-500/30",
      icon: "AudioWaveform",
      text: "text-green-100",
    },
  },
  m4a: {
    category: "AUDIO",
    mime: "audio/mp4",
    tag: {
      bg: "bg-yellow-500/30",
      icon: "AudioWaveform",
      text: "text-yellow-100",
    },
  },

  // Code
  js: {
    category: "CODE",
    mime: "text/javascript",
    tag: { bg: "bg-yellow-500/30", icon: "CodeIcon", text: "text-yellow-100" },
  },
  ts: {
    category: "CODE",
    mime: "text/typescript",
    tag: { bg: "bg-blue-500/30", icon: "CodeIcon", text: "text-blue-100" },
  },
  jsx: {
    category: "CODE",
    mime: "text/jsx",
    tag: { bg: "bg-cyan-500/30", icon: "CodeIcon", text: "text-cyan-100" },
  },
  tsx: {
    category: "CODE",
    mime: "text/tsx",
    tag: { bg: "bg-cyan-500/30", icon: "CodeIcon", text: "text-cyan-100" },
  },
  py: {
    category: "CODE",
    mime: "text/x-python",
    tag: { bg: "bg-green-500/30", icon: "CodeIcon", text: "text-green-100" },
  },
  java: {
    category: "CODE",
    mime: "text/x-java",
    tag: { bg: "bg-red-500/30", icon: "CodeIcon", text: "text-red-100" },
  },
  cpp: {
    category: "CODE",
    mime: "text/x-cpp",
    tag: { bg: "bg-blue-500/30", icon: "CodeIcon", text: "text-blue-100" },
  },
  c: {
    category: "CODE",
    mime: "text/x-c",
    tag: { bg: "bg-blue-500/30", icon: "CodeIcon", text: "text-blue-100" },
  },
  cs: {
    category: "CODE",
    mime: "text/x-csharp",
    tag: { bg: "bg-purple-500/30", icon: "CodeIcon", text: "text-purple-100" },
  },
  rb: {
    category: "CODE",
    mime: "text/x-ruby",
    tag: { bg: "bg-red-500/30", icon: "CodeIcon", text: "text-red-100" },
  },
  php: {
    category: "CODE",
    mime: "text/x-php",
    tag: { bg: "bg-purple-500/30", icon: "CodeIcon", text: "text-purple-100" },
  },
  go: {
    category: "CODE",
    mime: "text/x-go",
    tag: { bg: "bg-cyan-500/30", icon: "CodeIcon", text: "text-cyan-100" },
  },
  rs: {
    category: "CODE",
    mime: "text/x-rust",
    tag: { bg: "bg-orange-500/30", icon: "CodeIcon", text: "text-orange-100" },
  },
  swift: {
    category: "CODE",
    mime: "text/x-swift",
    tag: { bg: "bg-orange-500/30", icon: "CodeIcon", text: "text-orange-100" },
  },
  kt: {
    category: "CODE",
    mime: "text/x-kotlin",
    tag: { bg: "bg-purple-500/30", icon: "CodeIcon", text: "text-purple-100" },
  },

  // Documents
  pdf: {
    category: "DOCUMENT",
    mime: "application/pdf",
    tag: { bg: "bg-red-500/30", icon: "FileTextIcon", text: "text-red-100" },
  },
  doc: {
    category: "DOCUMENT",
    mime: "application/msword",
    tag: { bg: "bg-blue-500/30", icon: "FileTextIcon", text: "text-blue-100" },
  },
  docx: {
    category: "DOCUMENT",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    tag: { bg: "bg-blue-500/30", icon: "FileTextIcon", text: "text-blue-100" },
  },
  xls: {
    category: "DOCUMENT",
    mime: "application/vnd.ms-excel",
    tag: {
      bg: "bg-green-500/30",
      icon: "FileTextIcon",
      text: "text-green-100",
    },
  },
  xlsx: {
    category: "DOCUMENT",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    tag: {
      bg: "bg-green-500/30",
      icon: "FileTextIcon",
      text: "text-green-100",
    },
  },
  ppt: {
    category: "DOCUMENT",
    mime: "application/vnd.ms-powerpoint",
    tag: {
      bg: "bg-orange-500/30",
      icon: "FileTextIcon",
      text: "text-orange-100",
    },
  },
  pptx: {
    category: "DOCUMENT",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    tag: {
      bg: "bg-orange-500/30",
      icon: "FileTextIcon",
      text: "text-orange-100",
    },
  },
  txt: {
    category: "DOCUMENT",
    mime: "text/plain",
    tag: { bg: "bg-gray-500/30", icon: "FileTextIcon", text: "text-gray-100" },
  },
  rtf: {
    category: "DOCUMENT",
    mime: "application/rtf",
    tag: { bg: "bg-gray-500/30", icon: "FileTextIcon", text: "text-gray-100" },
  },
  md: {
    category: "DOCUMENT",
    mime: "text/markdown",
    tag: { bg: "bg-blue-500/30", icon: "FileTextIcon", text: "text-blue-100" },
  },
};

export const getContentType = (filename: string): string => {
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension
    ? FILE_CONFIGS[extension]?.mime || "application/octet-stream"
    : "application/octet-stream";
};

export const getContentDisposition = (filename: string, inline = false) => {
  if (!filename) {
    throw new Error("Filename is required");
  }
  const utf8Filename = encodeURIComponent(filename.trim());
  return `${inline ? "inline" : "attachment"}; filename="${utf8Filename}"`;
};

export const getTagConfig = (extension: string) =>
  FILE_CONFIGS[extension]?.tag || {
    bg: "bg-gray-500/30",
    icon: "FileIcon",
    text: "text-gray-100",
  };

export const shouldDisplayInline = (mimeType: string) => {
  const inlineTypes = [
    "image/",
    "video/",
    "audio/",
    "text/",
    "application/pdf",
    "application/json",
  ];
  return inlineTypes.some((type) => mimeType.startsWith(type));
};

export const getFileType = (mimeType: string) => {
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  ) {
    return "code";
  }
  return "document";
};

export const getFileCategory = (mimeType: string): FileCategory => {
  if (mimeType.startsWith("image/")) {
    return "IMAGE";
  }
  if (mimeType.startsWith("video/")) {
    return "VIDEO";
  }
  if (mimeType.startsWith("audio/")) {
    return "AUDIO";
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  ) {
    return "CODE";
  }
  return "DOCUMENT";
};

export const normalizeMimeType = (mimeType: string | undefined): string => {
  if (!mimeType) {
    return "application/octet-stream";
  }
  if (mimeType.includes("quicktime")) {
    return "video/mp4";
  }
  if (mimeType.includes("x-matroska")) {
    return "video/webm";
  }
  return mimeType.toLowerCase();
};

export const getFileConfigFromMime = (mimeType: string | undefined) => {
  const normalizedMime = normalizeMimeType(mimeType);
  const config = Object.values(FILE_CONFIGS).find(
    (fileConfig) => fileConfig.mime === normalizedMime
  );

  if (config) {
    return config;
  }

  const category = getFileCategory(normalizedMime);
  return Object.values(FILE_CONFIGS).find(
    (fileConfig) => fileConfig.category === category
  );
};

export const getFileConfigFromExtension = (extension: string) =>
  FILE_CONFIGS[extension.toLowerCase()];
