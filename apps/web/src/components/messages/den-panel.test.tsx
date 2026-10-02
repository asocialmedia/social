import { describe, expect, test } from "bun:test";

import type { DenRole } from "@asm/db/messages/dens";
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

function renderMenu(
  action: { kind: "demote" | "promote" | "remove" | "transfer" },
  busy = false
): string {
  return renderToString(
    <MemberActionMenu
      action={action}
      busy={busy}
      member={member()}
      onRemove={() => {}}
      onRole={() => {}}
      onTransfer={() => {}}
    />
  );
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
  test("the trigger is named after the action, not after the menu", () => {
    // A button whose accessible name says nothing about what pressing it does is
    // announced as a mystery, so `Manage {name}` becomes the action itself.
    // Asserted on the rendered attribute because this is the only part of a Radix
    // menu that exists before it is opened.
    expect(renderMenu({ kind: "promote" })).toContain(
      'aria-label="Make Ada an Elder"'
    );
    expect(renderMenu({ kind: "transfer" })).toContain(
      'aria-label="Hand this den to Ada"'
    );
    expect(renderMenu({ kind: "remove" })).toContain(
      'aria-label="Remove Ada from den"'
    );
    expect(renderMenu({ kind: "demote" })).toContain(
      'aria-label="Remove Ada as Elder"'
    );
  });

  test("no trigger is named after the stored role", () => {
    for (const kind of ["demote", "promote", "remove", "transfer"] as const) {
      expect(renderMenu({ kind })).not.toMatch(/admin/iu);
    }
  });

  test("the trigger is a real button, so it is keyboard operable on its own", () => {
    // Radix's trigger renders a button with a type set. The menu then opens on
    // Enter and Space because that is a button's behaviour, not a key handler
    // somebody had to remember to add to a div.
    const html = renderMenu({ kind: "transfer" });
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).not.toContain("disabled");
  });

  test("a busy panel disables the trigger rather than hiding it", () => {
    // A confirmation in flight owns the row. Removing the button would reflow the
    // roster under the reader's cursor mid-request; disabling it says the same
    // thing without moving anything.
    expect(renderMenu({ kind: "transfer" }, true)).toContain("disabled");
  });
});
