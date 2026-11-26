import { expect, mock, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import CommunitySectionLinkContent from "./community-section-link-content";

const linkModule = await import("next/link");
const { useLinkStatus } = linkModule;
let pending: boolean | undefined;
mock.module("next/link", () => ({
  ...linkModule,
  useLinkStatus: () => {
    const status = useLinkStatus();
    return { pending: pending ?? status.pending };
  },
}));

test("centers the pending spinner while preserving the tab label and dimensions", () => {
  const tab = <CommunitySectionLinkContent>Chat</CommunitySectionLinkContent>;
  try {
    pending = false;
    expect(renderToStaticMarkup(tab)).not.toContain("<output");
    pending = true;
    const html = renderToStaticMarkup(tab);
    expect(html).toContain("opacity-0");
    expect(html).toContain(">Chat</span>");
    expect(html).toContain("absolute inset-0 grid place-items-center");
    expect(html).toContain("data-section-pending");
    expect(html).toContain('aria-busy="true"');
  } finally {
    pending = undefined;
  }
});
