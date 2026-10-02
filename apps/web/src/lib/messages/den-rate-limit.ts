import { consumeRateLimit, getTrustedIngressIp, hashViewerId } from "@asm/db";

// Rate limits for den membership mutations.
//
// Every limit here fails open, matching every other limiter in the app: a Redis
// outage must slow nobody down rather than take the product off. Cloudflare sits
// in front as the volumetric backstop, and these buckets exist to stop one
// signed-in account from spending the database's time, not to stop a flood.
//
// The numbers are deliberately uneven, and the order follows the work each
// operation actually does rather than how alarming it sounds:
//
//   create     the conversation row, the owner row, every member row, the first
//              key epoch. The most expensive thing here, so the tightest budget.
//   dissolve   deletes the conversation row and everything cascading off it.
//   add        a claim, a roster read, and one row per member under the lock.
//   join       a claim, a roster read, and one row.
//   the rest   single-row updates nobody can put in a loop, so they are loose.
//
// Reading a roster is free by comparison and is not limited at all.
//
// Every bucket gets its own name. A shared budget is a shared failure: an
// operation that can be driven in a loop spends the budget one that cannot, and
// the second starts answering 429 for a user who did nothing wrong. Two of these
// were one bucket until this pass, and the split is asserted in the test.
//
// Buckets are per-account, never per-IP: these routes require a session, and an
// account behind a rotating address must not get a fresh budget every time. The
// one exception is the join PREVIEW, which needs no session, and it falls back to
// the ingress address under a keyed hash - see `denJoinPreviewIdentifier`.

export interface DenRateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

// Creates and dissolves are the two ends of the lifecycle. Both are rare, and a
// burst of either means a script rather than a person. A create is the single most
// expensive mutation in the den feature, so it gets the smallest budget in the set.
export const DEN_CREATE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-create",
  limit: 10,
  windowSeconds: 3600,
};

export const DEN_DISSOLVE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-dissolve",
  limit: 20,
  windowSeconds: 3600,
};

// Member adds are capped tighter than the single-row operations because each one
// takes the den's claim lock. A full den filled in one burst is that many
// serialized claim cycles.
export const DEN_ADD_MEMBERS_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-add-members",
  limit: 30,
  windowSeconds: 3600,
};

// Removals and leaves are cheap single-row deletes but still a mutation, and a
// kick loop against one den is the abuse shape worth bounding.
export const DEN_REMOVE_MEMBER_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-remove-member",
  limit: 60,
  windowSeconds: 3600,
};

// Joining by code is the widest door in the product: the URL is shareable and
// anyone with it can present it. Generous per-account, because one person
// legitimately joining several dens in an afternoon is normal.
export const DEN_JOIN_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-join",
  limit: 40,
  windowSeconds: 3600,
};

// The PREVIEW is the read half of that same door, and it is the cheaper and more
// abusable one: it takes no write, needs no session, and its 200-versus-404
// answer is exactly what a code-guessing loop would be reading. The code space
// is 31^12, so the codes themselves are not guessable, but an unmetered
// endpoint that runs an indexed lookup per request is a volumetric amplifier
// whether or not its answer is useful, and it needs no session at all.
//
// Its own bucket, and TIGHTER than the join it sits behind, which is the
// opposite of how cost usually orders these. A join is a claim lock and a write;
// a preview is a read. But the preview is the half an anonymous sweep can reach,
// and it is the half whose answer is a signal. A door that is cheaper to call
// and open to everybody cannot also have the looser budget.
export const DEN_JOIN_PREVIEW_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-join-preview",
  limit: 30,
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
  windowSeconds: 3600,
};

// Rotating an invite code, and leaving. Both are single-row changes to a den
// this person is already in, neither is something a UI can put in a loop, and
// they share a bucket because neither is worth its own.
export const DEN_MANAGE_RATE_LIMIT: DenRateLimitRule = {
  bucket: "den-manage",
  limit: 120,
  windowSeconds: 3600,
};

// The identifier the JOIN PREVIEW is metered against.
//
// Every other den bucket is per-user, because every other den route requires a
// session. The preview does not: an invite link is followed by somebody who may
// not be signed in yet, which is exactly the case the screen exists for. So the
// preview falls back to the ingress IP under a keyed hash, and the trusted
// header only - a client that controls its own `x-forwarded-for` must not be able
// to mint a fresh budget per request.
//
// Prefixed by kind so an account's preview budget and its join budget can never
// collide on the same key, and so a signed-out viewer's "unknown" ingress
// collapses into one shared identity rather than an unbounded number of them.
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
  const result = await consumeRateLimit({
    bucket: rule.bucket,
    identifier: userId,
    limit: rule.limit,
    windowSeconds: rule.windowSeconds,
  });
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
}
