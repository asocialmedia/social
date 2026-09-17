import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clampScrollTop,
  computeAnchorScrollTop,
  FEED_POST_ANCHOR_ATTRIBUTE,
  findAnchorElement,
  findTopAnchor,
} from "./feed-scroll";

// Minimal DOM stand-ins: the helpers only touch getBoundingClientRect,
// querySelector(All), getAttribute, and HTMLElement identity, so a tiny fake
// tree exercises the real code paths without a DOM library.
class FakeNode {
  children: FakeNode[] = [];
  rect = { bottom: 0, top: 0 };
  scrollHeight = 0;
  scrollTop = 0;
  clientHeight = 0;
  private attrs: Record<string, string> = {};

  setAttr(name: string, value: string) {
    this.attrs[name] = value;
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  getBoundingClientRect() {
    return {
      bottom: this.rect.bottom,
      height: this.rect.bottom - this.rect.top,
      left: 0,
      right: 0,
      top: this.rect.top,
      width: 0,
    };
  }

  append(child: FakeNode) {
    this.children.push(child);
    return this;
  }

  private static matches(node: FakeNode, selector: string): boolean {
    const prefix = `[${FEED_POST_ANCHOR_ATTRIBUTE}]`;
    if (selector === prefix) {
      return node.getAttribute(FEED_POST_ANCHOR_ATTRIBUTE) !== null;
    }
    const valueMatch = selector.match(
      /^\[data-post-id="(?<raw>(?:[^"\\]|\\.)*)"\]$/
    );
    if (!valueMatch?.groups) {
      return false;
    }
    const raw = valueMatch.groups["raw"].replaceAll(/\\(?<char>.)/g, "$<char>");
    return node.getAttribute(FEED_POST_ANCHOR_ATTRIBUTE) === raw;
  }

  querySelectorAll(selector: string): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (node: FakeNode) => {
      for (const child of node.children) {
        if (FakeNode.matches(child, selector)) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

// The helpers gate on `instanceof HTMLElement`; point it at the fake for the
// duration of this file (installed per-test so import-time ordering cannot
// wipe it before the tests run).
const g = globalThis as Record<string, unknown>;
const RealHTMLElement = g["HTMLElement"];

beforeEach(() => {
  g["HTMLElement"] = FakeNode;
});

afterEach(() => {
  g["HTMLElement"] = RealHTMLElement;
});

function asElement(node: FakeNode): HTMLElement {
  return node as unknown as HTMLElement;
}

function postCard(id: string, top: number, height: number): FakeNode {
  const node = new FakeNode();
  node.setAttr(FEED_POST_ANCHOR_ATTRIBUTE, id);
  node.rect = { bottom: top + height, top };
  return node;
}

describe("findTopAnchor", () => {
  test("returns the first post visible from the top with its offset", () => {
    const container = new FakeNode();
    container.rect = { bottom: 800, top: 0 };
    container
      .append(postCard("above", -600, 400))
      .append(postCard("top", -50, 400))
      .append(postCard("below", 350, 400));

    expect(findTopAnchor(asElement(container))).toEqual({
      id: "top",
      offset: 0,
    });
  });

  test("reports a positive offset for a post starting below the fold edge", () => {
    const container = new FakeNode();
    container.rect = { bottom: 800, top: 100 };
    container.append(postCard("p1", 150, 400));

    expect(findTopAnchor(asElement(container))).toEqual({
      id: "p1",
      offset: 50,
    });
  });

  test("returns null when no anchored post is visible", () => {
    const container = new FakeNode();
    container.rect = { bottom: 800, top: 0 };
    container.append(postCard("above", -500, 400));

    expect(findTopAnchor(asElement(container))).toBeNull();
  });

  test("skips nodes without an id", () => {
    const container = new FakeNode();
    container.rect = { bottom: 800, top: 0 };
    const anonymous = new FakeNode();
    anonymous.rect = { bottom: 300, top: -100 };
    container.append(anonymous).append(postCard("p1", 200, 400));

    expect(findTopAnchor(asElement(container))).toEqual({
      id: "p1",
      offset: 200,
    });
  });
});

describe("findAnchorElement", () => {
  test("locates the anchored post by id", () => {
    const container = new FakeNode();
    container.append(postCard("p1", 0, 400)).append(postCard("p2", 400, 400));

    const found = findAnchorElement(asElement(container), "p2");
    expect(found).not.toBeNull();
    expect(
      (found as unknown as FakeNode).getAttribute(FEED_POST_ANCHOR_ATTRIBUTE)
    ).toBe("p2");
  });

  test("returns null for an unknown id", () => {
    const container = new FakeNode();
    container.append(postCard("p1", 0, 400));

    expect(findAnchorElement(asElement(container), "missing")).toBeNull();
  });

  test("escapes hostile ids instead of breaking the selector", () => {
    const container = new FakeNode();
    container.append(postCard('a"b', 0, 400));

    expect(findAnchorElement(asElement(container), 'a"b')).not.toBeNull();
    expect(findAnchorElement(asElement(container), "a")).toBeNull();
  });
});

describe("computeAnchorScrollTop", () => {
  test("repositions the anchor to its saved offset despite drift above", () => {
    const container = new FakeNode();
    container.scrollTop = 1200;
    container.rect = { bottom: 800, top: 0 };
    const anchor = postCard("p1", 60, 400);

    // The anchor sits 60px below the viewport top but was saved at 20px:
    // scroll up by the 40px of height that appeared above it.
    expect(
      computeAnchorScrollTop(asElement(container), asElement(anchor), 20)
    ).toBe(1240);
  });
});

describe("clampScrollTop", () => {
  test("clamps to the scrollable range and rejects garbage", () => {
    const container = new FakeNode();
    container.scrollHeight = 2000;
    container.clientHeight = 800;

    expect(clampScrollTop(asElement(container), 500)).toBe(500);
    expect(clampScrollTop(asElement(container), 5000)).toBe(1200);
    expect(clampScrollTop(asElement(container), -10)).toBe(0);
    expect(clampScrollTop(asElement(container), Number.NaN)).toBe(0);
  });

  test("returns zero when content fits without scrolling", () => {
    const container = new FakeNode();
    container.scrollHeight = 400;
    container.clientHeight = 800;

    expect(clampScrollTop(asElement(container), 100)).toBe(0);
  });
});
