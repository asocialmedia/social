import {
  consumeRateLimit,
  consumeRateLimitSliding,
  getTrustedIngressIp,
  hashViewerId,
} from "@asm/db";

// Rate limits for the messaging surface: den membership, and every send, ack,
// stream and search on the conversation routes.
//
// Every limit here fails open, matching every other limiter in the app: a Redis
// outage must slow nobody down rather than take the product off. Cloudflare sits
// in front as the volumetric backstop, and these buckets exist to stop one
// signed-in account from spending the database's time, not to stop a flood.
//
// The numbers are benchmarked against what the platforms actually publish, and
// where a platform does not publish a number that is said here rather than
// invented. Slack caps posting at 1 message per second per channel with short
// bursts and a workspace-wide ceiling; Telegram caps 1 message per second in a
// chat and 20 per minute in a group; Discord's per-route bucket sizes are not
// published at all and are read from response headers at runtime, but its
// gateway allowlist is 120 events per connection per 60s. The shape those three
// agree on is the one used here: a generous short window that a human cannot
// reach and a script trips in seconds, plus a long window that bounds what the
// short one cannot see.
//
// WINDOW SHAPE. `window: "sliding"` is the default for everything new here, and
// the reason is arithmetic rather than taste. The shared helper is a fixed
// window, which means the stated budget is really 2x: a caller can spend it all
// at 9.9s and all of it again at 10.1s. On a ten-second typing budget that is 60
// events inside 200ms, which is the entire attack - a fixed window on a short
// bucket is not a weaker limiter, it is barely one. The pre-existing membership
// mutations stay on fixed windows and now say so: at a 3600s window the worst
// case is two budget-fills across one boundary, and for a ten-per-hour create
// budget that is twenty creates, which is not what anyone is defending against.
//
// Every bucket gets its own name. A shared budget is a shared failure: an
// operation that can be driven in a loop spends the budget one that cannot, and
// the second starts answering 429 for a user who did nothing wrong. Two of these
// were one bucket until an earlier pass, and the split is asserted in the test.
//
// Buckets are per-account, never per-IP: these routes require a session, and an
// account behind a rotating address must not get a fresh budget every time. The
// one exception is the join PREVIEW, which needs no session, and it falls back to
// the ingress address under a keyed hash - see `denJoinPreviewIdentifier`.

export interface DenRateLimitRule {
  bucket: string;
  limit: number;
  // "sliding" refuses the boundary burst; "fixed" is one INCR per window and is
  // only right where the window is long enough for the doubling to be noise.
  window: "fixed" | "sliding";
  windowSeconds: number;
}

// Creates and dissolves are the two ends of the lifecycle. Both are rare, and a
// burst of either means a script rather than a person. A create is the single most
// expensive mutation in the den feature, so it gets the smallest budget in the set.
export const DEN_CREATE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-create",
  limit: 10,
  window: "fixed",
  windowSeconds: 3600,
};

export const DEN_DISSOLVE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-dissolve",
  limit: 20,
  window: "fixed",
  windowSeconds: 3600,
};

// Member adds are capped tighter than the single-row operations because each one
// takes the den's claim lock. A full den filled in one burst is that many
// serialized claim cycles.
//
// One request may add up to DEN_LIMITS.membersMax members, so this is a budget on
// REQUESTS and the work behind one is up to a hundred row writes under that lock.
// That amplification is why the budget is counted per request and stays where it
// is rather than being divided by the roster: every candidate must already be
// followed by the actor (`validateDenRoster` enforces it, and dens are the one
// surface that admits regardless of blocks), so a mass-add needs a follow graph,
// not just a loop. Thirty requests an hour is one request every two minutes.
export const DEN_ADD_MEMBERS_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-add-members",
  limit: 30,
  window: "fixed",
  windowSeconds: 3600,
};

// Removals and leaves are cheap single-row deletes but still a mutation, and a
// kick loop against one den is the abuse shape worth bounding.
export const DEN_REMOVE_MEMBER_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-remove-member",
  limit: 60,
  window: "fixed",
  windowSeconds: 3600,
};

