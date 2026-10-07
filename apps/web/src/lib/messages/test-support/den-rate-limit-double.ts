// The den rate-limit rules, for the route tests that mock the module.
//
// Every den route test replaces `@/lib/messages/den-rate-limit` wholesale, and
// each of them used to hand-write the whole rule table into its mock. That is
// seven copies of the bucket names, which is the same class of problem the
// limits-consistency test exists for one layer down: a bucket renamed in the real
// module leaves six mocks agreeing with each other and disagreeing with the
// routes, and the tests still pass.
//
// So the rules come from the real module here, once, and are spread into every
// mock. Only `consumeDenRateLimit` is replaced - the point of the mock is to
// observe and to be able to refuse a request, not to restate the policy.
//
// Named imports rather than a namespace, deliberately: a namespace import of a
// module that reaches the database package pulls the whole dependency graph into
// a test double, which is the barrel-file smell the linter rightly complains
// about. One named binding per rule keeps the graph to what the rules need.
import {
  DEN_ADD_MEMBERS_RATE_LIMIT,
  DEN_ACTIVITY_STREAM_RATE_LIMIT,
  DEN_BAN_RATE_LIMIT,
  DEN_BANS_LIST_RATE_LIMIT,
  DEN_CREATE_RATE_LIMIT,
  DEN_DELIVERY_RECEIPT_RATE_LIMIT,
  DEN_DETAILS_RATE_LIMIT,
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_DM_CREATE_RATE_LIMIT,
  DEN_INVITE_ROTATE_RATE_LIMIT,
  DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  DEN_KEY_EPOCH_RATE_LIMIT,
  DEN_LEAVE_RATE_LIMIT,
  DEN_MESSAGE_DELETE_RATE_LIMIT,
  DEN_MESSAGE_EDIT_RATE_LIMIT,
  DEN_MESSAGE_HIDE_RATE_LIMIT,
  DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
  DEN_MESSAGE_SEND_RATE_LIMIT,
  DEN_PREFS_RATE_LIMIT,
  DEN_PRESENCE_RATE_LIMIT,
  DEN_READ_RECEIPT_RATE_LIMIT,
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  DEN_ROLES_RATE_LIMIT,
  DEN_STREAM_RATE_LIMIT,
  DEN_TYPING_RATE_LIMIT,
  DEN_USER_SEARCH_RATE_LIMIT,
  DEN_WALLPAPER_RATE_LIMIT,
  denJoinPreviewIdentifier,
} from "../den-rate-limit";
import type { DenRateLimitRule } from "../den-rate-limit";

// Re-exported so a test can name a rule by name. These are the real module's
// bindings rather than copies, so an assertion about a bucket string is an
// assertion about the string the route will actually charge.
export {
  DEN_ADD_MEMBERS_RATE_LIMIT,
  DEN_ACTIVITY_STREAM_RATE_LIMIT,
  DEN_BAN_RATE_LIMIT,
  DEN_BANS_LIST_RATE_LIMIT,
  DEN_CREATE_RATE_LIMIT,
  DEN_DELIVERY_RECEIPT_RATE_LIMIT,
  DEN_DETAILS_RATE_LIMIT,
  DEN_DISSOLVE_RATE_LIMIT,
  DEN_DM_CREATE_RATE_LIMIT,
  DEN_INVITE_ROTATE_RATE_LIMIT,
  DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
  DEN_JOIN_PREVIEW_RATE_LIMIT,
  DEN_JOIN_RATE_LIMIT,
  DEN_KEY_EPOCH_RATE_LIMIT,
  DEN_LEAVE_RATE_LIMIT,
  DEN_MESSAGE_DELETE_RATE_LIMIT,
  DEN_MESSAGE_EDIT_RATE_LIMIT,
  DEN_MESSAGE_HIDE_RATE_LIMIT,
  DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
  DEN_MESSAGE_SEND_RATE_LIMIT,
  DEN_PREFS_RATE_LIMIT,
  DEN_PRESENCE_RATE_LIMIT,
  DEN_READ_RECEIPT_RATE_LIMIT,
  DEN_REMOVE_MEMBER_RATE_LIMIT,
  DEN_ROLES_RATE_LIMIT,
  DEN_STREAM_RATE_LIMIT,
  DEN_TYPING_RATE_LIMIT,
  DEN_USER_SEARCH_RATE_LIMIT,
  DEN_WALLPAPER_RATE_LIMIT,
  denJoinPreviewIdentifier,
} from "../den-rate-limit";

// The module a test hands to `mock.module`, with the real rules and a
// `consumeDenRateLimit` of the caller's choosing.
export function denRateLimitDouble(
  consumeDenRateLimit: (
    rule: DenRateLimitRule,
    userId: string
  ) => Promise<Response | null>
): Record<string, unknown> {
  return {
    DEN_ACTIVITY_STREAM_RATE_LIMIT,
    DEN_ADD_MEMBERS_RATE_LIMIT,
    DEN_BANS_LIST_RATE_LIMIT,
    DEN_BAN_RATE_LIMIT,
    DEN_CREATE_RATE_LIMIT,
    DEN_DELIVERY_RECEIPT_RATE_LIMIT,
    DEN_DETAILS_RATE_LIMIT,
    DEN_DISSOLVE_RATE_LIMIT,
    DEN_DM_CREATE_RATE_LIMIT,
    DEN_INVITE_ROTATE_RATE_LIMIT,
    DEN_INVITE_SHORT_CODE_ROTATE_RATE_LIMIT,
    DEN_JOIN_PREVIEW_RATE_LIMIT,
    DEN_JOIN_RATE_LIMIT,
    DEN_KEY_EPOCH_RATE_LIMIT,
    DEN_LEAVE_RATE_LIMIT,
    DEN_MESSAGE_DELETE_RATE_LIMIT,
    DEN_MESSAGE_EDIT_RATE_LIMIT,
    DEN_MESSAGE_HIDE_RATE_LIMIT,
    DEN_MESSAGE_SEND_HOUR_RATE_LIMIT,
    DEN_MESSAGE_SEND_RATE_LIMIT,
    DEN_PREFS_RATE_LIMIT,
    DEN_PRESENCE_RATE_LIMIT,
    DEN_READ_RECEIPT_RATE_LIMIT,
    DEN_REMOVE_MEMBER_RATE_LIMIT,
    DEN_ROLES_RATE_LIMIT,
    DEN_STREAM_RATE_LIMIT,
    DEN_TYPING_RATE_LIMIT,
    DEN_USER_SEARCH_RATE_LIMIT,
    DEN_WALLPAPER_RATE_LIMIT,
    consumeDenRateLimit,
    denJoinPreviewIdentifier,
  };
}

// The 429 a test can hand back, shaped the way the real limiter shapes it.
export function rateLimitedResponse(retryAfterSeconds = 60): Response {
  return Response.json(
    { error: "You're doing that too often. Try again later." },
    {
      headers: { "retry-after": String(retryAfterSeconds) },
      status: 429,
    }
  );
}
