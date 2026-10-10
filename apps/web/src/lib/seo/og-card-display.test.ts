import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Satori (the renderer behind next/og) refuses to lay out any <div> that has
// children but no explicit `display`. It reports that as:
//
//   Expected <div> to have explicit "display: flex", "display: contents",
//   or "display: none" if it has more than one child node.
//
// The message says "more than one child", but the check it actually performs is
// `children && typeof children !== "string" && display is not flex|contents|none`
// - a single child element is enough. That error is thrown while the render
// stream is open, so it surfaces as "failed to pipe response" and the metadata
// route answers 502. It took every real profile card in production offline while
// the not-found fallback (which has no children) kept working.
//
// These cards are almost entirely inline-styled JSX, so the invariant is cheap
// to assert directly on the source: every <div> that can hold a child must name
// a display. A render test cannot catch a regression the same way, because the
// failure only fires for the branches a fixture happens to exercise.

const OG_CARD_FILES = [
  "src/app/(main)/users/[username]/opengraph-image.tsx",
  "src/app/(main)/posts/[postId]/opengraph-image.tsx",
];

const ALLOWED_DISPLAYS = ["flex", "contents", "none"];

interface OpeningTag {
  line: number;
  text: string;
  selfClosing: boolean;
}

// Reads a JSX opening tag starting at `from`, stopping at the `>` that closes
// it. Tracks brace depth so a `>` inside a style value cannot end the tag early,
// and skips `//` comments so commented-out markup is not mistaken for real JSX.
function readOpeningTag(source: string, from: number): OpeningTag | null {
  const line = source.slice(0, from).split("\n").length;
  let depth = 0;
  let index = from;
  let text = "";

  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (char === "/" && next === "/") {
      const newline = source.indexOf("\n", index);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", index);
      index = close === -1 ? source.length : close + 2;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      // Copy the literal through so `display: "flex"` stays visible to the
      // check, but jump past it so a `>` inside a string cannot end the tag.
      const close = source.indexOf(char, index + 1);
      const end = close === -1 ? source.length : close + 1;
      text += source.slice(index, end);
      index = end;
      continue;
    }

    if (char === "{" || char === "(" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === ")" || char === "]") {
      depth -= 1;
    }

    if (char === ">" && depth === 0) {
      text += char;
      return {
        line,
        selfClosing: text.trimEnd().endsWith("/>"),
        text,
      };
    }

    text += char;
    index += 1;
  }

  return null;
}

// Blanks out comment bodies while preserving every newline, so line numbers in
// the findings still point at the real source and a comment that happens to
// mention `<div>` cannot be mistaken for markup.
function stripComments(source: string): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (char === "/" && next === "/") {
      const newline = source.indexOf("\n", index);
      const end = newline === -1 ? source.length : newline;
      output += " ".repeat(end - index);
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", index);
      const end = close === -1 ? source.length : close + 2;
      output += source.slice(index, end).replaceAll(/[^\n]/g, " ");
      index = end;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function findDivViolations(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const violations: string[] = [];
  const pattern = /<div\b/g;
  let match = pattern.exec(source);

  while (match !== null) {
    const tag = readOpeningTag(source, match.index);
    if (tag === null) {
      break;
    }

    const isChildless = tag.selfClosing;

    if (
      !isChildless &&
      !ALLOWED_DISPLAYS.some((display) =>
        tag.text.includes(`display: "${display}"`)
      )
    ) {
      violations.push(
        `line ${tag.line}: ${tag.text.replaceAll(/\s+/g, " ").slice(0, 90)}`
      );
    }

    pattern.lastIndex = match.index + tag.text.length;
    match = pattern.exec(source);
  }

  return violations;
}

describe("OG card Satori display contract", () => {
  for (const relativePath of OG_CARD_FILES) {
    test(`${path.basename(path.dirname(relativePath))} sets display on every child-bearing div`, () => {
      const absolutePath = path.resolve(
        import.meta.dirname,
        "../../..",
        relativePath
      );
      const source = readFileSync(absolutePath, "utf-8");
      const violations = findDivViolations(source);

      expect(violations).toEqual([]);
    });
  }

  test("the scanner actually flags a child-bearing div with no display", () => {
    // Guards the guard: if the scanner silently stopped matching, the tests
    // above would pass on a broken card.
    const violations = findDivViolations(
      `<div style={{ color: "red" }}>Joined {date}</div>`
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("line 1");
  });

  test("the scanner accepts the three displays Satori allows", () => {
    for (const display of ALLOWED_DISPLAYS) {
      expect(
        findDivViolations(`<div style={{ display: "${display}" }}>child</div>`)
      ).toEqual([]);
    }
  });

  test("the scanner ignores self-closing divs, which have no children", () => {
    expect(
      findDivViolations(`<div style={{ position: "absolute", width: 110 }} />`)
    ).toEqual([]);
  });
});
