"use client";

import { clientLog } from "@asm/config/debug";
import { Button } from "@asm/ui/shadui/button";
import {
  AlignLeftIcon,
  Check,
  Copy,
  Expand,
  FileIcon,
  WrapTextIcon,
} from "lucide-react";
// oxlint-disable react-compiler -- the nested CodeHeader helper uses parent component state
import { useCallback, useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { useToast } from "@/lib/gooey-toast";
import { cn } from "@/lib/utils";

interface CodePreviewProps {
  className?: string;
  fileName?: string;
  language?: string;
  mediaId: string;
}

const normalizedlangRegex = /^\./;
const normalizeLanguage = (language = ""): string => {
  const langMap: Record<string, string> = {
    css: "css",
    go: "go",
    html: "html",
    js: "javascript",
    json: "json",
    jsx: "jsx",
    md: "markdown",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    s: "csharp",
    scss: "scss",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    yaml: "yaml",
    yml: "yaml",
  };

  const normalizedLang = language
    .toLowerCase()
    .replace(normalizedlangRegex, "");
  return langMap[normalizedLang] || normalizedLang || "text";
};

export const CodePreview = ({
  mediaId,
  language = "text",
  fileName,
  className = "",
}: CodePreviewProps) => {
  const { toast } = useToast();
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [wrapCode, setWrapCode] = useState(true);

  useEffect(() => {
    async function fetchCode() {
      try {
        setLoading(true);
        const response = await fetch(`/api/media/${mediaId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch code");
        }
        const text = await response.text();
        setContent(text);
      } catch (fetchError) {
        setError("Failed to load code content");
        clientLog.error(fetchError);
      } finally {
        setLoading(false);
      }
    }
    fetchCode();
  }, [mediaId]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        description: "Code copied, paste it anywhere",
        icon: <Copy />,
        title: "Code Copied",
      });
    } catch {
      toast({
        description: "Couldn't copy, try again?",
        title: "Copy Failed",
        variant: "destructive",
      });
    }
  }, [content, toast]);

  const toggleFullScreen = useCallback(() => {
    setIsFullScreen((current) => !current);
  }, []);

  const toggleWrapCode = useCallback(() => {
    setWrapCode((current) => !current);
  }, []);

  if (error) {
    return (
      <div className="border-destructive/20 bg-destructive/10 text-destructive flex items-center justify-center rounded-lg border p-4">
        <span>{error}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border p-4">
        <div className="border-primary h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  // eslint-disable-next-line react/no-unstable-nested-components -- CodeHeader uses multiple parent component state variables, making it reasonable to keep nested
  const CodeHeader = () => (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/60 flex items-center justify-between border-b px-4 py-2 backdrop-blur-xs">
      <div className="flex items-center gap-2">
        <FileIcon className="text-muted-foreground h-4 w-4" />
        <span className="font-medium">{fileName || `Code.${language}`}</span>
        <span className="text-muted-foreground text-sm">{language}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={toggleWrapCode}
          size="icon"
          title={wrapCode ? "Disable line wrap" : "Enable line wrap"}
          variant="ghost"
        >
          {wrapCode ? (
            <WrapTextIcon className="h-4 w-4" />
          ) : (
            <AlignLeftIcon className="h-4 w-4" />
          )}
        </Button>
        <Button onClick={handleCopy} size="icon" variant="ghost">
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <Button onClick={toggleFullScreen} size="icon" variant="ghost">
          <Expand className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "bg-card rounded-lg border",
        isFullScreen && "fixed inset-0 z-50",
        className
      )}
    >
      <CodeHeader />
      <div
        className={cn(
          "max-h-[60vh] overflow-auto",
          isFullScreen && "h-[calc(100%-3rem)]"
        )}
      >
        <SyntaxHighlighter
          customStyle={{
            backgroundColor: "transparent",
            fontFamily: "var(--font-mono)",
            fontSize: "0.9rem",
            margin: 0,
            padding: "1rem",
          }}
          language={normalizeLanguage(language)}
          lineNumberStyle={{
            fontFamily: "var(--font-mono)",
            minWidth: "3em",
            paddingRight: "1em",
          }}
          showLineNumbers={true}
          style={oneDark}
          wrapLines
          wrapLongLines
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};
