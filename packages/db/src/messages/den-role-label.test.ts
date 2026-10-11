import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import nodePath from "node:path";

// The den surface says "Elder", not "admin".
//
// The stored value is still ADMIN and always will be: renaming the enum would
// rewrite every row and every comparison in the product to change a word on a
// screen. So the label lives in the display layer, which means the only thing
// keeping it there is somebody noticing that a second copy crept in - a sentence
// in a service, a menu label, an aria-label, a toast. Those all read like
// ordinary work, so this is a source scan rather than a list of assertions
// somebody has to remember to extend.
//
// What it looks for is narrow on purpose. Comments are stripped, because a comment
// is allowed to say ADMIN when it means the column, and the whole point of not
// renaming the column is that plenty of places still have to. The stored role
// values themselves are stripped, in both the shapes they appear in - a quoted
// literal and an enum-keyed record key - because `role === "ADMIN"` is the rule
// and `ADMIN: "Elder"` is the label, and neither is copy a person reads. What is
// left is code and strings, and anything left that says "admin" is either a
// mistake or a fact about the platform's own administrators, which is a different
// role entirely and is not in these directories.
//
// Test files are excluded, and not as an allowance: a fixture that writes a role
// value is stating a stored row, and a fixture whose user id happens to be the
// word "admin" is not a label. A copy regression inside a test is caught by the
// direct assertions in `den-permissions.test.ts` and the route tests, which are
// where copy is actually asserted.
//
// The second scan is the one a grep for the word cannot do. The details header
// used to render `den.myRole.toLowerCase()`, which prints "admin" without the
// word appearing anywhere in the source. So this also refuses any line that
// lowercases something named like a role, which forces the label through
// `denRoleLabel` and makes that line the only way to print one.

// The den surface, and the boundary of the platform-admin concept.
//
// The platform has its own administrators - `Users.role = 'admin'`, the `/admin`
// tRPC router, the moderation helpers - and they are operators of the whole
// product rather than a rank inside somebody's group chat. They live outside
// every root below, which is the carve-out: this sweep is scoped to the den, and
// the test at the bottom proves those files still say what they always said.
const DEN_SURFACE_ROOTS = [
  "apps/web/src/app/(main)/messages",
  "apps/web/src/app/api/messages",
  "apps/web/src/components/messages",
  "apps/web/src/lib/messages",
  "packages/db/src/messages",
  "packages/notifications/src",
];

// The stored role values, in the two forms they take in this surface: a string
// literal (`role === "ADMIN"`, `role: "ADMIN" | "MEMBER"`) and a key in a record
// keyed by role (`ADMIN: "Elder"`). Stripping them is what lets the scan exist at
// all - without it, every correct comparison in the file would be an offence.
const ROLE_IDENTIFIER = "(?:OWNER|ADMIN|MEMBER)";
const STORED_ROLE = new RegExp(
  `(["'\`])${ROLE_IDENTIFIER}\\1|\\b${ROLE_IDENTIFIER}(?=\\s*:)`,
  "gu"
);

// A member access on something named like a role, immediately lowercased. The
// trailing `\w*` matters: `myRole.toLowerCase()` is the bug, and `role.toLowerCase()`
// is the same bug wearing a shorter hat.
const LOWERCASED_ROLE = /\b\w*roles?\w*\.toLowerCase\(\)/iu;

// The two lines in the den surface that say "admin" about something that is not a
// den role, with the reason they are not a label. This is an allowance list, and
// the finding is that it has to exist and be this short: a name of an artefact is
// not product copy, and nothing else in a den surface has any business matching.
//
// Both entries are the same artefact - the Firebase Admin SDK's service-account
// file, which is named after the SDK and not after anybody's rank.
const ALLOWED = [
  {
    file: "packages/notifications/src/server/fcm.ts",
    literal: "asocialmedia-adminsdk.json",
    reason: "The Firebase Admin SDK's service-account filename, not a role.",
  },
] as const;

function isAllowed(relative: string, text: string): boolean {
  return ALLOWED.some(
    (entry) => entry.file === relative && text.includes(entry.literal)
  );
}

