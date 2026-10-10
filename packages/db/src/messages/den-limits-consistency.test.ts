import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import nodePath from "node:path";

import {
  DEN_LIMITS,
  DEN_MANAGEMENT_ROLES,
  DEN_ROLES,
  canManageDen,
  canManageRole,
} from "./dens";

// DEN_LIMITS is the single source of truth for every den bound, and this test is
// the thing that keeps it that way.
//
// A duplicated limit is worse than a missing check, because it fails silently:
// `membersMax` goes to 200 in one place, the UI still stops a picker at 100, and
// the den a manager builds in the app is quietly half the size of the one the
// server accepts. Nothing errors. The only defence is making the duplication
// impossible to introduce without a test going red, which means the test has to
// look at the source rather than trust it.
//
// The scan is deliberately narrow, because a naive "does the number 100 appear"
// sweep of a TypeScript codebase returns a thousand hits (Tailwind classes,
// pixel offsets, epoch milliseconds, unrelated page sizes) and a guard nobody
// reads is not a guard. So it looks for a den-limit NUMBER in a position where a
// limit actually lives:
//
//   - code, with ordinary quoted strings blanked out. Tailwind and copy live in
//     quoted strings, and a limit in code is a comparison, an assignment, a JSX
//     prop or arithmetic - `maxLength={100}`, `count >= 100`, `= 64`.
//   - a line that is talking about a den limit in the first place, matched by
//     keyword. Without that, `HISTORY_PAGE_SIZE = 100` in the transcript route
//     would be reported as a duplicated member ceiling, and it is not one.
//   - prose inside a quoted string that spells a limit as a number followed by
//     the noun it measures, which is how copy rots: "at most 100 members" is
//     correct today and wrong the day the ceiling moves.
//
// Line comments are stripped first. A comment may NAME a limit freely
// (`DEN_LIMITS.membersMax`) and must not carry one as a literal, but a comment
// that says "membersMax - 2 of the fillers" is arithmetic about the fixture, not
// a second definition, and no amount of cleverness can tell those apart.

// Where the den surface lives. Anything that can hold a den limit: the service
// and its validators, the den routes, the messages library, the messages UI, the
// native den-link helper, and the shared notification copy.
const DEN_SURFACE_ROOTS = [
  "packages/db/src/messages",
  "apps/web/src/app/api/messages",
  "apps/web/src/lib/messages",
  "apps/web/src/components/messages",
  "apps/mobile/src/features/notifications",
  "packages/notifications/src",
];

// The one file allowed to spell a limit out: the definition.
const DEFINITION = "packages/db/src/messages/dens.ts";

// Lines about den limits. Kept as substrings so `membersMax` in a symbol and
// "member ceiling" in prose both count. `MAX_LIMIT` is spelled out rather than a
// bare `LIMIT`, because this tree also holds unrelated page ceilings
// (`BLOCK_LIST_LIMIT = 100` in the blocks route) that are nothing to do with a
// den and would otherwise be reported on every run. The consequence is that the
// scan is a backstop and the named assertions below are the primary guard: a
// duplicate under a name this list does not know is caught by behaviour, not by
// spelling.
const LIMIT_KEYWORDS = [
  "DEN_LIMITS",
  "MAX_LIMIT",
  "at most",
  "den name",
  "descriptionMax",
  "invite code",
  "inviteCodeLength",
  "join code",
  "member ceiling",
  "memberCount",
  "membersMax",
  "membersMin",
  "nameMax",
  "rosterFull",
] as const;

// The numbers a limit can have. `membersMin` is 2, which is a number that
// appears in every stylesheet in the app, so it is only looked for in the prose
// pass where it has to be followed by the noun it counts.
const LIMIT_VALUES = [
  DEN_LIMITS.descriptionMax,
  DEN_LIMITS.inviteCodeLength,
  DEN_LIMITS.membersMax,
  DEN_LIMITS.nameMax,
] as const;

const PROSE_NOUN =
  /\b(?<amount>\d+)\s+(?:members?|people|characters?|other)\b/u;
const PROSE_NUMBER = /(?<amount>\d+)/u;

