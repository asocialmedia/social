import { describe, expect, test } from "bun:test";

import { isInteractiveTarget } from "./post-card";

interface MockNode {
  attributes: Record<string, string>;
  closest?: (selector: string) => MockNode | null;
  isContentEditable?: boolean;
  parent: MockNode | null;
  tagName: string;
}

function findClosest(startNode: MockNode, selector: string): MockNode | null {
  const selectors = selector.split(",").map((s) => s.trim().toLowerCase());
  let current: MockNode | null = startNode;
  while (current) {
    for (const sel of selectors) {
      if (sel.startsWith("[") && sel.endsWith("]")) {
        const attrCondition = sel.slice(1, -1);
        if (attrCondition.includes("=")) {
          const [attr, val] = attrCondition.split("=");
          const cleanVal = val?.replaceAll(/['"]/g, "") ?? "";
          if (attr && current.attributes[attr] === cleanVal) {
            return current;
          }
        } else if (attrCondition in current.attributes) {
          return current;
        }
      } else if (current.tagName.toLowerCase() === sel) {
        return current;
      }
    }
    current = current.parent;
  }
  return null;
}

function createNode(
  tagName: string,
  attributes: Record<string, string> = {},
  parent: MockNode | null = null,
  isContentEditable = false
): EventTarget {
  const node: MockNode = {
    attributes,
    isContentEditable,
    parent,
    tagName: tagName.toUpperCase(),
  };
  node.closest = (selector: string) => findClosest(node, selector);
  return node as unknown as EventTarget;
}

describe("isInteractiveTarget", () => {
  test("returns false for non-element or null targets", () => {
    expect(isInteractiveTarget(null)).toBe(false);
    expect(isInteractiveTarget(undefined as unknown as EventTarget)).toBe(
      false
    );
    expect(isInteractiveTarget({} as unknown as EventTarget)).toBe(false);
  });

  test("returns false for non-interactive elements", () => {
    const article = createNode("article");
    const div = createNode("div", {}, article as unknown as MockNode);
    const p = createNode("p", {}, div as unknown as MockNode);
    const span = createNode("span", {}, p as unknown as MockNode);

    expect(isInteractiveTarget(article)).toBe(false);
    expect(isInteractiveTarget(div)).toBe(false);
    expect(isInteractiveTarget(p)).toBe(false);
    expect(isInteractiveTarget(span)).toBe(false);
  });

  test("returns true for textarea inputs (such as the eddie/comment composer)", () => {
    const form = createNode("form");
    const textarea = createNode("textarea", {}, form as unknown as MockNode);

    expect(isInteractiveTarget(textarea)).toBe(true);
  });

  test("returns true for input elements", () => {
    const input = createNode("input");
    expect(isInteractiveTarget(input)).toBe(true);
  });

  test("returns true for buttons and elements nested inside buttons", () => {
    const button = createNode("button");
    const icon = createNode("span", {}, button as unknown as MockNode);

    expect(isInteractiveTarget(button)).toBe(true);
    expect(isInteractiveTarget(icon)).toBe(true);
  });

  test("returns true for links and elements nested inside links", () => {
    const link = createNode("a", { href: "/users/test" });
    const avatar = createNode("span", {}, link as unknown as MockNode);

    expect(isInteractiveTarget(link)).toBe(true);
    expect(isInteractiveTarget(avatar)).toBe(true);
  });

  test("returns true for elements inside data-card-interactive container (such as FeedComments)", () => {
    const commentsContainer = createNode("div", {
      "data-card-interactive": "",
    });
    const nestedDiv = createNode(
      "div",
      {},
      commentsContainer as unknown as MockNode
    );
    const commentText = createNode("p", {}, nestedDiv as unknown as MockNode);

    expect(isInteractiveTarget(commentsContainer)).toBe(true);
    expect(isInteractiveTarget(nestedDiv)).toBe(true);
    expect(isInteractiveTarget(commentText)).toBe(true);
  });

  test("returns true for ARIA interactive roles", () => {
    const buttonRole = createNode("div", { role: "button" });
    expect(isInteractiveTarget(buttonRole)).toBe(true);

    const checkboxRole = createNode("div", { role: "checkbox" });
    expect(isInteractiveTarget(checkboxRole)).toBe(true);

    const menuitemRole = createNode("div", { role: "menuitem" });
    expect(isInteractiveTarget(menuitemRole)).toBe(true);
  });

  test("returns true for contenteditable elements", () => {
    const editableDiv = createNode("div", {}, null, true);
    expect(isInteractiveTarget(editableDiv)).toBe(true);
  });
});