const SELF = "packages/db/src/messages/den-role-label.test.ts";

// The repository root, found by walking up to the workspace manifest rather than
// assumed, so the test does not care which directory the runner was invoked from.
function repositoryRoot(): string {
  let dir = nodePath.dirname(new URL(import.meta.url).pathname);
  while (dir !== "/" && dir !== ".") {
    if (existsSync(nodePath.join(dir, "package.json"))) {
      const manifest = readFileSync(
        nodePath.join(dir, "package.json"),
        "utf-8"
      );
      if (manifest.includes('"workspaces"')) {
        return dir;
      }
    }
    dir = nodePath.dirname(dir);
  }
  throw new Error("could not locate the repository root from import.meta.url");
}

function sourceFiles(root: string, dir: string): string[] {
  const absolute = nodePath.resolve(root, dir);
  if (!existsSync(absolute)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = nodePath.join(absolute, entry);
    if (statSync(child).isDirectory()) {
      found.push(...sourceFiles(root, child));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      found.push(child);
    }
  }
  return found;
}

// Strips a trailing `//` comment and a JSX `{/* ... */}` one. A `//` inside a
// string is not handled, because none of the den copy contains one and a wrong
// strip would only ever remove less, never more.
function stripComments(line: string): string {
  return line.replaceAll(/\{\/\*[\s\S]*?\*\/\}/gu, "").split("//")[0] ?? "";
}

interface Offence {
  file: string;
  line: number;
  rule: "lowercased role" | "user-facing admin";
  text: string;
}

function scanFile(root: string, path: string): Offence[] {
  const relative = path.slice(root.length + 1);
  if (relative === SELF) {
    return [];
  }
  // The exclusion is about fixtures, and it is stated where it is applied so a
  // reader does not have to find it in prose above.
  if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) {
    return [];
  }
  const offences: Offence[] = [];
  const lines = readFileSync(path, "utf-8").split("\n");
  for (const [index, raw] of lines.entries()) {
    const code = stripComments(raw).replaceAll(STORED_ROLE, "");
    if (/admin/iu.test(code) && !isAllowed(relative, raw)) {
      offences.push({
        file: relative,
        line: index + 1,
        rule: "user-facing admin",
        text: raw.trim(),
      });
    }
    if (LOWERCASED_ROLE.test(code)) {
      offences.push({
        file: relative,
        line: index + 1,
        rule: "lowercased role",
        text: raw.trim(),
      });
    }
  }
  return offences;
}

const root = repositoryRoot();
const files = DEN_SURFACE_ROOTS.flatMap((dir) => sourceFiles(root, dir));
const offences = files.flatMap((path) => scanFile(root, path));

