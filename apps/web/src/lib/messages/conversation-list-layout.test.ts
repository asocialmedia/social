// How much of the conversation list shows, which depends on whether a conversation
// is open and how wide the window is.

import { describe, expect, test } from "bun:test";

import { conversationListLayout } from "./conversation-list-layout";

describe("conversationListLayout", () => {
  test("with nothing open the list is the surface, at every width", () => {
    expect(
      conversationListLayout({ conversationOpen: false, desktopViewport: true })
    ).toBe("full");
    expect(
      conversationListLayout({
        conversationOpen: false,
        desktopViewport: false,
      })
    ).toBe("full");
  });

  test("a desktop gives an open conversation the room instead", () => {
    expect(
      conversationListLayout({ conversationOpen: true, desktopViewport: true })
    ).toBe("rail");
  });

  // A rail on a phone is 64px taken from the transcript to duplicate a control the
  // back button already is.
  test("a phone shows one pane at a time", () => {
    expect(
      conversationListLayout({ conversationOpen: true, desktopViewport: false })
    ).toBe("hidden");
  });

  test("explicit collapse on desktop toggles between rail and full", () => {
    // Collapsing with no conversation open yields rail.
    expect(
      conversationListLayout({
        collapsed: true,
        conversationOpen: false,
        desktopViewport: true,
      })
    ).toBe("rail");
    // Expanding with a conversation open yields full list.
    expect(
      conversationListLayout({
        collapsed: false,
        conversationOpen: true,
        desktopViewport: true,
      })
    ).toBe("full");
  });

  test("phone ignores desktop collapse toggle and keeps single-pane behavior", () => {
    expect(
      conversationListLayout({
        collapsed: true,
        conversationOpen: false,
        desktopViewport: false,
      })
    ).toBe("full");
    expect(
      conversationListLayout({
        collapsed: false,
        conversationOpen: true,
        desktopViewport: false,
      })
    ).toBe("hidden");
  });

  test("every input resolves to exactly one layout", () => {
    for (const conversationOpen of [true, false]) {
      for (const desktopViewport of [true, false]) {
        for (const collapsed of [undefined, true, false]) {
          expect(["full", "hidden", "rail"]).toContain(
            conversationListLayout({
              collapsed,
              conversationOpen,
              desktopViewport,
            })
          );
        }
      }
    }
  });
});
