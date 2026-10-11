import {
  SYSTEM_MODERATION_USER_ID,
  and,
  groupAddRefusal,
  prisma,
} from "@asm/db";

import { getSessionFromApi } from "@/lib/auth/session";
import {
  DEN_USER_SEARCH_RATE_LIMIT,
  consumeDenRateLimit,
} from "@/lib/messages/den-rate-limit";

// Whether the caller is looking for people to start a conversation with, or
// people to put in a group.
//
// The two are different questions and they have different answers, which is why
// this is a parameter rather than a second route. Messaging asks "who do I
// follow"; grouping asks "who exists, and may I add them", because the person
// being added has a say and the person doing the adding does not get to decide
// on their behalf.
//
// Only `den` widens the net. The default stays follow-only, so the share sheet -
// which has always been follow-only and is a different product decision - cannot
// be widened by accident.
const SEARCH_CONTEXTS = ["message", "den"] as const;
type SearchContext = (typeof SEARCH_CONTEXTS)[number];

function parseSearchContext(raw: string | null): SearchContext {
  return SEARCH_CONTEXTS.includes(raw as SearchContext)
    ? (raw as SearchContext)
    : "message";
}

export async function GET(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Metered before the queries, and before the empty-query early return is worth
  // nothing: an empty query costs nothing and must stay free, because the
  // typeahead issues it on every render of the field.
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();

  if (query.length < 1) {
    return Response.json({ users: [] });
  }

  // Two unanchored ILIKE scans over users, one per name field, on every
  // keystroke. The most expensive read on the messaging surface.
  const limited = await consumeDenRateLimit(
    DEN_USER_SEARCH_RATE_LIMIT,
    user.id
  );
  if (limited) {
    return limited;
  }

  const context = parseSearchContext(url.searchParams.get("context"));
  const pattern = `%${query}%`;

  // The candidate's own policy, and whether they follow the caller, are what
  // decide a den row's eligibility - so they are read here rather than by the
  // picker, which has no business re-deriving a privacy decision. `followsFollows`
  // is the relation where this user is the one being followed, so a row with this
  // viewer's id as its follower is exactly "this candidate follows the caller".
  const baseSelect = [
    "avatarUrl",
    "badge",
    "badges",
    "displayName",
    "groupAddPolicy",
    "id",
    "username",
  ] as const;

  const findMatches = (field: "displayName" | "username") =>
    prisma.orm.public.Users.select(...baseSelect)
      .where((candidate) =>
        and(
          candidate.id.notIn([SYSTEM_MODERATION_USER_ID, user.id]),
          // The viewer is never a candidate in their own picker.
          ...(context === "message"
            ? [
                candidate.followsFollows.some((follow) =>
                  follow.followerId.eq(user.id)
                ),
              ]
            : []),
          field === "username"
            ? candidate.username.ilike(pattern)
            : candidate.displayName.ilike(pattern)
        )
      )
      .include("messageIdentities", (identity) => identity.select("userId"))
      .include("followsFollows", (follows) =>
        follows.where({ followerId: user.id }).select("followerId")
      )
      .limit(10)
      .all();

  const [usernameMatches, displayNameMatches] = await Promise.all([
    findMatches("username"),
    findMatches("displayName"),
  ]);
  const users = [...usernameMatches, ...displayNameMatches].filter(
    (candidate, index, all) =>
      all.findIndex((other) => other.id === candidate.id) === index
  );

  return Response.json({
    users: users.map((u) => {
      const hasIdentity = u.messageIdentities !== null;
      const refusal = groupAddRefusal(
        u.groupAddPolicy,
        u.followsFollows.length > 0
      );
      return {
        // Null in the messaging context on purpose: the share sheet has no use for
        // it, and reporting a reason there would invite a caller to render a
        // group-add refusal on a DM.
        addRefusal: context === "den" ? refusal : null,
        avatarUrl: u.avatarUrl,
        badge: u.badge,
        badges: u.badges,
        displayName: u.displayName,
        hasIdentity,
        id: u.id,
        username: u.username,
      };
    }),
  });
}
