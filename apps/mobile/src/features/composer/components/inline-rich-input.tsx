"use dom";

import { textToDoc } from "@asm/ui/lib/inline-editor-doc";
import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Asset } from "expo-asset";
import { useDOMImperativeHandle } from "expo/dom";
import type { DOMProps, DOMImperativeFactory } from "expo/dom";
import type { Ref } from "react";
import { useEffect, useRef } from "react";

import sofiaFont from "../../../../assets/fonts/SofiaProSoftReg.ttf";
import type { MentionPick } from "../lib/inline-relations";
import {
  editorPositionForTextOffset,
  textOffsetForEditorPosition,
} from "../lib/rich-editor-selection";

import "./inline-rich-input.css";

const Mention = Node.create({
  addAttributes: () => ({
    avatarUrl: { default: "" },
    username: { default: "" },
  }),
  atom: true,
  group: "inline",
  inline: true,
  name: "mention",
  parseHTML: () => [{ tag: "span[data-mention]" }],
  renderHTML({ node, HTMLAttributes }) {
    const username = String(node.attrs.username ?? "");
    const avatarUrl = String(node.attrs.avatarUrl ?? "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "inline-badge inline-mention",
        "data-mention": username,
      }),
      avatarUrl
        ? [
            "img",
            {
              alt: "",
              class: "inline-avatar",
              draggable: "false",
              src: avatarUrl,
            },
          ]
        : [
            "span",
            { "aria-hidden": "true", class: "inline-avatar" },
            username.slice(0, 1).toUpperCase(),
          ],
      `@${username}`,
    ];
  },
  renderText: ({ node }) => `@${String(node.attrs.username ?? "")}`,
});

const Hashtag = Node.create({
  addAttributes: () => ({ tag: { default: "" } }),
  atom: true,
  group: "inline",
  inline: true,
  name: "hashtag",
  parseHTML: () => [{ tag: "span[data-hashtag]" }],
  renderHTML({ node, HTMLAttributes }) {
    const tag = String(node.attrs.tag ?? "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "inline-badge inline-tag",
        "data-hashtag": tag,
      }),
      ["span", { class: "inline-tag-accent" }, "#"],
      ["span", {}, tag],
    ];
  },
  renderText: ({ node }) => `#${String(node.attrs.tag ?? "")}`,
});

interface SelectionRange {
  end: number;
  start: number;
}

function badgeDocument(
  value: string,
  mentions: readonly MentionPick[],
  avatarBase: string
) {
  const doc = textToDoc(value, true);
  for (const paragraph of doc.content ?? []) {
    for (const node of paragraph.content ?? []) {
      if (node.type !== "mention") {
        continue;
      }
      const pick = mentions.find(
        (mention) => mention.username === node.attrs?.username
      );
      if (pick?.avatarUrl) {
        node.attrs = {
          ...node.attrs,
          avatarUrl: new URL(pick.avatarUrl, avatarBase).href,
        };
      }
    }
  }
  return doc;
}

function readSelection(editor: Editor): SelectionRange {
  const doc = editor.getJSON();
  return {
    end: textOffsetForEditorPosition(doc, editor.state.selection.to),
    start: textOffsetForEditorPosition(doc, editor.state.selection.from),
  };
}

const EMPTY_MENTIONS: readonly MentionPick[] = [];

export interface InlineRichInputRef extends DOMImperativeFactory {
  focus: () => void;
  blur: () => void;
}

