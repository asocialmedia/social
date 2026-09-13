"use client";

import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";

import {
  HashtagNode,
  MentionNode,
} from "@/components/posts/editor/inline-nodes";
import { InlineSuggestions } from "@/components/posts/editor/inline-suggestions";
import { cn } from "@/lib/utils";

import { textToDoc } from "./inline-doc";
import { BioLink } from "./link-badge-mark";

import "./styles.css";

// TipTap-backed inline editor shared by the eddie composers and the settings
// bio field. Autocomplete picks become inline mention/hashtag pills while
// `getText` still serializes `@user` / `#tag` back to plain text, so every
// consumer keeps storing a plain string. With `enableLinks` on, typed/pasted
// URLs are autolinked and carry the badge treatment so the author can see the
// chip they are making.

interface InlineRichEditorProps {
  autoFocus?: boolean;
  className?: string;
  editorClassName?: string;
  editorRef?: RefObject<Editor | null>;
  // Links are opt-in: the bio wants visible link chips, the eddie composers
  // keep bare text while typing and badge only on display.
  enableLinks?: boolean;
  initialContent?: string;
  // Fired on every edit with the serialized plain text.
  onChange: (text: string) => void;
  onFocus?: () => void;
  // When provided, plain Enter commits (Shift+Enter inserts a line break).
  // Omit it for multi-line fields like the bio, where Enter is a newline.
  onSubmit?: () => void;
  placeholder: string;
  // Which way the mention/tag popover opens from the caret.
  placement?: "above" | "below";
}

export function InlineRichEditor({
  autoFocus = false,
  className,
  editorClassName,
  editorRef,
  enableLinks = false,
  initialContent = "",
  onChange,
  onFocus,
  onSubmit,
  placeholder,
  placement = "below",
}: InlineRichEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  // The placeholder reads through a ref so the extension can resolve it lazily
  // instead of us poking at the (possibly destroyed) extension manager.
  const placeholderRef = useRef(placeholder);
  const resolvePlaceholder = useCallback(() => placeholderRef.current, []);
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
    content: textToDoc(initialContent, enableLinks),
    editorProps: {
      attributes: {
        class: cn("inline-rich-editor focus:outline-none", editorClassName),
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          // Only commit on Enter when the caller asked for submit-on-enter.
          // The mention/tag popover consumes Enter first via capture-phase
          // preventDefault, so a suggestion always wins over submit.
          if (event.key !== "Enter" || event.shiftKey || !onSubmitRef.current) {
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
        // StarterKit's own link stays off; where links are wanted we register
        // BioLink below, which renders the URL as a badge.
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      // oxlint-disable-next-line react/refs -- Placeholder resolves this lazily at decoration time, never during render
      Placeholder.configure({ placeholder: resolvePlaceholder }),
      MentionNode,
      HashtagNode,
      ...(enableLinks
        ? [
            BioLink.configure({
              autolink: true,
              linkOnPaste: true,
              openOnClick: false,
            }),
          ]
        : []),
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

  // Track the latest placeholder (the extension reads it lazily from the ref)
  // and nudge a transaction so the decoration re-measures when reply context
  // changes. Guard the view: the editor can be mid-teardown (StrictMode) and
  // touching a destroyed instance throws.
  useEffect(() => {
    placeholderRef.current = placeholder;
    if (editor && !editor.isDestroyed && editor.view) {
      editor.view.dispatch(editor.state.tr);
    }
  }, [editor, placeholder]);

  useEffect(() => {
    if (autoFocus && editor && !editor.isDestroyed) {
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