// There is no allowance list, and that is the finding rather than an omission.
//
// Every duplicate this scan can see has been removed: the two test doubles that
// spelled DEN_LIMITS out now spread the real object in through the
// `@asm/db/messages/dens` subpath, the route clamp test and the roster fetch
// test are driven off the constant, and the copy that quoted a ceiling as prose
// is either composed from the constant or no longer quotes a number. So every
// offence below is a real one, and the fix is always the same: read DEN_LIMITS.
// A new legitimate exception - which would mean a module that genuinely cannot
// import the constant - belongs in this file's comment explaining why, not in a
// pattern that quietly excuses a line.

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

interface Offence {
  file: string;
  line: number;
  pass: "code" | "prose";
  text: string;
  value: number;
}

// Strips a trailing `//` comment. A `//` inside a string is not handled, because
// none of the den copy contains one and a wrong strip would only ever remove
// less, never more, than it should.
function stripLineComment(line: string): string {
  const marker = line.indexOf("//");
  return marker === -1 ? line : line.slice(0, marker);
}

function scanFile(root: string, path: string): Offence[] {
  const relative = path.slice(root.length + 1);
  if (relative === DEFINITION) {
    return [];
  }
  const offences: Offence[] = [];
  const lines = readFileSync(path, "utf-8").split("\n");
  for (const [index, raw] of lines.entries()) {
    const code = stripLineComment(raw);
    if (!LIMIT_KEYWORDS.some((keyword) => code.includes(keyword))) {
      continue;
    }
    // Pass A: code. Quoted strings are blanked because that is where Tailwind
    // classes and user-facing copy live, neither of which is a limit.
    const codeOnly = code
      .replaceAll(/"[^"]*"/gu, '""')
      .replaceAll(/'[^']*'/gu, "''");
    for (const value of LIMIT_VALUES) {
      const literal = new RegExp(`(?<![\\w.$])${value}(?![\\w.%])`, "u");
      if (literal.test(codeOnly)) {
        offences.push({
          file: relative,
          line: index + 1,
          pass: "code",
          text: raw.trim(),
          value,
        });
      }
    }
    // Pass B: prose. A number written out in copy, followed by the noun it
    // measures. This is the shape that goes stale without anybody noticing,
    // because a sentence is not a test and never fails.
    for (const quoted of code.match(/"[^"]*"|'[^']*'/gu) ?? []) {
      if (PROSE_NOUN.test(quoted)) {
        offences.push({
          file: relative,
          line: index + 1,
          pass: "prose",
          text: quoted,
          value: Number(PROSE_NUMBER.exec(quoted)?.groups?.amount ?? 0),
        });
      }
    }
  }
  return offences;
}

// This file is excluded from its own scan. A guard's own fixtures necessarily
// contain the numbers it is guarding against, and a guard that has to exempt
// itself is a guard whose exemption is one edit away from covering the codebase.
const SELF = "packages/db/src/messages/den-limits-consistency.test.ts";

const root = repositoryRoot();
const files = DEN_SURFACE_ROOTS.flatMap((dir) => sourceFiles(root, dir)).filter(
  (path) => path.slice(root.length + 1) !== SELF
);
const offences = files.flatMap((path) => scanFile(root, path));

