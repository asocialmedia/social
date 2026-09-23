// @mention / #tag autocomplete for the native composer, ported from web's
// inline-suggestions (trigger regex, 6 results) + collectInlineRelations.
// Web inserts atom pills in TipTap; the native TextInput inserts the plain
// `@username ` / `#tag ` text and remembers the pick. As on web, only picked
// entries count as relations (typed `@x` does nothing), and a pick whose text
// was edited away no longer counts. Pure for unit tests.

export interface ActiveTrigger {
  query: string;
  // Index of the `@`/`#` character.
  start: number;
  trigger: "#" | "@";
}

const TRIGGER_PATTERN = /(?:^|\s)(?<trigger>[#@])(?<query>[\w-]*)$/;

export function activeTrigger(
  text: string,
  cursor: number
): ActiveTrigger | null {
  const before = text.slice(0, Math.max(0, cursor));
  const match = TRIGGER_PATTERN.exec(before);
  const trigger = match?.groups?.trigger;
  const query = match?.groups?.query ?? "";
  if (!match || (trigger !== "@" && trigger !== "#")) {
    return null;
  }
  return { query, start: before.length - query.length - 1, trigger };
}

// Replaces the active `@query` / `#query` with the picked token plus a
// trailing space, returning the new text and where the cursor lands.
export function applySuggestion(
  text: string,
  cursor: number,
  active: ActiveTrigger,
  token: string
): { cursor: number; text: string } {
  const inserted = `${active.trigger}${token} `;
  const next = text.slice(0, active.start) + inserted + text.slice(cursor);
  return { cursor: active.start + inserted.length, text: next };
}

export interface MentionPick {
  id: string;
  username: string;
}

function hasToken(text: string, token: string): boolean {
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?![\\w-])`, "i").test(text);
}

export function collectRelations(
  text: string,
  picks: { mentions: readonly MentionPick[]; tags: readonly string[] }
): { mentions: string[]; tags: string[] } {
  const mentions = [
    ...new Set(
      picks.mentions
        .filter((pick) => hasToken(text, `@${pick.username}`))
        .map((pick) => pick.id)
    ),
  ];
  const tags = [
    ...new Set(
      picks.tags
        .filter((tag) => hasToken(text, `#${tag}`))
        .map((tag) => tag.toLowerCase())
    ),
  ].slice(0, 10);
  return { mentions, tags };
}
