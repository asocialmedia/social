import { describe, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import {
  ACCESS_ENDED_DISMISS_LABEL,
  ACCESS_ENDED_MESSAGE,
} from "@/lib/messages/access-ended";
import type { ConversationDetailResponse } from "@/lib/messages/client";

import { MessageAccessEndedNotice } from "./message-access-ended-notice";
import { MessageComposer } from "./message-composer";
import { MessageIdentityProvider } from "./message-identity-provider";

// The notice a removed member is given, and the controls that stay greyed out
// around it.
//
// There is no DOM in this repo's test tooling — bun has no built-in one and the
// repo has deliberately not added one — so everything here renders through
// `renderToString` the way `den-panel.test.tsx` does. That covers everything
// about what is DRAWN: the exact words, a real button, the live region and what
// is inside it, and which controls are disabled. The one thing SSR cannot do is
// dispatch a press, so that is asserted on the element tree instead — the notice
// is a pure function of its props, so calling it returns exactly the tree React
// renders, and the handler on that tree is the handler the button runs.

// React separates adjacent text nodes with a comment marker, so rendered text
// arrives with `<!-- -->` threaded through it. Stripping the markup and decoding
// the entities leaves what a person actually reads, which is what the copy
// assertions below are about.
function renderedText(html: string): string {
  return html
    .replaceAll(/<!--.*?-->/gu, "")
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function innerOf(html: string, openTag: string, tagName: string): string {
  const match = html.match(
    new RegExp(`${openTag}[^>]*>([\\s\\S]*?)<\\/${tagName}>`)
  );
  return renderedText(match?.[1] ?? "");
}

function buttonTag(html: string, ariaLabel: string): string {
  return (
    html.match(
      new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>`)
    )?.[0] ?? ""
  );
}

function noticeHtml(): string {
  return renderToString(noticeTree(() => {}));
}

// The composer's den detail. A real fixture rather than a cast, so a change to
// the conversation shape breaks this file instead of quietly passing it.
function conversationDetail(): ConversationDetailResponse {
  return {
    conversation: {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      createdById: "u-grace",
      id: "c-den",
      keys: [],
      members: [
        {
          conversationId: "c-den",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          lastReadAt: null,
          role: "OWNER",
          user: {
            avatarUrl: null,
            badge: null,
            badges: [],
            communityMemberships: [],
            displayName: "Grace",
            id: "u-grace",
            messageIdentity: null,
            username: "grace",
          },
          userId: "u-grace",
        },
      ],
      name: "Study group",
      ownerId: "u-grace",
      pairKey: null,
      type: "DEN",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    keys: [],
    mySentCount: 0,
    prefs: {
      mutedAt: null,
      themeKey: null,
      wallpaperDim: null,
      wallpaperKey: null,
      wallpaperMediaId: null,
    },
  };
}

function renderComposer({
  accessEnded = false,
  accessNoticeDismissed = false,
}: {
  accessEnded?: boolean;
  accessNoticeDismissed?: boolean;
} = {}): string {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MessageIdentityProvider>
        <MessageComposer
          accessEnded={accessEnded}
          accessNoticeDismissed={accessNoticeDismissed}
          conversation={conversationDetail()}
          editTarget={null}
          replyTarget={null}
          onAccessNoticeDismiss={() => {}}
          onDraftInput={() => {}}
          onEditCancel={() => {}}
          onEditSave={() => true}
          onReplyCancel={() => {}}
          onSent={() => {}}
        />
      </MessageIdentityProvider>
    </QueryClientProvider>
  );
}

// The notice renders against exactly one input, so its props are its whole API.
interface NoticeProps {
  children?: ReactNode;
  onClick?: () => void;
  type?: string;
}

function noticeTree(onDismiss: () => void): ReactNode {
  return MessageAccessEndedNotice({ onDismiss });
}

// Every press the notice wires up, walked rather than indexed, so a redesign
// that moved the button or added a second one still has to pass the same
// assertions about what those presses do.
function pressHandlers(node: ReactNode, found: (() => void)[] = []) {
  if (Array.isArray(node)) {
    for (const child of node) {
      pressHandlers(child, found);
    }
    return found;
  }
  if (!isValidElement<NoticeProps>(node)) {
    return found;
  }
  const { children, onClick } = node.props;
  if (onClick) {
    found.push(onClick);
  }
  return pressHandlers(children, found);
}

describe("MessageAccessEndedNotice", () => {
  test("says the product's sentence", () => {
    expect(innerOf(noticeHtml(), "<output", "output")).toBe(
      ACCESS_ENDED_MESSAGE
    );
    expect(ACCESS_ENDED_MESSAGE).toBe(
      "Looks like you've lost your spot in this den"
    );
  });

  // The rendered text, not the constant and not a prop: the label is only right
  // if the markup produces exactly these characters, emoticon included.
  test("the button reads exactly `Fair enough :(`", () => {
    expect(innerOf(noticeHtml(), "<button", "button")).toBe(
      ACCESS_ENDED_DISMISS_LABEL
    );
    expect(ACCESS_ENDED_DISMISS_LABEL).toBe("Fair enough :(");
  });

  test("the button is a real button of type button, so it is keyboard operable", () => {
    // Enter and Space on a button are the browser's, not a key handler somebody
    // had to remember to add to a span. `type="button"` because the composer is
    // not inside a form today, and a control that quietly became a submit button
    // the day somebody wrapped it in one would post a message nobody wrote.
    const html = noticeHtml();
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("formaction");
  });

  test("the button's own text is its accessible name", () => {
    // No `aria-label` over the top of it, so there is nothing to drift away from
    // what is on screen and nothing to translate twice.
    const html = noticeHtml();
    expect(html.match(/<button[^>]*>/u)?.[0]).not.toContain("aria-label");
    expect(html).not.toContain("aria-labelledby");
  });

  test("nothing grabs focus on its own", () => {
    // The press removes the control that held focus, so focus is left where the
    // browser puts it rather than being yanked somewhere deliberate. Every other
    // composer control is disabled while the removal stands, so there is no
    // better neighbour to move it to, and pulling focus into the transcript would
    // take the reader out of the composer for a bar that only had to disappear.
    const html = noticeHtml();
    expect(html).not.toContain("autofocus");
    expect(html).not.toContain("tabindex");
  });

  // The live region holds the news and nothing else. A control nested inside one
  // is announced as part of the region rather than as itself on more than one
  // screen reader, so what the reader hears would depend on which one they use.
  test("the button sits beside the live region, not inside it", () => {
    const live = innerOf(noticeHtml(), "<output", "output");
    expect(live).toBe(ACCESS_ENDED_MESSAGE);
    expect(live).not.toContain("Fair enough");
    // And the wrapper is not a second live region, so the news is announced once.
    expect(noticeHtml()).not.toContain('role="alert"');
    expect(noticeHtml()).not.toContain("aria-live");
  });

  // The press. One handler, it is the prop the composer passed, and running it
  // does nothing but call it: there is no request to make, nothing to delete and
  // nowhere to navigate to.
  test("the press does one thing, and that thing is the acknowledgement", () => {
    let presses = 0;
    const [handler, ...extra] = pressHandlers(
      noticeTree(() => {
        presses += 1;
      })
    );
    expect(extra).toHaveLength(0);
    handler?.();
    expect(presses).toBe(1);
  });

  test("the press issues no request", () => {
    const fetchSpy = mock<typeof fetch>(() =>
      Promise.reject(new Error("no network here"))
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      pressHandlers(noticeTree(() => {}))[0]?.();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("MessageComposer's removal notice", () => {
  test("is drawn when the server says this member is out", () => {
    const html = renderedText(renderComposer({ accessEnded: true }));
    expect(html).toContain("Looks like you've lost your spot in this den");
    expect(html).toContain("Fair enough :(");
  });

  test("is not drawn for a member who is still inside the den", () => {
    const html = renderedText(renderComposer({ accessEnded: false }));
    expect(html).not.toContain("Looks like you've lost your spot in this den");
    expect(html).not.toContain("Fair enough :(");
  });

  // The press, as the composer renders it: the acknowledgement flag flips and the
  // notice goes, with no other consequence for the markup.
  test("the acknowledgement takes the notice away", () => {
    const html = renderedText(
      renderComposer({ accessEnded: true, accessNoticeDismissed: true })
    );
    expect(html).not.toContain("Looks like you've lost your spot in this den");
    expect(html).not.toContain("Fair enough :(");
  });

  // Why the notice is drawn INSTEAD OF the input row, which is the bug it
  // replaces: the row holds the draft. Being removed mid-sentence must not cost
  // what was being written, so the row is still here after the notice has been
  // put away, with its label and its controlled value intact.
  test("the input row survives both the removal and the dismissal", () => {
    for (const accessNoticeDismissed of [false, true]) {
      const html = renderComposer({ accessEnded: true, accessNoticeDismissed });
      expect(html).toContain("<textarea");
      expect(html).toContain('aria-label="Message"');
      // No `value` attribute on a controlled textarea means React still owns the
      // text, so the draft lives in state and no render here reset it.
      expect(html).toMatch(/<textarea(?![^>]*\bvalue=)[^>]*>/u);
      expect(html).not.toContain("<form");
    }
  });

  // Every write path, unchanged by either the removal or the acknowledgement.
  // These gates are what the reader is left with once the notice is gone, so a
  // dismissal that quietly re-enabled any of them would be the whole bug.
  test("send, attach and GIF stay disabled after the dismissal", () => {
    for (const accessNoticeDismissed of [false, true]) {
      const html = renderComposer({ accessEnded: true, accessNoticeDismissed });
      for (const ariaLabel of [
        "Send image",
        "Search and add a GIF",
        "Send message",
      ]) {
        expect(buttonTag(html, ariaLabel)).toContain("disabled");
      }
      // The textarea is the fourth gate: it is what stops a pasted attachment
      // and what stops the Enter key, so it carries the same flag.
      expect(html).toMatch(/<textarea[^>]*disabled=""/u);
    }
  });

  test("the gates are open for a member who is still inside the den", () => {
    // The control case, so the assertion above is about the removal rather than
    // about a composer that disables everything all the time.
    const html = renderComposer({ accessEnded: false });
    expect(buttonTag(html, "Send image")).not.toContain("disabled");
    expect(buttonTag(html, "Search and add a GIF")).not.toContain("disabled");
    expect(html).not.toMatch(/<textarea[^>]*disabled=""/u);
  });

  test("the notice is announced rather than raised as an error", () => {
    // `<output>` is an implicit polite live region, so the news is announced
    // without interrupting. Nothing here claims something broke, because nothing
    // did: the reader is out of the den and every read path still works.
    const html = renderComposer({ accessEnded: true });
    expect(html).toContain("<output");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-invalid");
  });
});