// Bans, and un-banning. Both are single-row writes on a den this person already
// manages, and both are rare in the way a role change is rare.
//
// One shared bucket rather than two, for the same reason the hand-over shares the
// roles budget: unbanning is the same manager decision as banning in the other
// direction, it needs no confirmation of its own, and two budgets would mean the
// looser of the pair existing only to be spent by something nobody would build.
//
// Tighter than the details budget and separate from it, because this is the one
// management operation that can be pointed at a person rather than at a den: a
// rename storm cannot lock anybody out of the ability to let somebody back in.
export const DEN_BAN_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-ban",
  limit: 60,
  window: "fixed",
  windowSeconds: 3600,
};

// Reading the ban list. A manager opens it to find one person, so it is generous in
// the same way the roster read is: the panel refetches it after every mutation, and a
// tighter budget here would break a panel rather than slow a script.
export const DEN_BANS_LIST_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-bans-list",
  limit: 120,
  window: "fixed",
  windowSeconds: 3600,
};

// Joining by code is the widest door in the product: the URL is shareable and
// anyone with it can present it. Generous per-account, because one person
// legitimately joining several dens in an afternoon is normal.
export const DEN_JOIN_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-join",
  limit: 40,
  window: "fixed",
  windowSeconds: 3600,
};

// The PREVIEW is the read half of that same door, and it is the cheaper and more
// abusable one: it takes no write, needs no session, and its 200-versus-404
// answer is exactly what a code-guessing loop would be reading. Link codes are
// 31^12 and not guessable; the 6-character short codes (36^6) ARE guessable at
// the margin, which is why their anonymous preview is session-gated at the
// route and why an outage here degrades rather than fails open. For links the
// budget remains a volumetric bound on an indexed lookup, not a guessing
// bound, and it needs no session at all.
//
// Its own bucket, and TIGHTER than the join it sits behind, which is the
// opposite of how cost usually orders these. A join is a claim lock and a write;
// a preview is a read. But the preview is the half an anonymous sweep can reach,
// and it is the half whose answer is a signal. A door that is cheaper to call
// and open to everybody cannot also have the looser budget.
export const DEN_JOIN_PREVIEW_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-join-preview",
  limit: 30,
  window: "fixed",
  windowSeconds: 3600,
};

// Renaming a den, changing its description, swapping its avatar. A single-row
// update with no lock contention worth bounding.
//
// Its own bucket rather than a share, because it is the ONE den management
// operation a client can put in a loop: a save button behind an autosave, a
// retry that fires per keystroke, a script. Sharing `den-manage` with role
// changes meant such a loop spent the whole shared budget and the owner then
// found role changes answering 429 for the next hour - the cheap operation
// starving the one that actually changes who can do what. Split, so each budget
// bounds the thing it was written for.
export const DEN_DETAILS_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-details",
  limit: 120,
  window: "fixed",
  windowSeconds: 3600,
};

// A promotion, a demotion, or a hand-over of the den itself. Owner only, and the
// rarest management operations there are: nobody runs a loop that changes roles or
// that hands a den away, and every call that succeeds is a real change of
// authority. Tighter than the details budget for that reason, and separate so a
// rename storm cannot lock an owner out of it.
//
// The hand-over shares this bucket rather than having one, and it is the sharpest
// case for sharing: it is rarer than a promotion, needs a confirmation, and only
// the owner can do it - so a separate budget could only ever be a looser budget
// that exists to be spent by something nobody would build.
export const DEN_ROLES_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-roles",
  limit: 60,
  window: "fixed",
  windowSeconds: 3600,
};

// Rotating an invite code, and leaving a den. Both are single-row changes to a
// den this person is already in, and both are single-request operations from a
// UI, so neither is individually worth a tight budget.
//
// Split anyway, because their costs are not alike. Rotating retires a door that
// other people are standing in the middle of walking through: every call
// invalidates the link somebody may have just handed out, so a loop here is
// disruptive to innocents rather than merely expensive, and that is a reason for
// a tighter budget than "a single-row update nobody can put in a loop" would
// suggest on its own. Leaving costs the caller nothing but one delete.
//
// Both sliding: twenty rotations an hour is a number small enough that the
// fixed-window doubling would be a meaningful fraction of it, and the whole
// argument for a tighter budget evaporates if the real peak is forty.
export const DEN_INVITE_ROTATE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-invite-rotate",
  limit: 20,
  window: "sliding",
  windowSeconds: 3600,
};

