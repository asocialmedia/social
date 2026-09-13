"use client";

import type { Editor, JSONContent } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import {
  HashtagNode,
  MentionNode,
} from "@/components/posts/editor/inline-nodes";
import { InlineSuggestions } from "@/components/posts/editor/inline-suggestions";
import { cn } from "@/lib/utils";

import "../posts/editor/styles.css";

// TipTap-backed eddie composer shared by the inline comment form and the
// mobile floating bar. Autocomplete picks become inline mention/hashtag
// pills (same nodes as the post composer), while the plain-text value the
// parent stores is unchanged: getText serializes `@user` / `#tag` back out,
// so drafts, limits, link embeds and the publish payload all keep working.

interface CommentRichEditorProps {
  autoFocus?: boolean;
  className?: string;
  editorClassName?: string;
  editorRef?: RefObject<Editor | null>;
  initialContent?: string;
  onChange: (text: string) => void;
  onFocus?: () => void;
  onSubmit: () => void;
  placeholder: string;
  placement?: "above" | "below";
}

// Restores a stored plain-text draft into paragraph nodes. Inline pills are
// collapsed to their `@user` / `#tag` text on save, so a restored draft is
// plain text - the published renderer still badges it.
function textToDoc(text: string): JSONContent {
  const lines = text.split("\n");
  return {
    content: lines.map((line) => ({
      content: line ? [{ text: line, type: "text" }] : undefined,
      type: "paragraph",
    })),
    type: "doc",
  };
}

export function CommentRichEditor({
  autoFocus = false,
  className,
  editorClassName,
  editorRef,
  initialContent = "",
  onChange,
  onFocus,
  onSubmit,
  placeholder,
  placement = "above",
}: CommentRichEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  // The editor instance outlives renders; mirroring the latest callbacks
  // into refs keeps its handlers from closing over stale props.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  // Seed the document once from the restored draft; later input changes flow
  // through onUpdate, not back into the editor (useEditor only builds the doc
  // on instance creation - setOptions never re-applies `content`).
  const editor = useEditor({
    content: textToDoc(initialContent),
    editorProps: {
      attributes: {
        class: cn("focus:outline-none", editorClassName),
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          // Enter publishes; Shift+Enter keeps a line break. When the
          // mention/tag popup is open it consumes Enter first (capture-phase
          // preventDefault), so the suggestion wins over submit.
          if (event.key !== "Enter" || event.shiftKey) {
            return false;
          }
          if (event.defaultPrevented) {
            return true;
          }
          event.preventDefault();
          onSubmitRef.current();
          return true;
        },
      },
    },
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder }),
      MentionNode,
      HashtagNode,
    ],
    immediatelyRender: false,
    onUpdate: ({ editor: currentEditor }) => {
      onChangeRef.current(
        currentEditor.getText({ blockSeparator: "\n" }) || ""
      );
    },
  });

  useEffect(() => {
    if (editorRef) {
      editorRef.current = editor ?? null;
    }
    return () => {
      if (editorRef) {
        editorRef.current = null;
      }
    };
  }, [editor, editorRef]);

  // The placeholder changes with reply context (floating bar). The extension
  // was created with the initial string, so update its option and nudge a
  // transaction to re-render the decoration.
  useEffect(() => {
    if (!editor) {
      return;
    }
    const extension = editor.extensionManager.extensions.find(
      (item) => item.name === "placeholder"
    );
    if (extension) {
      extension.options.placeholder = placeholder;
      editor.view.dispatch(editor.state.tr);
    }
  }, [editor, placeholder]);

  useEffect(() => {
    if (autoFocus && editor) {
      editor.commands.focus("end");
    }
  }, [autoFocus, editor]);

  return (
    <div className={cn("relative", className)} onFocus={onFocus}>
      <InlineSuggestions editor={editor} placement={placement} />
      <EditorContent editor={editor} />
    </div>
  );
}
