import { describe, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import {
  ACCESS_ENDED_DESCRIPTION,
  ACCESS_ENDED_DISMISS_LABEL,
  ACCESS_ENDED_MESSAGE,
} from "@/lib/messages/access-ended";
import type { ConversationDetailResponse } from "@/lib/messages/client";

import { MessageAccessEndedDialog } from "./message-access-ended-dialog";
import { MessageComposer } from "./message-composer";
import { MessageIdentityProvider } from "./message-identity-provider";

// The popup a removed member is given, and the composer that goes quiet around it.
//
// There is no DOM in this repo's test tooling - bun has no built-in one and the
// repo has deliberately not added one - so everything here renders through
// `renderToString` the way `den-panel.test.tsx` does. That covers everything about
// what is DRAWN: the exact words, a real button, and which controls are disabled. The
// one thing SSR cannot do is dispatch a press, so that is asserted on the element tree
// instead - a component called directly returns exactly the tree React renders, so the
// handler on that tree is the handler the button runs.

// React separates adjacent text nodes with a comment marker, so rendered text arrives
// with `<!-- -->` threaded through it. Stripping the markup and decoding the entities
// leaves what a person actually reads, which is what the copy assertions are about.
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

function buttonTag(html: string, ariaLabel: string): string {
  return (
    html.match(
      new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>`)
    )?.[0] ?? ""
  );
}

// The composer's den detail, as a REAL fixture rather than a cast, so a change to the
// conversation shape breaks this file instead of quietly passing it. Two members on
// purpose: the composer's placeholder bug was about naming the wrong one of them.
type ConversationType = "DEN" | "DM";

function member(
  id: string,
  username: string,
  displayName: string,
  role: "OWNER" | "MEMBER"
) {
  return {
    conversationId: "c-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastReadAt: null,
    leftAt: null,
    mutedAt: null,
    role,
    user: {
      avatarUrl: null,
      badge: null,
      badges: [],
      communityMemberships: [],
      displayName,
      id,
      messageIdentity: null,
      username,
    },
    userId: id,
  };
}

function conversationDetail({
  type = "DEN",
}: { type?: ConversationType } = {}): ConversationDetailResponse {
  return {
    conversation: {
      avatarMediaId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      createdById: "u-me",
      id: "c-1",
      keys: [],
      members: [
        member("u-me", "mia", "Mia", "OWNER"),
        member("u-noah", "noah", "Noah", "MEMBER"),
      ],
      name: "Study group",
      ownerId: "u-me",
      pairKey: null,
      type,
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
  type = "DEN",
}: { accessEnded?: boolean; type?: "DEN" | "DM" } = {}): string {
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MessageIdentityProvider>
        <MessageComposer
          accessEnded={accessEnded}
          conversation={conversationDetail({ type })}
          editTarget={null}
          replyTarget={null}
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

// The attribute as a person reads it, so the apostrophes in "you can't" are
// compared decoded rather than against React's entity encoding.
function placeholderOf(html: string): string {
  const tag = html.match(/<textarea[^>]*>/u)?.[0] ?? "";
  return renderedText(
    tag.match(/placeholder="(?<text>[^"]*)"/u)?.groups?.text ?? ""
  );
}

// Every press the dialog wires up, and every string it renders, walked rather than
// indexed, so a redesign that moved the button or added a second one still has to pass
// the same assertions about what those presses do.
//
// Walked rather than stringified because `Dialog` renders its content through a
// portal, and `renderToString` does not follow one - the whole dialog comes back as
// an empty string. The primitives own their own markup and this repo does not test it
// anywhere else either; what is ours is the words and the wiring, so those are what is
// asserted.
interface DialogProps {
  children?: ReactNode;
  onClick?: () => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  type?: string;
}

function pressHandlers(node: ReactNode, found: (() => void)[] = []) {
  return walk(
    node,
    (props) => {
      if (props.onClick) {
        found.push(props.onClick);
      }
    },
    found
  );
}

// The text this tree composes, in the order it is written.
function textOf(node: ReactNode, found: string[] = []): string[] {
  if (typeof node === "string") {
    found.push(node);
    return found;
  }
  return walk(
    node,
    (props) => {
      if (typeof props.children === "string") {
        found.push(props.children);
      }
    },
    found
  );
}

function walk(
  node: ReactNode,
  visit: (props: DialogProps) => void,
  found: unknown[] = []
): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, visit, found);
    }
    return found;
  }
  if (isValidElement<DialogProps>(node)) {
    visit(node.props);
    walk(node.props.children, visit, found);
  }
  return found;
}

function dialogTree(onDismiss: () => void, open = true): ReactNode {
  return MessageAccessEndedDialog({ onDismiss, open });
}

describe("MessageAccessEndedDialog", () => {
  // The regression this replaced. The removal notice used to be a line directly above
  // the composer, so the news was in the quietest place on the screen and a dead input
  // sat under it with no stated reason.
  test("says the product's sentence as its title", () => {
    expect(textOf(dialogTree(() => {})).join(" ")).toContain(
      ACCESS_ENDED_MESSAGE
    );
    expect(ACCESS_ENDED_MESSAGE).toBe(
      "Looks like you've lost your spot in this den"
    );
  });

  // "You can still read this" is what tells somebody they do not have to do anything,
  // and the title cannot carry it.
  test("carries the fact the short title dropped", () => {
    expect(textOf(dialogTree(() => {})).join(" ")).toContain(
      ACCESS_ENDED_DESCRIPTION
    );
    expect(ACCESS_ENDED_DESCRIPTION).toBe(
      "You can still read this conversation, but you can't post in it."
    );
  });

  // The words, not the constant: the label is only right if the tree composes exactly
  // these characters, emoticon included.
  test("the acknowledgement is exactly `Fair enough :(`", () => {
    const text = textOf(dialogTree(() => {}));
    expect(text).toContain(ACCESS_ENDED_DISMISS_LABEL);
    expect(ACCESS_ENDED_DISMISS_LABEL).toBe("Fair enough :(");
  });

  test("the acknowledgement is a plain button that cannot submit anything", () => {
    // Enter and Space on a button are the browser's, not a key handler somebody had to
    // remember to add to a span. `type="button"` because a control that quietly became a
    // submit button the day somebody wrapped this in a form would post a message nobody
    // wrote.
    const buttons: DialogProps[] = [];
    walk(
      dialogTree(() => {}),
      (props) => {
        if (props.onClick) {
          buttons.push(props);
        }
      }
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe("button");
  });

  // The press. One handler, it is the prop the thread passed, and running it does
  // nothing but call it: there is no request to make, nothing to delete and nowhere to
  // navigate to.
  test("the press does one thing, and that thing is the acknowledgement", () => {
    let presses = 0;
    const [handler, ...extra] = pressHandlers(
      dialogTree(() => {
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
      pressHandlers(dialogTree(() => {}))[0]?.();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Closing by the escape key or a click outside is an acknowledgement too, and it must
  // reach the same handler rather than leaving the dialog stuck open.
  test("closing it dismisses it as well", () => {
    let dismissals = 0;
    const closes: ((open: boolean) => void)[] = [];
    walk(
      dialogTree(() => {
        dismissals += 1;
      }),
      (props) => {
        if (props.onOpenChange) {
          closes.push(props.onOpenChange);
        }
      }
    );
    expect(closes).toHaveLength(1);
    closes[0]?.(false);
    expect(dismissals).toBe(1);
    // Opening is not a dismissal, so the primitive's own round trip cannot dismiss it.
    closes[0]?.(true);
    expect(dismissals).toBe(1);
  });

  // A dialog, not an alert dialog: there is no decision to make. Offering a
  // destructive-looking primary action would ask the reader to confirm something that
  // already happened and cannot be undone.
  test("it asks for no confirmation", () => {
    expect(textOf(dialogTree(() => {})).join(" ")).not.toContain(
      "Are you sure"
    );
    expect(textOf(dialogTree(() => {})).join(" ")).not.toContain("Cancel");
  });

  // The thread owns the flag, so a reload after a removal opens it again rather than
  // remembering the reader dismissed it days ago in a conversation they have forgotten.
  test("open comes from the caller", () => {
    const opened: (boolean | undefined)[] = [];
    walk(
      dialogTree(() => {}, false),
      (props) => {
        if (typeof props.open === "boolean") {
          opened.push(props.open);
        }
      }
    );
    expect(opened).toContain(false);
  });
});

describe("the composer's disabled state", () => {
  // The reason a greyed input reading "Message Noah…" looked like a bug: a removed
  // member was told nothing at all about why they could not type.
  test("a removed member is told why the input is dead", () => {
    expect(placeholderOf(renderComposer({ accessEnded: true }))).toBe(
      "You can't send messages because you're not a member of this den"
    );
  });

  // The other regression, same fixture: a den the reader had just created offered
  // "Message Noah…" as though it were a private chat with one of its members.
  test("a den is addressed by its name, not by one of its members", () => {
    expect(placeholderOf(renderComposer({ type: "DEN" }))).toBe(
      "Message Study group…"
    );
  });

  // With no session resolved, the composer cannot know who the other person is and
  // says so. It used to take the first member that was not `undefined`, which named
  // whichever of them was listed first.
  test("a DM with no resolved session names nobody", () => {
    expect(placeholderOf(renderComposer({ type: "DM" }))).toBe("Message them…");
  });

  // Why the notice was drawn INSTEAD OF the input row, which is the bug it replaces:
  // the row holds the draft. Being removed mid-sentence must not cost what was being
  // written.
  test("the input row survives the removal", () => {
    const html = renderComposer({ accessEnded: true });
    expect(html).toContain("<textarea");
    expect(html).toContain('aria-label="Message"');
    // No `value` attribute on a controlled textarea means React still owns the text, so
    // the draft lives in state and no render here reset it.
    expect(html).toMatch(/<textarea(?![^>]*\bvalue=)[^>]*>/u);
    expect(html).not.toContain("<form");
  });

  // Every write path. These gates are what the reader is left with, so a change that
  // re-enabled any of them would be the whole bug.
  test("send, attach and GIF stay disabled", () => {
    const html = renderComposer({ accessEnded: true });
    for (const ariaLabel of [
      "Send image",
      "Search and add a GIF",
      "Send message",
    ]) {
      expect(buttonTag(html, ariaLabel)).toContain("disabled");
    }
    // The textarea is the fourth gate: it is what stops a pasted attachment and what
    // stops the Enter key, so it carries the same flag.
    expect(html).toMatch(/<textarea[^>]*disabled=""/u);
  });

  test("the gates are open for a member who is still inside the den", () => {
    // The control case, so the assertion above is about the removal rather than about a
    // composer that disables everything all the time.
    const html = renderComposer({ accessEnded: false });
    expect(buttonTag(html, "Send image")).not.toContain("disabled");
    expect(buttonTag(html, "Search and add a GIF")).not.toContain("disabled");
    expect(html).not.toMatch(/<textarea[^>]*disabled=""/u);
  });

  // The removal is no longer announced by anything in the composer: the dialog is the
  // single announcement, and the placeholder is the standing explanation.
  test("the composer carries no announcement of its own", () => {
    const html = renderComposer({ accessEnded: true });
    expect(html).not.toContain(ACCESS_ENDED_MESSAGE);
    expect(html).not.toContain(ACCESS_ENDED_DISMISS_LABEL);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-invalid");
  });
});