export const DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-invite-short-code-rotate",
  limit: 20,
  window: "sliding",
  windowSeconds: 3600,
};

// Leaving. Generous, because a person cleaning up their den list does it in one
// sitting and never comes back.
export const DEN_LEAVE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-leave",
  limit: 120,
  window: "sliding",
  windowSeconds: 3600,
};

// Sending a message, short window.
//
// This is the single most expensive thing an authenticated caller can do in the
// whole feature. One accepted send is: a conversation+members read for the
// membership gate, a ratchet compare-and-set with up to eight retries under a
// transaction, the message insert, a locked `updatedAt` bump on the conversation
// row, a per-den notification fold that is one row for every unmuted member, an
// unread counter increment, a `message.created` publish, and a `message.created`
// activity publish PER MEMBER. In a hundred-member den that last term alone is a
// hundred Redis publishes, and the whole fan-out happens because one account
// pressed enter.
//
// Twenty per ten seconds is two per second sustained with a twenty-deep instant
// burst allowed. Slack publishes 1 message per second per channel and allows
// short bursts above it; Telegram publishes roughly 1 per second in a chat and
// says short bursts are tolerated; Discord's gateway allowlist is 120 events per
// 60s across everything, so three per second for one event type is already above
// what Discord permits for all of them. Two per second is above every published
// human-facing figure and still unreachable by a person, whose ceiling is set by
// how fast they can type and press a key.
export const DEN_MESSAGE_SEND_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-message-send",
  limit: 20,
  window: "sliding",
  windowSeconds: 10,
};

// Sending a message, long window. A separate bucket, and the reason is that the
// short window cannot see this attack at all: sustained nineteen sends per ten
// seconds is under the short budget on every single window and works out to
// 6,840 messages an hour. This is the same two-tier shape Slack uses for posting
// - per-channel rate plus a workspace-wide ceiling - and the same reason
// WhatsApp separates throughput from its 24-hour limit.
//
// Six hundred an hour is ten a minute for an hour. A person pasting a long
// conversation into a DM sends a few dozen and stops; nobody sustains ten a
// minute by hand, and a script that does is the thing this is for.
export const DEN_MESSAGE_SEND_HOUR_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-message-send-hour",
  limit: 600,
  window: "sliding",
  windowSeconds: 3600,
};

// Editing an existing message. Rewrites up to MAX_MESSAGE_CIPHERTEXT_LENGTH
// (100KB) of ciphertext in place and publishes, and the edit window is twelve
// hours wide, so an unbounded budget here is 100KB of writes times however many
// times a script feels like over half a day. A human edits a handful of messages
// an hour at the very most.
export const DEN_MESSAGE_EDIT_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-message-edit",
  limit: 120,
  window: "sliding",
  windowSeconds: 3600,
};

// Soft-deleting an existing message. One row and one publish, and it is
// sender-only, so it is looser than the edit it shares a route with - and its own
// bucket, because an edit storm must not be able to spend a delete's budget and
// leave somebody unable to remove something they should not have sent.
export const DEN_MESSAGE_DELETE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-message-delete",
  limit: 240,
  window: "sliding",
  windowSeconds: 3600,
};

// "Delete for me". Batched, so one request hides up to MAX_HIDE_BATCH (100)
// messages and the route does a select, an already-hidden select, and then one
// create per newly hidden row. That is up to a hundred inserts per request, which
// is the amplification worth bounding: six hundred an hour is six hundred batches
// rather than a thousand hidden rows a minute, and selecting a run in a
// transcript is one request however long the run is.
export const DEN_MESSAGE_HIDE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-message-hide",
  limit: 600,
  window: "sliding",
  windowSeconds: 3600,
};

// Posting wrapped conversation keys.
//
// The version ceiling bounds what ONE request can mint - it may only complete
// epoch max+1, never jump past it - and that is a genuine per-request bound. It
// is not a request-count bound: nothing stopped a client from calling this
// thousands of times an hour, each call a full membership read, a ceiling read, a
// pairs read, and then a transaction of sequential creates, followed by a
// broadcast to every open thread on the channel.
//
// Rotations are rare in honest use: one when a den is created, one when a send
// finds no epoch, one on a heal after a decrypt failure. Sixty an hour covers a
// client rebuilding every conversation it is in several times over.
export const DEN_KEY_EPOCH_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-key-epoch",
  limit: 60,
  window: "sliding",
  windowSeconds: 3600,
};

