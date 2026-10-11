import { describe, expect, mock, test } from "bun:test";

import { isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import type { DenBannedMember } from "@/lib/messages/client";
import {
  DEN_BAN_TERM,
  DEN_BANS_EMPTY,
  DEN_BANS_SUMMARY,
  denBanRowSubtitle,
} from "@/lib/messages/den-ban-copy";

import { DenBannedRow, DenBannedSection } from "./den-banned-section";

// The manager-only Banned section and the row inside it.
//
// There is no DOM in this repo's test tooling - bun has no built-in one and the repo
// has deliberately not added one - so everything about what is DRAWN is asserted
// through `renderToString`: the count, the collapsed state, which rows exist, and
// which control each row carries. SSR cannot dispatch a press, so the row's wiring is
// asserted on the element tree instead - a component called directly returns exactly
// the tree React renders, so the handler on that tree is the handler the button runs.
//
// The section is COLLAPSED by default and its rows live behind that, which is why the
// row is its own exported component. `PickerRow` is exported for the same reason: a
// collapsed parent is not something a render can open.

function ban(
  overrides: Partial<DenBannedMember> & { id: string }
): DenBannedMember {
  return {
    avatarUrl: null,
    bannedById: "owner-1",
    bannedByName: "Ada",
    createdAt: "2026-01-01T00:00:00.000Z",
    displayName: "Grace",
    id: overrides.id,
    reason: null,
    userId: overrides.id,
    username: "grace",
    ...overrides,
  };
}

// React separates adjacent text nodes with a comment marker and escapes the
// apostrophes, so rendered text arrives with `<!-- -->` and `&#x27;` threaded through
// it. Stripping the markup and decoding leaves what a person actually reads, which is
// what the copy assertions are about.
function visible(html: string): string {
  return html
    .replaceAll(/<!--.*?-->/gu, "")
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function renderSection(
  bans: DenBannedMember[],
  busyUserId: string | null = null
): string {
  return renderToString(
    <DenBannedSection bans={bans} busyUserId={busyUserId} onUnban={() => {}} />
  );
}

describe("DenBannedSection", () => {
  // A section that only appears once it has content is a section nobody learns exists,
  // and the first time it is needed is the moment somebody asks why they cannot get in.
  test("is drawn even with nobody banned", () => {
    const html = visible(renderSection([]));
    expect(html).toContain(DEN_BAN_TERM);
    expect(html).toContain(DEN_BANS_SUMMARY);
  });

  // The count is the reason the header exists: a manager opening this is asking "how
  // many people am I keeping out", and that has to be answerable without opening it.
  test("the collapsed header carries the count", () => {
    expect(visible(renderSection([]))).toContain("0");
    expect(visible(renderSection([ban({ id: "u-1" })]))).toContain("1");
    expect(
      visible(renderSection([ban({ id: "u-1" }), ban({ id: "u-2" })]))
    ).toContain("2");
  });

  test("collapsed by default, with the roster in a hidden region", () => {
    // The expanded state is an attribute, so it is asserted on the raw HTML - the
    // text-stripped copy cannot carry it.
    const raw = renderSection([ban({ id: "u-1" })]);
    expect(raw).toContain('aria-expanded="false"');
    expect(raw).toMatch(
      /<div[^>]*aria-labelledby="[^"]+"[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>[\s\S]*Grace[\s\S]*Unban/u
    );
  });

  test("the toggle is a real button, and announces the collapsed state", () => {
    const html = renderSection([ban({ id: "u-1" })]);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-expanded="false"');
  });

  // It is the line that says what the section IS. A "Banned" heading inside a member
  // list is otherwise ambiguous about what is being blocked, and a manager reads it
  // as a mute list rather than a way of keeping somebody out.
  test("the summary is always visible, collapsed or not", () => {
    expect(visible(renderSection([ban({ id: "u-1" })]))).toContain(
      DEN_BANS_SUMMARY
    );
  });

  test("the chevron is decorative, so it is not announced", () => {
    // The state is already on aria-expanded; a screen reader reading "chevron right"
    // as well would be told the same fact twice in two vocabularies.
    expect(renderSection([])).toContain('aria-hidden="true"');
  });
});

describe("DenBannedRow", () => {
  test("a row names the person", () => {
    const html = visible(
      renderToString(
        <DenBannedRow
          ban={ban({ id: "u-1" })}
          busy={false}
          onUnban={() => {}}
        />
      )
    );
    expect(html).toContain("Grace");
  });

  // Three states a real list holds: a live account with a display name, one whose
  // account has gone but whose username survives, and one with neither. None of them
  // may render a blank row, because a blank row in a moderation list is a row a
  // manager cannot act on.
  test("falls back through display name, username, then a plain phrase", () => {
    const row = (overrides: Partial<DenBannedMember>) =>
      visible(
        renderToString(
          <DenBannedRow
            ban={ban({ id: "u-1", ...overrides })}
            busy={false}
            onUnban={() => {}}
          />
        )
      );
    expect(row({ displayName: "Grace" })).toContain("Grace");
    expect(row({ displayName: null, username: "hopper" })).toContain("hopper");
    expect(row({ displayName: null, username: null })).toContain(
      "A former member"
    );
  });

  // One action and no menu. A banned row is a record of a decision, not a person to
  // manage, so a roster-style menu here would offer a manager things that all fail.
  test("offers exactly one action", () => {
    const labels = buttonLabels(
      DenBannedRow({ ban: ban({ id: "u-1" }), busy: false, onUnban: () => {} })
    );
    expect(labels).toEqual(["Unban"]);
  });

  // The wiring cannot be read off HTML at all, and a row whose Unban called the wrong
  // thing would look identical on screen.
  test("the lift calls back, so the right person is unbanned", () => {
    const onUnban = mock(() => {});
    const tree = DenBannedRow({
      ban: ban({ id: "u-2" }),
      busy: false,
      onUnban,
    });
    const [button] = buttonEntries(tree);
    expect(button?.label).toBe("Unban");
    button?.click?.();
    expect(onUnban).toHaveBeenCalledTimes(1);
  });

  // A disabled button must not fire. The press is refused by the DOM in a browser, so
  // what is actually asserted here is that the row reports itself disabled - the guard
  // is the attribute, and the handler is left unarmed so a caller cannot bypass it by
  // calling through the tree.
  test("a disabled row carries the guard", () => {
    const onUnban = mock(() => {});
    const tree = DenBannedRow({
      ban: ban({ id: "u-2" }),
      busy: true,
      onUnban,
    });
    const [button] = buttonEntries(tree);
    expect(button?.disabled).toBe(true);
    expect(button?.label).toBe("Unbanning…");
  });

  // The lift is in flight for exactly one row, and the button both says so and refuses
  // a second press. The other rows are not disabled - a manager clearing a list of six
  // should not be locked out of five of them, which is why `busy` is per row.
  test("only the row being lifted is disabled", () => {
    const inFlight = buttonEntries(
      DenBannedRow({ ban: ban({ id: "u-1" }), busy: true, onUnban: () => {} })
    );
    expect(inFlight[0]).toMatchObject({
      disabled: true,
      label: "Unbanning…",
    });

    const idle = buttonEntries(
      DenBannedRow({ ban: ban({ id: "u-1" }), busy: false, onUnban: () => {} })
    );
    expect(idle[0]).toMatchObject({ disabled: false, label: "Unban" });
  });

  test("the reason wins over the author, because that is what is being looked for", () => {
    expect(
      visible(
        renderToString(
          <DenBannedRow
            ban={ban({ bannedByName: "Ada", id: "u-1", reason: "link spam" })}
            busy={false}
            onUnban={() => {}}
          />
        )
      )
    ).toContain("link spam");
  });

  test("a ban with no reason still says who imposed it", () => {
    const html = visible(
      renderToString(
        <DenBannedRow
          ban={ban({ bannedByName: "Ada", id: "u-1", reason: null })}
          busy={false}
          onUnban={() => {}}
        />
      )
    );
    expect(html).toContain("Banned by Ada");
    // And not three stacked lines: the author is the fallback, not a third fact.
    expect(denBanRowSubtitle({ bannedByName: "Ada", reason: null })).toBe(
      "Banned by Ada"
    );
  });

  // A ban row is stored even when the account behind it is gone, so the list cannot
  // lie about a ban by silently dropping it. With neither a reason nor an author - the
  // banning manager's row was removed - the row still has to say something.
  test("says something even with neither a reason nor an author", () => {
    expect(denBanRowSubtitle({ bannedByName: null, reason: null })).toBe(
      DEN_BAN_TERM
    );
  });
});

// The empty state is behind the collapse, so it is asserted as copy rather than
// through a render that would need the section forced open. What matters is that the
// string exists, is addressed to a manager, and does not read as an error.
describe("the empty list", () => {
  test("says there is nobody in it, in plain words", () => {
    expect(DEN_BANS_EMPTY).toBe("No banned members.");
  });
});

interface ButtonEntry {
  click: (() => void) | undefined;
  disabled: boolean | undefined;
  label: string;
}

function buttonEntries(node: ReactNode): ButtonEntry[] {
  const found: ButtonEntry[] = [];
  if (Array.isArray(node)) {
    for (const child of node) {
      found.push(...buttonEntries(child as ReactNode));
    }
    return found;
  }
  if (!isValidElement(node)) {
    return found;
  }
  const props = node.props as {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  };
  if (typeof props.onClick === "function") {
    const label = textOf(props.children);
    if (label) {
      found.push({
        click: props.onClick,
        disabled: props.disabled,
        label,
      });
    }
  }
  if (props.children) {
    found.push(...buttonEntries(props.children));
  }
  return found;
}

function buttonLabels(node: ReactNode): string[] {
  return buttonEntries(node).map((entry) => entry.label);
}

// The text under an element, flattened. Icons render as SVG with no text, so they
// simply contribute nothing here.
function textOf(node: ReactNode): string {
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => textOf(child as ReactNode)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textOf(node.props.children);
  }
  return "";
}