describe("DEN_LIMITS is the only place a den limit is written down", () => {
  test("the scan covers the den surface, so it is not vacuously green", () => {
    // A guard that found no files would pass every assertion below for the wrong
    // reason. Asserting the coverage keeps a renamed directory from quietly
    // switching the whole test off, which is the failure mode a source-scanning
    // test actually has.
    expect(files.length).toBeGreaterThan(50);
    expect(offences).toEqual([]);
  });

  test("no den limit is written as a number in code", () => {
    const found = offences
      .filter((offence) => offence.pass === "code")
      .map(
        (offence) =>
          `${offence.file}:${offence.line} spells ${offence.value} rather than reading DEN_LIMITS - ${offence.text}`
      );
    expect(found).toEqual([]);
  });

  test("no den limit is written as a number in user-facing copy", () => {
    const found = offences
      .filter((offence) => offence.pass === "prose")
      .map(
        (offence) =>
          `${offence.file}:${offence.line} hardcodes a limit in copy - ${offence.text}`
      );
    expect(found).toEqual([]);
  });

  test("the audited call sites read the constant rather than a copy of it", () => {
    // The scan above catches a limit written as a number. This catches the other
    // shape of the same drift: a call site that stopped consulting DEN_LIMITS at
    // all, and now has its own idea of the ceiling. Named individually, because
    // each of these is a place a reader would otherwise have to check by hand.
    const read = (relative: string) =>
      readFileSync(nodePath.resolve(root, relative), "utf-8");

    // The roster route's page clamp.
    expect(
      read("apps/web/src/app/api/messages/dens/[id]/members/route.ts")
    ).toContain("DEN_LIMITS.membersMax");
    // The create dialog's name and description fields, and its picker ceiling -
    // the last of which goes through the shared capacity helper rather than
    // arithmetic written here.
    const createDialog = read(
      "apps/web/src/components/messages/create-den-dialog.tsx"
    );
    expect(createDialog).toContain("maxLength={DEN_LIMITS.nameMax}");
    expect(createDialog).toContain("maxLength={DEN_LIMITS.descriptionMax}");
    expect(createDialog).toContain("denCreateRoom()");
    // The details panel's rename form, its full-roster line and its add-member
    // picker, which is the ceiling minus who is already inside.
    const denPanel = read("apps/web/src/components/messages/den-panel.tsx");
    expect(denPanel).toContain("maxLength={DEN_LIMITS.nameMax}");
    expect(denPanel).toContain("maxLength={DEN_LIMITS.descriptionMax}");
    expect(denPanel).toContain("denAddRoom(members.length)");
    expect(denPanel).toContain("denIsFull(den.memberCount)");
    // The shared helper the two ceilings now live in. Asserted free of literals
    // as well as full of the constant, because a helper that reads DEN_LIMITS in
    // one line and hardcodes 100 in the next is worse than no helper.
    const capacity = read("apps/web/src/lib/messages/den-capacity.ts");
    expect(capacity).toContain("DEN_LIMITS.membersMax");
    expect(capacity).toContain("DEN_LIMITS.membersMin");
    expect(capacity).not.toMatch(/(?<![\w.$])(?:100|64|280)(?![\w.%])/u);
    // The service's own refusals.
    expect(read("packages/db/src/messages/den-service.ts")).toContain(
      "DEN_LIMITS.membersMax"
    );
    // The join screen's "this den is full" decision, which has to agree with the
    // service's cap or the screen offers a button the server will refuse.
    expect(read("apps/web/src/lib/messages/den-invite.ts")).toContain(
      "denIsFull("
    );
  });

  // ROLES get the same treatment as the numbers, and for the same reason.
  //
  // A duplicated role comparison fails in the ugliest way this codebase can
  // manage a failure: it fails SILENTLY. Add a role to DEN_MANAGEMENT_ROLES and
  // every panel starts drawing its controls, while a service that kept its own
  // `role !== "OWNER" && role !== "ADMIN"` refuses every press. No error, no red
  // test, one very confused member with a button that does nothing. A duplicated
  // limit is at least visible in the rail; this is invisible by construction.
  //
  // So the guard is the same shape: name the places that used to spell the rule
  // out, assert none of them does, and then exercise the table end to end so a
  // role added in the wrong place still fails.
  test("no call site spells the role table out instead of reading it", () => {
    const read = (relative: string) =>
      readFileSync(nodePath.resolve(root, relative), "utf-8");

    // The three copies that existed. Each is asserted on the HELPER it must call,
    // not merely on the absence of a comparison, because a file that stopped
    // asking the question at all would satisfy a negative check and be just as
    // broken.
    expect(read("packages/db/src/messages/den-service.ts")).toContain(
      "canManageDen(membership.role)"
    );
    expect(read("packages/db/src/messages/den-service.ts")).toContain(
      "canManageRole(manager.role, target.role)"
    );
    expect(read("apps/web/src/app/api/messages/dens/[id]/route.ts")).toContain(
      "canManageDen(membership.role)"
    );
    // And the UI's claim that it is built on the same helpers is now true.
    expect(read("apps/web/src/lib/messages/den-permissions.ts")).toContain(
      'from "@asm/db/messages/dens"'
    );
    // A written-out comparison anywhere in the den surface is the smell this is
    // guarding. Scoped to the two role strings together on one line, which is the
    // only shape the drift ever takes.
    for (const dir of DEN_SURFACE_ROOTS) {
      for (const path of sourceFiles(root, dir)) {
        const relative = path.slice(root.length + 1);
        if (relative === SELF) {
          continue;
        }
        // Tests are excluded, and that is not an allowance: a test that writes
        // `addMember(den, OWNER_ID, "ADMIN")` is stating a fixture, and one that
        // asserts `canManageRole("ADMIN", "OWNER")` is exercising the table rather
        // than copying it. Only production code can carry a rule.
        if (relative.endsWith(".test.ts") || relative.endsWith(".test.tsx")) {
          continue;
        }
        for (const [index, line] of readFileSync(path, "utf-8")
          .split("\n")
          .entries()) {
          const code = stripLineComment(line);
          // Two role LITERALS on one line, COMPARED. Both halves are needed:
          // a fixture that writes a role value is not a table, and a line that
          // mentions one role's name is a label or a copy string. The comparison
          // is what turns a value into a rule, and two of them on one line is the
          // only shape the duplication ever took.
          const literals = [
            ...code.matchAll(/["'](?<role>OWNER|ADMIN)["']/gu),
          ].map((match) => match.groups?.role ?? "");
          const names = new Set(literals);
          const compares = /!==|\.includes\(|\.has\(|==/u.test(code);
          if (names.size > 1 && compares) {
            const drift = `${relative}:${index + 1} compares two role literals rather than asking the table - ${line.trim()}`;
            expect(drift).toBe(
              "no production line may compare two role literals outside this guard"
            );
          }
        }
      }
    }
  });

  test("every role in the table is one the server honours", () => {
    // The end-to-end half, driven off the table rather than off a literal. For
    // each role, `canManageDen` and the affordances the UI draws must agree -
    // because the whole point of one table is that a role added to
    // DEN_MANAGEMENT_ROLES is honoured everywhere the day it is added, with no
    // other edit to make.
    expect(DEN_MANAGEMENT_ROLES.length).toBeGreaterThan(0);
    for (const role of DEN_ROLES) {
      const inTable = DEN_MANAGEMENT_ROLES.includes(
        role as (typeof DEN_MANAGEMENT_ROLES)[number]
      );
      expect(canManageDen(role)).toBe(inTable);
      // An admin may act on a member; the owner may act on anybody; nobody may
      // act on an owner unless they are one.
      expect(canManageRole(role, "MEMBER")).toBe(canManageDen(role));
      expect(canManageRole(role, "OWNER")).toBe(role === "OWNER");
      expect(canManageRole(role, "ADMIN")).toBe(canManageDen(role));
    }
    // And exactly one role is not in the management table today. Stated as a
    // count rather than as the role's name, so adding a role to the table does
    // not fail this line - the loop above is what should notice that.
    expect(DEN_ROLES.length - DEN_MANAGEMENT_ROLES.length).toBe(1);
    for (const role of DEN_MANAGEMENT_ROLES) {
      expect(DEN_ROLES).toContain(role);
    }
  });

  test("the invite code's length is generated from the constant", () => {
    // The generator and the join-screen's copy both depend on this one number, so
    // it is asserted directly rather than left to the scan: a code shorter than
    // the constant silently shrinks a 31^12 space, and a longer one is not an
    // attack surface anybody has budgeted for.
    const service = readFileSync(
      nodePath.resolve(root, "packages/db/src/messages/den-service.ts"),
      "utf-8"
    );
    expect(service).toContain("DEN_LIMITS.inviteCodeLength");
    expect(DEN_LIMITS.inviteCodeLength).toBe(12);
  });
});