// Refreshing a legacy identity backup rewrites an encrypted recovery row. The
// compare-and-swap makes competing devices safe, while this per-account budget
// bounds repeated refresh requests that lose or intentionally retry the race.
export const DEN_MESSAGE_IDENTITY_REFRESH_RATE_LIMIT: DenRateLimitRule = {
  bucket: "message-identity-refresh",
  limit: 10,
  window: "sliding",
  windowSeconds: 3600,
};

// Typing indicators. The cheapest thing to spam in the product: no write at all,
// one publish, and one conversation+members read to prove the caller is in the
// room. Nothing accumulates, so a loop is invisible except as load - which is
// exactly why every platform here bounds it hard rather than not at all. Slack
// tells RTM clients to cap writes at one per second; Discord folds typing into
// the 120-events-per-60s gateway allowlist and tells bots not to call the route
// at all.
//
// The client heartbeats once per three seconds while the composer is non-empty,
// so a person typing continuously produces twenty a minute. Thirty per ten
// seconds is three a second sustained - nine times what a fast typist with five
// tabs open generates, and a burst allowance far above it.
export const DEN_TYPING_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-typing",
  limit: 30,
  window: "sliding",
  windowSeconds: 10,
};

// Read receipts. One conversation+members read, a COUNT over the unread range, a
// locked update of the member row advancing both watermarks, a Redis decrement
// and a publish. The client fires this on open and on every peer message while
// the thread is open, debounced to 800ms, so a busy thread plus a few tabs is
// the honest figure: sixty a minute. Twice that leaves room for a tab that was
// backgrounded and a thread catching up.
export const DEN_READ_RECEIPT_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-read-receipt",
  limit: 120,
  window: "sliding",
  windowSeconds: 60,
};

// Delivery receipts. The same shape per inbound message, debounced 1.5s and
// deduped per message id by the client, so it tracks message arrival rate rather
// than user activity. A hundred-member den running at twenty messages a minute
// acks twenty times a minute; one hundred and twenty is six times that.
export const DEN_DELIVERY_RECEIPT_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-delivery-receipt",
  limit: 120,
  window: "sliding",
  windowSeconds: 60,
};

// Opening a conversation's event stream.
//
// Every stream is a request that never completes, an interval timer firing every
// twenty seconds for as long as it lives, and a slot in the process's shared
// Redis subscriber. The client reconnects on every drop, so what is bounded here
// is the rate of OPENS, not a concurrent count - which is also how the platforms
// do it: Slack caps rtm.start/rtm.connect at one a minute, Discord limits
// concurrent Identify requests per five seconds.
//
// Thirty a minute is ten conversations opened across three tabs with room for
// every one of them to reconnect several times. A holder who opens hundreds of
// streams is not producing better latency, they are producing sockets.
export const DEN_STREAM_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-stream",
  limit: 30,
  window: "sliding",
  windowSeconds: 60,
};

// Opening the per-user activity stream that feeds the conversation list. Same
// resource shape as the per-conversation stream and the same reasoning, on its
// own bucket: these are two different subscribers on two different channels, and
// a loop against one must not be able to spend the other's budget.
export const DEN_ACTIVITY_STREAM_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-activity-stream",
  limit: 30,
  window: "sliding",
  windowSeconds: 60,
};

// Finding somebody to message. The most expensive read on the surface: two
// unanchored `ILIKE '%q%'` scans over users, one on username and one on display
// name, and a leading wildcard cannot use a btree index. It fires per keystroke.
//
// Sixty a minute is Slack's Tier 3, the tier Slack assigns to the paginated
// collection methods, and it matches the community search bucket this app already
// runs for the same reason at the same number.
export const DEN_USER_SEARCH_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-user-search",
  limit: 60,
  window: "sliding",
  windowSeconds: 60,
};

