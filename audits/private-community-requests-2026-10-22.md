# Discoverable private communities: implementation and verification

## Delivered behavior

- Website discovery and search opt into discoverable private communities. Category and directory totals include them. Existing public discovery rails remain available. Legacy discovery defaults remain unchanged for native clients.
- Public previews select identity, About information, topics, member count, the viewer's own membership, and server-derived permissions. Post totals, activity, owner identity, and rosters are excluded.
- The locked page reuses the existing community header, transform/snap implementation, theme tokens, and mobile navigation. It mounts no feed, filters, chat links, channel drawer, notification subscription, or composer scoped to the private community.
- Guests return to the community after sign-in. Applicants can request, see pending status, and cancel. Cancellation only removes a pending membership, including when approval races it. Visible pending pages revalidate every 30 seconds and on focus.
- Owners and moderators can review paginated requests from the community header and People card. Chat staff also have a Join requests entry inside the community sidebar. The dialog includes applicant profiles, pending totals, Accept/Decline actions, loading, retry, capacity errors, and pagination.
- Request notifications have inline Accept/Decline actions. The deep link opens the staff dialog. Stale notifications show that the request is no longer pending. Decisions are bound to request IDs, not just applicant IDs.
- Notification rows are committed with membership transitions, then dispatched through the existing deduplicated notification queue for unread updates. The worker explicitly skips push delivery for these in-app-only notification types. Notification reads recheck content/staff access. Decline notifications identify the community rather than revealing a staff member's identity.
- New notification types require the website's `membership=1` opt-in; older clients do not receive unsupported membership notifications. Native onboarding is deferred.
- Request rate policy is shared by the service used by API and server actions: five new requests per user/community per ten minutes and twenty per user/hour. Repeated pending submissions do not create rows, consume additional request quota, or produce duplicate notifications. It inherits the existing Redis limiter's fail-open behavior during a Redis outage.
- Bans prevent submission/approval. Approvals recheck staff permissions and capacity while holding the community mutation lock. Pending requests do not consume active capacity.
- Private post and chat web deep links redirect unauthorized viewers to the locked landing. Content APIs keep their access gates. Current avatar/banner proxies expose public identity assets with short revalidation caching; content media and upload staging retain their authorization.
- Profile/embedded role projections hide private affiliations from outsiders. Open private community views revalidate access, unmount content, and evict cached feeds after membership loss. Private crawl-post HTML is not emitted.

## Database and deployment

Migration: `20261022T1637_private_community_requests`, chained from the existing community-chat foundation contract.

Five additive operations: three notification enum values, nullable `notifications.membershipRequestId`, and the `(communityId, status, createdAt, id)` request-pagination index. Existing membership IDs and pending requests are retained. No membership-state enum expansion or destructive changes.

The generated package and pending path were reviewed, then applied to the local development database. `db:up` reported zero planned operations, and `prisma db verify` confirmed that the schema and marker match the contract.

Before production migration on a large existing membership table, prebuild its index outside a transaction:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS community_members_request_page_idx
ON public.community_members ("communityId", status, "createdAt", id);
```

The generated migration skips an already-present index. Apply the reviewed migration, deploy the worker's in-app-only guard and compatible notification readers, then deploy the website flow. Do not remove notification enum support or reverse the additive migration during rollback; stop new membership-request writes and restore the former discovery/landing behavior while retaining data and decoders.

## Automated verification

- Database integration suite: 144 tests passed across private requests, existing community visibility, membership/capacity, chat, subscriptions, roles, and den service regressions. Includes duplicate sends of requests, pagination, outsider denial, private profile affiliation protection, cancellation/approval race safety, stale request IDs, approval/decline races, immediate re-request, notification access/redaction, bans, both rate limits, and competing approvals at 99,999 members.
- Shared notification presentation/grouping/payload, media-access policy, header snap/transform regression suite: 95 passed.
- Existing notification rendering: 10 passed; worker job processors: 13 passed.
- Request API controllers: 5 passed; existing private post API gates: 4 passed; community creation API regression: 2 passed.
- Staff dialog/notification DOM integration: 3 passed, covering inline approval, decline, failed decisions, stale controls, notification deep links, and pagination.
- Locked landing DOM integration: 4 passed, covering guests, request/cancel, approval refresh, and banned viewers.
- Existing community drawer portal DOM integration: 1 passed.
- `bun run check` and `bun run check-types` passed during implementation; final results are checked again before committing.

Run DOM tests and mocked API/worker tests in separate Bun processes: their module mocks and browser globals are intentionally isolated.

## Browser verification and remaining limits

Verified on the local website: public discovery and search expose the private fixture without post/aura statistics; the locked landing renders on desktop, 390px phone, and 820px tablet viewports; no community chat control appears; sign-in preserves `next=/a/privaterequests`; unauthorized private-chat and private-post links redirect to the landing. A metadata prerender error discovered during this check was fixed and the private-post redirect retested.

Authenticated browser completion is blocked by the existing local authentication state: sign-in returns 200, but `/api/auth/get-session` returns 500 because the stored JWKS private key cannot be decrypted with the configured auth secret. No keys were deleted, encryption disabled, or credentials reset. Matching the development auth secret to the existing JWKS is required before repeating the full two-account browser walkthrough. Authenticated request/approval behavior is covered by real PostgreSQL/Redis integration tests and DOM interaction tests, not claimed as a completed browser walkthrough.

Dark-theme browser layouts were inspected. The existing theme switch did not change the theme during this session, so light-theme visual sign-off remains open. Native onboarding and physical-device acceptance are outside this website release. Community chat's original sustained capacity/load gates remain unproven and are not implied by this work.

Local browser fixture: `/a/privaterequests`, owned by the existing community-chat-playground owner. No existing account or password was changed to create it.

## Manual sign-off after authentication is restored

1. Find Private Requests in discovery/search; confirm identity/member count only.
2. As a non-member, request access and cancel it; submit again and confirm pending survives reload.
3. As owner/moderator, open Join requests on desktop and mobile; check count, profile links, pagination, and keyboard/focus behavior.
4. Accept from the notification list; confirm the other account unlocks posts and chat on focus or within 30 seconds.
5. Repeat with Decline; confirm immediate re-request and that the old notification cannot act on the new request.
6. Leave/remove membership while the community is open; confirm content disappears and old post/chat/media links are denied.
7. Repeat in light theme and on a physical phone/tablet. Check request decision errors retain the current list position and actionable retry controls.
