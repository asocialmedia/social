import { describe, expect, test } from "bun:test";

import type { DenRole } from "@asm/db/messages/dens";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { renderToString } from "react-dom/server";

import type { DenMember } from "@/lib/messages/client";

import { MemberActionMenu, RoleChip } from "./den-panel";

// The two presentational pieces of a roster row, rendered rather than asserted on
// the pure helpers alone.
//
// What a row is ALLOWED to offer is decided in `den-permissions.ts` and asserted
// there across the whole viewer-by-role matrix. What can only be checked here is
// what the panel actually draws, and both of these are claims about absence: a
// chip that is not rendered, and an accessible name that is not "Manage Ada". No
// assertion on a pure helper can see either, and both are exactly what a redesign
// quietly puts back.

function member(overrides: Partial<DenMember> = {}): DenMember {
  return {
    avatarUrl: null,
    badge: null,
    badges: [],
    displayName: "Ada",
    id: "u-ada",
    invitedById: null,
    role: "MEMBER",
    username: "ada",
    ...overrides,
  };
}

// The three stored roles as bindings rather than literals. Two reasons, both
// mechanical: a `role="ADMIN"` in a test reads to the a11y linter like an ARIA
// role, and these tests are about the DISPLAY layer translating stored values, so
// naming them once here keeps each assertion about the translation.
const OWNER: DenRole = "OWNER";
const ELDER: DenRole = "ADMIN";
const MEMBER: DenRole = "MEMBER";

// The stored names themselves, so "the chip does not print the column's value" is
// one assertion rather than three guesses.
const ROLE_NAMES = new RegExp([OWNER, ELDER, MEMBER].join("|"), "u");

// React separates adjacent text nodes with a comment marker, so a rendered `+1`
// arrives as `+<!-- -->1`. Stripping them keeps the assertion about what a person
// sees rather than about how React serialises it.
function visible(html: string): string {
  return html.replaceAll(/<!--.*?-->/gu, "");
}

// Every action, so a helper that forgot a handler could not render the row that uses
// it. The `onBan` in particular was missing here while the component required it, and
// nothing caught it: test files are excluded from the app's typecheck, so a stale
// fixture is only visible where a test renders the row that needs it.
const EVERY_ACTION = [
  "ban",
  "demote",
  "promote",
  "remove",
  "transfer",
] as const;

function renderMenu(
  actions: (typeof EVERY_ACTION)[number][],
  busy = false
): string {
  return renderToString(
    <MemberActionMenu
      actions={actions}
      busy={busy}
      member={member()}
      onBan={() => {}}
      onRemove={() => {}}
      onRole={() => {}}
      onTransfer={() => {}}
    />
  );
}

// The menu's items, read off the element tree. A Radix menu is unmounted until it
// opens, so this is the only way to see what a row actually offers.
interface MenuItem {
  label: string;
  select: (() => void) | undefined;
}

function menuItems(node: ReactNode, found: MenuItem[] = []): MenuItem[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      menuItems(child, found);
    }
    return found;
  }
  if (!isValidElement(node)) {
    return found;
  }
  const props = node.props as {
    children?: ReactNode;
    onSelect?: () => void;
  };
  if (typeof props.onSelect === "function") {
    const text = nodeText(props.children);
    if (text) {
      found.push({ label: text, select: props.onSelect });
    }
  }
  if (props.children) {
    menuItems(props.children, found);
  }
  return found;
}

function menuTree(
  actions: (typeof EVERY_ACTION)[number][],
  handlers: Partial<{
    onBan: () => void;
    onRemove: () => void;
    onRole: (role: "ADMIN" | "MEMBER") => void;
    onTransfer: () => void;
  }> = {}
): ReactNode {
  return MemberActionMenu({
    actions: [...actions],
    busy: false,
    member: member(),
    onBan: handlers.onBan ?? (() => {}),
    onRemove: handlers.onRemove ?? (() => {}),
    onRole: handlers.onRole ?? (() => {}),
    onTransfer: handlers.onTransfer ?? (() => {}),
  });
}

function menuItemLabels(actions: (typeof EVERY_ACTION)[number][]): string[] {
  return menuItems(menuTree(actions)).map((item) => item.label);
}