// Reading who may be put in a group, for a set of ids the client already holds.
//
// Metered for the same reason the people search is, and with the same shape of
// argument: this is a client-supplied list turned into user rows. It is much
// cheaper than the search - two indexed reads rather than unanchored `ILIKE`
// scans - but it is loopable, and the picker re-asks whenever its recents move,
// so an unmetered version is a per-account amplifier rather than a read.
//
// A generous budget for that reason: the picker asks once per open, so a hundred
// a minute is far past how often a person opens a den roster and still bounds a
// flood to something cheaper than the search it resembles.
export const DEN_ADD_ELIGIBILITY_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-add-eligibility",
  limit: 100,
  window: "sliding",
  windowSeconds: 60,
};

// Opening a DM.
//
// The den branch of the same route has been metered since it was written; this
// branch was not, which is the oldest asymmetry on the surface. Starting a DM
// writes a conversation row and two membership rows, and every one of them lands
// in somebody else's conversation list - unsolicited DM spam is the abuse
// chat platforms answer with a limit rather than with a block, and Slack puts
// conversations.open in Tier 3 for the same reason.
//
// The candidate rules do the real bounding here: a peer must exist, must have a
// message identity, and must not be blocked in either direction. This budget is
// for volume, sixty an hour, which is well past how many conversations one person
// opens in an afternoon.
export const DEN_DM_CREATE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-dm-create",
  limit: 60,
  window: "sliding",
  windowSeconds: 3600,
};

// Mute, theme, wallpaper preset, wallpaper dim. Four single-column writes to the
// caller's own member row, behind a UI that can put them in a loop exactly the
// way `den-details` can - a slider drag fires per step, an autosave retries per
// keystroke, a script fires per request. Looser than `den-details` because this
// row is nobody else's business and nothing here is broadcast.
export const DEN_PREFS_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-prefs",
  limit: 240,
  window: "sliding",
  windowSeconds: 3600,
};

// Linking or clearing an uploaded chat wallpaper. A single-row update like prefs,
// plus the one thing worth bounding: replacing a wallpaper SCHEDULES a cleanup
// job for the row it displaced, so an unbounded loop here is a queue-fill
// primitive, not just an update loop. A person changes their wallpaper a few
// times a day.
export const DEN_WALLPAPER_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-wallpaper",
  limit: 120,
  window: "sliding",
  windowSeconds: 3600,
};

// The presence heartbeat. Four idempotent Redis commands and no database write,
// which is the cheapest write on the surface and therefore the most obviously
// worth a bound: setex of a key that already holds this value, and two SADDs of a
// member the set already has. The client heartbeats once every thirty seconds
// shared across every mounted consumer, so two a minute is the honest figure and
// sixty is thirty times it.
export const DEN_PRESENCE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-presence",
  limit: 60,
  window: "sliding",
  windowSeconds: 60,
};

// The identifier the JOIN PREVIEW is metered against.
//
// Every other bucket is per-user, because every other route here requires a
// session. The preview does not: an invite link is followed by somebody who may
// not be signed in yet, which is exactly the case the screen exists for. So the
// preview falls back to the ingress IP under a keyed hash, and the trusted
// header only - a client that controls its own `x-forwarded-for` must not be able
// to mint a fresh budget per request.
//
// Prefixed by kind so an account's preview budget and its join budget can never
// collide on the same key, and so a signed-out viewer's "unknown" ingress
// collapses into one shared identity rather than an unbounded number of them.
//
// DEPLOYMENT REQUIREMENT, and the honest limit of the fallback: production
// ingress is Cloudflare (`cf-connecting-ip` is always present and
// client-unforgeable). On any deployment where that header is absent, every
// anonymous viewer shares the single "unknown" identity, which fails CLOSED -
// one sweeper exhausts the shared budget for every legitimate signed-out
// joiner - but it also means anonymous link previews are effectively capped
// for everyone at once. A non-Cloudflare production deployment needs a
// trusted-ingress equivalent before it can serve signed-out previews at any
// volume; Cloudflare is a hard dependency, not a preference.
export function denJoinPreviewIdentifier(
  headers: Pick<Headers, "get">,
  userId: string | undefined
): string {
  return userId
    ? `u:${userId}`
    : `a:${hashViewerId(getTrustedIngressIp(headers))}`;
}

