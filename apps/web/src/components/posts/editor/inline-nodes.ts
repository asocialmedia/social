"use client";

import { mergeAttributes, Node } from "@tiptap/core";

// Inline pills for the post composer. Picking a user/tag from the
// autocomplete inserts one of these atom nodes (avatar pill for mentions,
// hash pill for tags) instead of plain text, so the mention stays visible
// exactly where it was typed - like comments and link embeds. The nodes
// serialize back to `@username` / `#tag` plain text, so stored content,
// link embeds, and the published-post linkifier never change shape.

export interface InlineMentionAttrs {
  avatarUrl: string;
  displayName: string;
  id: string;
  username: string;
}

function mentionLabel(attrs: Partial<InlineMentionAttrs>): string {
  const username =
    typeof attrs.username === "string" && attrs.username.length > 0
      ? attrs.username
      : "unknown";
  return `@${username}`;
}

export const MentionNode = Node.create({
  addAttributes() {
    return {
      avatarUrl: { default: "" },
      displayName: { default: "" },
      id: { default: "" },
      username: { default: "" },
    };
  },
  atom: true,
  group: "inline",
  inline: true,
  name: "mention",
  parseHTML() {
    return [
      {
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === "string") {
            return false;
          }
          const id = element.dataset.mentionId;
          const username = element.dataset.mentionUsername;
          if (!id || !username) {
            return false;
          }
          return {
            avatarUrl: element.dataset.mentionAvatar ?? "",
            displayName: element.dataset.mentionDisplay ?? username,
            id,
            username,
          };
        },
        tag: "span[data-mention-id]",
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as Partial<InlineMentionAttrs>;
    const avatarUrl =
      typeof attrs.avatarUrl === "string" ? attrs.avatarUrl : "";
    const displayName =
      typeof attrs.displayName === "string" && attrs.displayName.length > 0
        ? attrs.displayName
        : (attrs.username ?? "");
    const username = typeof attrs.username === "string" ? attrs.username : "";
    const id = typeof attrs.id === "string" ? attrs.id : "";
    const avatar =
      avatarUrl.length > 0
        ? [
            "img",
            {
              alt: "",
              class: "editor-inline-pill-avatar",
              draggable: "false",
              height: "14",
              src: avatarUrl,
              width: "14",
            },
          ]
        : [
            "span",
            { class: "editor-inline-pill-avatar editor-inline-pill-fallback" },
            (username[0] ?? "?").toUpperCase(),
          ];
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "meta-chip meta-chip-mention editor-inline-pill",
        "data-mention-avatar": avatarUrl,
        "data-mention-display": displayName,
        "data-mention-id": id,
        "data-mention-username": username,
      }),
      avatar,
      ["span", {}, mentionLabel(attrs)],
    ];
  },
  renderText({ node }) {
    return mentionLabel(node.attrs as Partial<InlineMentionAttrs>);
  },
});

export const HashtagNode = Node.create({
  addAttributes() {
    return {
      tag: { default: "" },
    };
  },
  atom: true,
  group: "inline",
  inline: true,
  name: "hashtag",
  parseHTML() {
    return [
      {
        getAttrs: (element: HTMLElement | string) => {
          if (typeof element === "string") {
            return false;
          }
          const tag = element.dataset.hashtag;
          if (!tag) {
            return false;
          }
          return { tag };
        },
        tag: "span[data-hashtag]",
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const tag = typeof node.attrs.tag === "string" ? node.attrs.tag : "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "meta-chip meta-chip-tag editor-inline-pill",
        "data-hashtag": tag,
      }),
      ["span", { class: "meta-chip-accent" }, "#"],
      ["span", {}, tag],
    ];
  },
  renderText({ node }) {
    const tag = typeof node.attrs.tag === "string" ? node.attrs.tag : "";
    return `#${tag}`;
  },
});

export type { InlineRelations } from "./inline-relations";
export { collectInlineRelations, mergeUniqueIds } from "./inline-relations";
