"use client";

import { useToast } from "@asm/ui/hooks/use-toast";
import { Button } from "@asm/ui/shadui/button";
import {
  AlignLeftIcon,
  Check,
  Copy,
  Expand,
  FileIcon,
  WrapTextIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
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
    js: "javascript",
    ts: "typescript",
    jsx: "jsx",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    s: "csharp",
    go: "go",
    rs: "rust",
    php: "php",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    sql: "sql",
  };

  const normalizedLang = language
    .toLowerCase()
    .replace(normalizedlangRegex, "");
  return langMap[normalizedLang] || normalizedLang || "text";
};

export function CodePreview({
  mediaId,
  language = "text",
  fileName,
  className = "",
}: CodePreviewProps) {
  const { toast } = useToast();
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isDarkTheme, _setIsDarkTheme] = useState(true);
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
      } catch (err) {
        setError("Failed to load code content");
        console.error(err);
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
        title: "Copied to clipboard",
        description: "Code has been copied to your clipboard",
      });
    } catch {
      toast({
        title: "Failed to copy",
        description: "Please try again",
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
      <div className="flex items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-destructive">
        <span>{error}</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-lg border p-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // biome-ignore lint/correctness/noNestedComponentDefinitions: CodeHeader uses multiple parent component state variables, making it reasonable to keep nested
  const CodeHeader = () => (
    <div className="flex items-center justify-between border-b bg-background/95 px-4 py-2 backdrop-blur-xs supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-2">
        <FileIcon className="h-4 w-4 text-muted-foreground" />
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
        "rounded-lg border bg-card",
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
            margin: 0,
            padding: "1rem",
            fontSize: "0.9rem",
            backgroundColor: "transparent",
            fontFamily: "var(--font-mono)",
          }}
          language={normalizeLanguage(language)}
          lineNumberStyle={{
            minWidth: "3em",
            paddingRight: "1em",
            fontFamily: "var(--font-mono)",
          }}
          showLineNumbers={true}
          style={isDarkTheme ? oneDark : oneLight}
          wrapLines
          wrapLongLines
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