// Consumes one hit and returns a 429 Response when the caller is over budget, or
// null when they are allowed through.
// Returned as a Response rather than a boolean so every call site cannot forget
// the retry-after header, which is the part clients actually need.
export async function consumeDenRateLimit(
  rule: DenRateLimitRule,
  userId: string
): Promise<Response | null> {
  const options = {
    bucket: rule.bucket,
    identifier: userId,
    limit: rule.limit,
    windowSeconds: rule.windowSeconds,
  };
  // The helpers already fail open on a Redis outage. This guard is the layer
  // above them: a limiter that throws must never 500 a route, because the
  // product owner chose fail-open on purpose and Cloudflare is the volumetric
  // backstop that makes it unnecessary to be cleverer than that. Anything thrown
  // here is a bug in the limiter, and a bug in the limiter must degrade to no
  // limit rather than take a send or a heartbeat down for a real user.
  try {
    const result =
      rule.window === "sliding"
        ? await consumeRateLimitSliding(options)
        : await consumeRateLimit(options);
    if (result.allowed) {
      return null;
    }
    return Response.json(
      { error: "You're doing that too often. Try again later." },
      {
        headers: { "retry-after": String(result.retryAfterSeconds) },
        status: 429,
      }
    );
  } catch (error) {
    console.error("Rate limiter failed, allowing the request:", error);
    return null;
  }
}

// The join door's limiter, and the one deliberate exception to the fail-open
// rule above. The join endpoints are the ONLY surface where a limiter outage
// removes the last bound on an attack the limiter exists to price:
// `DEN_JOIN_PREVIEW_RATE_LIMIT` is what makes sweeping the 36^6 short-code
// space economically irrational (roughly 30 reads per identity per hour
// against 2.2 billion possibilities). Fail-open during a Redis outage turns
// the widest door into an unbounded, indexed lookup oracle exactly when
// sweeping is cheapest - and the door's other budgets (session gate, join
// auth) still hold, so nobody legitimate is locked out: a signed-in member
// keeps joining, and a signed-out reader of a LINK loses only their anonymous
// preview until Redis returns.
//
// The degraded budget is a process-local fixed window, so it needs no Redis
// and still bounds a volumetric sweep to a trickle per identity. It is
// deliberately tighter than the Redis budget: an outage is rare, brief, and
// the right answer to "we cannot count properly" is to count conservatively.
// The join POST keeps the rule's own budget as its degraded allowance because
// a session is required there and the cost per hit is far higher.
const degradedHits = new Map<string, { count: number; windowStart: number }>();

function consumeDenRateLimitDegraded(
  rule: DenRateLimitRule,
  identifier: string
): Response | null {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const key = `${rule.bucket}:${identifier}`;
  const entry = degradedHits.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    degradedHits.set(key, { count: 1, windowStart: now });
    return null;
  }
  entry.count += 1;
  if (entry.count > rule.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.windowStart + windowMs - now) / 1000)
    );
    return Response.json(
      { error: "You're doing that too often. Try again later." },
      {
        headers: { "retry-after": String(retryAfterSeconds) },
        status: 429,
      }
    );
  }
  return null;
}

// The join-DOOR limiter: same counting as `consumeDenRateLimit`, but a Redis
// outage degrades to a tight process-local window instead of failing open.
// See the comment above for why this door, and only this door, pays with
// availability rather than with its anti-enumeration bound.
export async function consumeDenJoinRateLimit(
  rule: DenRateLimitRule,
  identifier: string
): Promise<Response | null> {
  const options = {
    bucket: rule.bucket,
    identifier,
    limit: rule.limit,
    windowSeconds: rule.windowSeconds,
  };
  try {
    const result =
      rule.window === "sliding"
        ? await consumeRateLimitSliding(options)
        : await consumeRateLimit(options);
    if (result.allowed) {
      return null;
    }
    return Response.json(
      { error: "You're doing that too often. Try again later." },
      {
        headers: { "retry-after": String(result.retryAfterSeconds) },
        status: 429,
      }
    );
  } catch (error) {
    console.error(
      "Join-door rate limiter failed, degrading to a local window:",
      error
    );
    return consumeDenRateLimitDegraded(rule, identifier);
  }
}