describe("the den surface does not say admin", () => {
  test("the scan covers the den surface, so it is not vacuously green", () => {
    // A scan that found no files would pass every assertion below for the wrong
    // reason, which is the failure mode a source-scanning test actually has. The
    // named files are the ones most likely to grow copy.
    expect(files.length).toBeGreaterThan(50);
    for (const expected of [
      "apps/web/src/components/messages/den-panel.tsx",
      "apps/web/src/lib/messages/den-permissions.ts",
      "packages/db/src/messages/den-service.ts",
    ]) {
      expect(files.some((path) => path.endsWith(expected))).toBe(true);
    }
  });

  test("no copy, string or aria-label in the den surface says admin", () => {
    // The elevated den role is an Elder everywhere a person can read it. Comments
    // and stored role values are stripped before this runs, so anything reported
    // here is a word somebody is about to show somebody.
    const found = offences
      .filter((offence) => offence.rule === "user-facing admin")
      .map((offence) => `${offence.file}:${offence.line} - ${offence.text}`);
    expect(found).toEqual([]);
  });

  test("no surface builds a label by lowercasing the stored role", () => {
    // The class of bug a word grep cannot see: `myRole.toLowerCase()` prints
    // "admin" with no such string anywhere in the source. The label has to come
    // from `denRoleLabel`, which is the one place the product's words are written
    // down.
    const found = offences
      .filter((offence) => offence.rule === "lowercased role")
      .map((offence) => `${offence.file}:${offence.line} - ${offence.text}`);
    expect(found).toEqual([]);
  });

  test("the label really is Elder, so the sweep is not passing on a rename", () => {
    // The positive control for the two assertions above. Without it, deleting the
    // word "Elder" everywhere would leave them green, and "says Elder" is the
    // actual requirement rather than the absence of a synonym.
    const permissions = readFileSync(
      nodePath.resolve(root, "apps/web/src/lib/messages/den-permissions.ts"),
      "utf-8"
    );
    expect(permissions).toContain('ADMIN: "Elder"');
    expect(permissions).toContain('OWNER: "Owner"');
    expect(permissions).toContain('MEMBER: "Member"');
    // And the server's forwarded refusal, which is the sentence a person reads
    // when a button they were allowed to press did nothing.
    const service = readFileSync(
      nodePath.resolve(root, "packages/db/src/messages/den-service.ts"),
      "utf-8"
    );
    expect(service).toContain("Only the owner or an elder can do that");
  });

  test("the platform's own administrators are a different role and are untouched", () => {
    // The carve-out, asserted. `Users.role = 'admin'` is an operator of the whole
    // product, not a rank inside a group chat, and none of it is in the den
    // surface. If a future change ever did put the word into a den directory, the
    // two assertions above would fail and this one would be the argument for why
    // the directory list needs extending instead.
    expect(
      readFileSync(
        nodePath.resolve(root, "packages/db/prisma/contract.prisma"),
        "utf-8"
      )
    ).toContain("users_admin_role_unique");
    expect(
      readFileSync(
        nodePath.resolve(root, "apps/web/src/lib/moderation/moderation.ts"),
        "utf-8"
      )
    ).toContain('role === "admin"');
    expect(
      readFileSync(
        nodePath.resolve(root, "apps/auth/src/server/routers/admin/index.ts"),
        "utf-8"
      )
    ).toContain('role === "admin"');
  });

  test("no den file sits outside the scanned roots", () => {
    // A file that grew den copy somewhere else is the way this sweep goes quietly
    // blind. The native den-link helper and the notification copy are named
    // because they are the two places a den surface has already escaped to.
    const denFiles: string[] = [];
    for (const dir of [
      "apps/web/src",
      "apps/mobile/src",
      "packages/db/src",
      "packages/notifications/src",
    ]) {
      for (const path of sourceFiles(root, dir)) {
        const relative = path.slice(root.length + 1);
        if (relative.startsWith("apps/mobile/src")) {
          continue;
        }
        const source = readFileSync(path, "utf-8");
        if (
          /\bDEN_ROLES\b|\bdenRoleLabel\b|\bDenRole\b|denAffordances/iu.test(
            source
          ) &&
          !DEN_SURFACE_ROOTS.some((scanned) => relative.startsWith(scanned))
        ) {
          denFiles.push(relative);
        }
      }
    }
    expect(denFiles).toEqual([]);
  });

  test("a den notification names no role, and the allowance list stays short", () => {
    // `packages/notifications` is in the surface because a den notification is a
    // thing a person reads, so it would be the obvious place for the role to leak
    // into a badge. It presents the two den types by glyph and colour instead, and
    // a membership-ended row deliberately says nothing about the den's roles -
    // the recipient is no longer in it and has no business being told who runs it.
    const presenter = readFileSync(
      nodePath.resolve(root, "packages/notifications/src/shared/presenter.ts"),
      "utf-8"
    );
    expect(presenter).toContain("DEN_MEMBERSHIP_ENDED");
    expect(presenter).not.toMatch(/\b(?:Owner|Elder|Admin)\b/u);

    // And the allowance list is a list, not a blanket: one entry, about a filename,
    // with its reason written down rather than implied by its absence.
    expect(ALLOWED).toHaveLength(1);
    for (const entry of ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(existsSync(nodePath.resolve(root, entry.file))).toBe(true);
    }
  });
});
