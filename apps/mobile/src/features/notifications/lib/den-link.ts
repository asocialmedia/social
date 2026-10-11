// Where a den link goes on a phone that has no den.
//
// The app has no messaging surface, and building one is not this file's job. What
// IS this file's job is making sure a link someone was sent lands somewhere
// honest instead of somewhere broken: an invite link is the widest door in the
// product, so it is very likely to be opened inside this app by somebody who
// tapped it in a chat they are reading here.
//
// Two things happen at that door, and both are deliberate:
//
//   1. The link is recognised. Without a route, `/messages/join/<code>` falls
//      through to `+not-found`, which says the page does not exist. That is
//      false - the page exists, on the web, and it works. So the app claims the
//      path and explains itself instead of denying reality.
//
//   2. The code is preserved and handed to the real screen. The join flow lives
//      on the web and is the only thing that can complete a join, so the action
//      is "open this in the browser", with the code carried across intact.
//      Silently dropping the code would be the worst of the three outcomes: a
//      dead end with no reason and no way forward.
//
// There is deliberately no local validity check on the code. Whether a code
// resolves, was retired, or names a den that is already full is a question only
// the server can answer, and the web join screen is where the answer is rendered
// in the words a reader can act on. A second opinion here would be a second
// place to be wrong, and the failure mode would be the app refusing to open a
// link the web would have accepted.
//
// Pure, so the URL shape and the copy are unit-tested without a browser.

// The web path a den invite link resolves to. Mirrors `den-invite.ts` in the web
// app, which is the module that builds the link managers actually copy.
// Duplicated rather than imported because the two halves deploy separately, and
// because `DEN_LIMITS` lives in the server-only database package that must never
// reach a phone bundle.
const JOIN_PATH_PREFIX = "/messages/join";

// Codes are lowercase and unambiguous, so a code carried across from a deep link
// is normalized the same way the server normalizes before comparing: trimming a
// pasted code and folding its case are both things that must not change which
// den it names.
export function denJoinWebUrl(origin: string, code: string): string {
  const normalized = code.trim().toLowerCase();
  const base = origin.trim().replace(/\/+$/u, "");
  if (normalized.length === 0) {
    return `${base}/messages`;
  }
  return `${base}${JOIN_PATH_PREFIX}/${encodeURIComponent(normalized)}`;
}

export interface DenJoinHandoff {
  body: string;
  title: string;
  // Null only when there is no code to carry, which the route can only be handed
  // by something other than a link. The screen then offers no button rather than
  // a button that opens a link with nothing in it.
  webUrl: string | null;
}

export function denJoinHandoff(code: string, origin: string): DenJoinHandoff {
  if (code.trim().length === 0) {
    return {
      body: "This link is missing its join code, so there is nothing to open. Ask whoever shared it to send it again.",
      title: "This link looks incomplete",
      webUrl: null,
    };
  }
  return {
    body: "Messages and dens aren't in this app yet. The den you were invited to is on the web, and opening it there will put you in it.",
    title: "Open this den on the web",
    webUrl: denJoinWebUrl(origin, code),
  };
}
