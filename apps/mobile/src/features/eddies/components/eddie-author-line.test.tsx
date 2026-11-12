import { expect, mock, test } from "bun:test";

import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function Element({
  children,
  accessibilityLabel,
  accessibilityRole,
}: {
  children?: ReactNode;
  accessibilityLabel?: string;
  accessibilityRole?: string;
}) {
  return createElement(
    "span",
    { "aria-label": accessibilityLabel, role: accessibilityRole },
    children
  );
}
mock.module("react-native", () => ({ Text: Element, View: Element }));
mock.module("@/theme", () => ({
  useAppTheme: () => ({
    theme: { dividerText: "#646464", inputText: "#181818" },
  }),
}));
mock.module("@/features/feed/components/bluesky-icon", () => ({
  BlueskyIcon: () => createElement("svg", { "aria-label": "Bluesky" }),
}));
mock.module("@/features/home/components/user-badge", () => ({
  UserBadge: () => null,
}));

const { EddieAuthorLine } = await import("./eddie-author-line");
const author = {
  date: "14m",
  deleted: false,
  name: "Doremus Jessup",
  onOpenAuthor: () => {},
  user: null,
  username: "doremusjessup.bsky.social",
};

test("upstream comments display the Bluesky glyph beside the full author name", () => {
  const html = renderToStaticMarkup(<EddieAuthorLine {...author} bluesky />);
  expect(html).toContain('<svg aria-label="Bluesky">');
  expect(html).toContain("Doremus Jessup");
  expect(html).toContain("@doremusjessup.bsky.social");
  expect(html).not.toContain(">Bluesky<");
  expect(html).toContain('role="link"');
});

test("native and deleted authors do not inherit the upstream icon", () => {
  const native = renderToStaticMarkup(
    <EddieAuthorLine {...author} bluesky={false} />
  );
  expect(native).not.toContain("<svg");
  const deleted = renderToStaticMarkup(
    <EddieAuthorLine {...author} bluesky deleted />
  );
  expect(deleted).toContain("[deleted]");
  expect(deleted).not.toContain("<svg");
  expect(deleted).not.toContain("Doremus Jessup");
  expect(deleted).not.toContain('role="link"');
});