export default function InlineRichInput({
  ref,
  editable = true,
  onSubmit,
  autoFocus = false,
  avatarBase,
  mentions = EMPTY_MENTIONS,
  color,
  isDark,
  label,
  onChange,
  onFocusChange,
  onHeightChange,
  onSelectionChange,
  placeholder,
  placeholderColor,
  selection,
  value,
}: {
  ref?: Ref<InlineRichInputRef>;
  editable?: boolean;
  onSubmit?: () => Promise<void>;
  autoFocus?: boolean;
  avatarBase: string;
  mentions?: readonly MentionPick[];
  color: string;
  dom: DOMProps;
  isDark: boolean;
  label: string;
  onChange: (text: string, selection: SelectionRange) => Promise<void>;
  onFocusChange: (focused: boolean) => Promise<void>;
  onHeightChange: (height: number) => Promise<void>;
  onSelectionChange: (selection: SelectionRange) => Promise<void>;
  placeholder: string;
  placeholderColor: string;
  selection?: SelectionRange | null;
  value: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const pendingValues = useRef(new Set<string>());
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (blurTimer.current) {
        clearTimeout(blurTimer.current);
      }
    },
    []
  );
  const callbacks = useRef({
    onChange,
    onFocusChange,
    onSelectionChange,
    onSubmit,
  });
  useEffect(() => {
    callbacks.current = {
      onChange,
      onFocusChange,
      onSelectionChange,
      onSubmit,
    };
  }, [onChange, onFocusChange, onSelectionChange, onSubmit]);

  const editor = useEditor({
    content: badgeDocument(value, mentions, avatarBase),
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "true",
        class: "native-rich-input",
        role: "textbox",
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            !callbacks.current.onSubmit
          ) {
            return false;
          }
          event.preventDefault();
          void callbacks.current.onSubmit();
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
        link: {
          HTMLAttributes: { class: "inline-badge inline-link" },
          autolink: true,
          linkOnPaste: true,
          openOnClick: false,
        },
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder }),
      Mention,
      Hashtag,
    ],
    immediatelyRender: false,
    onBlur: () => {
      // A native suggestion must receive its press before blur hides the list.
      blurTimer.current = setTimeout(() => {
        void callbacks.current.onFocusChange(false);
      }, 200);
    },
    onFocus: () => {
      if (blurTimer.current) {
        clearTimeout(blurTimer.current);
        blurTimer.current = null;
      }
      void callbacks.current.onFocusChange(true);
    },
    onSelectionUpdate: ({ editor: current }) => {
      void callbacks.current.onSelectionChange(readSelection(current));
    },
    onUpdate: ({ editor: current }) => {
      const text = current.getText({ blockSeparator: "\n" });
      pendingValues.current.add(text);
      void callbacks.current.onChange(text, readSelection(current));
    },
  });

  useDOMImperativeHandle(
    ref ?? null,
    () => ({
      blur: () => {
        editor?.commands.blur();
      },
      focus: () => {
        editor?.commands.focus("end");
      },
    }),
    [editor]
  );
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    // Native acknowledgments of earlier keystrokes must not replace newer DOM input.
    if (pendingValues.current.delete(value) && !selection) {
      return;
    }
    if (editor.getText({ blockSeparator: "\n" }) !== value) {
      editor.commands.setContent(badgeDocument(value, mentions, avatarBase), {
        emitUpdate: false,
      });
    }
    if (selection) {
      const doc = editor.getJSON();
      editor.commands.setTextSelection({
        from: editorPositionForTextOffset(doc, selection.start),
        to: editorPositionForTextOffset(doc, selection.end),
      });
      editor.commands.focus();
    }
  }, [avatarBase, editor, mentions, selection, value]);

  useEffect(() => {
    if (autoFocus && editor) {
      editor.commands.focus("end");
    }
  }, [autoFocus, editor]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const observer = new ResizeObserver(() => {
      void onHeightChange(
        Math.max(24, Math.min(296, host.getBoundingClientRect().height))
      );
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [onHeightChange]);

  return (
    <div
      ref={hostRef}
      className={isDark ? "rich-input-host dark" : "rich-input-host"}
      style={
        {
          "--placeholder-color": placeholderColor,
          color,
        } as React.CSSProperties
      }
    >
      <style>{`@font-face { font-family: SofiaPro; src: url("${Asset.fromModule(sofiaFont).uri}"); }`}</style>
      <EditorContent editor={editor} />
    </div>
  );
}