// The text under an element, flattened. Icons render as SVG with no text, so they
// simply contribute nothing here.
function nodeText(node: ReactNode): string {
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

describe("RoleChip", () => {
  test("a plain Member gets no chip at all", () => {
    // Not an empty chip, not a greyed one: nothing. The default state is not an
    // achievement, and a chip on every row of a hundred-member roster makes the two
    // roles that grant something read as decoration rather than as authority.
    expect(visible(renderToString(<RoleChip role={MEMBER} />))).toBe("");
  });

  test("the owner keeps the crown and its own colour", () => {
    const html = visible(renderToString(<RoleChip role={OWNER} />));
    expect(html).toContain("Owner");
    // The crown is the part that reads without colour, and it is aria-hidden: the
    // word beside it is the name, so a screen reader is not told "crown, Owner".
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("text-[#ff9500]");
  });

  test("an Elder keeps its accent, and is called an Elder", () => {
    const html = visible(renderToString(<RoleChip role={ELDER} />));
    expect(html).toContain("Elder");
    expect(html).toContain("text-primary");
    // No crown: one row carries one mark, or a den with an owner and two Elders
    // reads as three owners.
    expect(html).not.toContain("<svg");
  });

  test("only the two special roles are chip-3d", () => {
    // The recipe is what gives a chip its edge, so its absence is the assertion as
    // much as its presence is.
    expect(renderToString(<RoleChip role={ELDER} />)).toContain("chip-3d");
    expect(renderToString(<RoleChip role={OWNER} />)).toContain("chip-3d");
    expect(renderToString(<RoleChip role={MEMBER} />)).not.toContain("chip-3d");
  });

  test("every stored role renders, and none of them renders a stored name", () => {
    // A fourth role added to the table would have to render SOMETHING here, and
    // whatever it renders must be the product's word rather than the column's.
    for (const role of [OWNER, ELDER, MEMBER]) {
      const html = visible(renderToString(<RoleChip role={role} />));
      expect(html).not.toMatch(ROLE_NAMES);
      expect(html).not.toMatch(/admin/iu);
    }
  });
});

describe("MemberActionMenu", () => {
  test("a row with one action is triggered by a button named after it", () => {
    // A button whose accessible name says nothing about what pressing it does is
    // announced as a mystery, so with nothing to disambiguate the trigger carries
    // the action's own words rather than "Manage Ada".
    // Asserted on the rendered attribute because this is the only part of a Radix
    // menu that exists before it is opened.
    expect(renderMenu(["promote"])).toContain('aria-label="Make Ada an Elder"');
    expect(renderMenu(["transfer"])).toContain(
      'aria-label="Hand this den to Ada"'
    );
    expect(renderMenu(["remove"])).toContain(
      'aria-label="Remove Ada from den"'
    );
    expect(renderMenu(["demote"])).toContain(
      'aria-label="Remove Ada as Elder"'
    );
    expect(renderMenu(["ban"])).toContain('aria-label="Ban Ada from den"');
  });

  // The two words a manager has to be able to tell apart, asserted as a pair on the
  // same menu. "Remove Ada from den" and "Ban Ada from den" are different decisions
  // about the same person, and one of them cannot be undone by the other, so a menu
  // that drew the first without the second would be hiding the tool.
  //
  // On the element tree rather than on rendered HTML: Radix keeps its items unmounted
  // until the menu opens, so `renderToString` sees only the trigger. Calling the
  // component returns exactly the tree React renders, which is enough to read the
  // labels and - more importantly - the handler each one is wired to.
  test("a row offering both names both, and draws ban last", () => {
    const labels = menuItemLabels(["remove", "ban"]);
    expect(labels).toContain("Remove Ada from den");
    expect(labels).toContain("Ban Ada from den");
    // Ban last, so it is never the entry a reaching hand lands on first.
    expect(labels.at(-1)).toBe("Ban Ada from den");
    // And the trigger names the row rather than picking one of the two.
    expect(renderMenu(["remove", "ban"])).toContain('aria-label="Manage Ada"');
  });

  // The wiring is the part that cannot be asserted from HTML: a menu item rendered
  // with no handler, or with the wrong one, still looks perfect.
  test("ban and remove are wired to different handlers", () => {
    let banned = 0;
    let removed = 0;
    const tree = menuTree(["remove", "ban"], {
      onBan: () => {
        banned += 1;
      },
      onRemove: () => {
        removed += 1;
      },
    });
    for (const item of menuItems(tree)) {
      if (item.label.startsWith("Ban ")) {
        item.select?.();
      }
      if (item.label.startsWith("Remove ")) {
        item.select?.();
      }
    }
    // Pressing both must do both, and neither may run the other. A menu where Ban
    // fell through to onRemove would remove without closing the door, which is the
    // one outcome this whole feature exists to make impossible to reach by accident.
    expect(banned).toBe(1);
    expect(removed).toBe(1);
  });

  test("a row with several actions is triggered by its subject", () => {
    // The owner's Elder row. Naming the trigger after whichever action happened to
    // be first would describe an operation the reader did not choose, and naming it
    // after the row is the only honest label when the menu carries three moves.
    expect(renderMenu(["transfer", "demote", "remove"])).toContain(
      'aria-label="Manage Ada"'
    );
  });

  test("no trigger is named after the stored role", () => {
    for (const actions of [
      ["ban"],
      ["demote"],
      ["promote"],
      ["remove"],
      ["transfer"],
      ["remove", "ban"],
      ["transfer", "demote", "remove", "ban"],
    ] as const) {
      expect(renderMenu([...actions])).not.toMatch(/admin/iu);
    }
  });

  test("the trigger is a real button, so it is keyboard operable on its own", () => {
    // Radix's trigger renders a button with a type set. The menu then opens on
    // Enter and Space because that is a button's behaviour, not a key handler
    // somebody had to remember to add to a div.
    const html = renderMenu(["transfer"]);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).not.toContain("disabled");
  });

  test("a busy panel disables the trigger rather than hiding it", () => {
    // A confirmation in flight owns the row. Removing the button would reflow the
    // roster under the reader's cursor mid-request; disabling it says the same
    // thing without moving anything.
    expect(renderMenu(["transfer"], true)).toContain("disabled");
  });
});
