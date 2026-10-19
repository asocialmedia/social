# Community chat playground test checklist

This fixture is created by `scripts/seed-community-chat-playground.ts` and is intended for the local development database only. It does not change the password or profile of the existing owner account `@anny`.

The owner must already exist in the local database. If `anny` is missing, the seed lists up to 20 existing usernames without writing data. Use `--owner=<exact-username>` to select another existing account; references to `anny` below then mean that selected owner. If no local accounts exist, sign up as `anny` first.

## Test accounts

All fixture accounts use the local-only password `Test@1234`.

| Username | Community state | What to test |
| --- | --- | --- |
| `anny` | Owner | Existing account; create/manage channels and moderate the community. Sign in with the credentials already set up locally. |
| `communitychat_mod` | Active moderator | Staff channel access and community chat moderation controls. |
| `communitychat_invited` | Active member; invited to the private thread | Normal member chat and access to the private thread. |
| `communitychat_member` | Active member; not invited to the private thread | Normal member chat and private-thread privacy. |
| `communitychat_timedout` | Active member with a 24-hour chat timeout | Read access and blocked contribution actions. |
| `communitychat_pending` | Pending member request | Public read access and blocked contribution actions. |

## Open the fixture

- [ ] If Chat is hidden, check the local development feature gates: `COMMUNITY_CHAT_ENABLED`, `COMMUNITY_CHAT_WRITES_ENABLED`, and `NEXT_PUBLIC_COMMUNITY_CHAT_ENABLED` for web, or `EXPO_PUBLIC_COMMUNITY_CHAT_ENABLED` for native.
- [ ] Start the local app and sign in as `anny` or one of the fixture accounts.
- [ ] Open `/a/community-chat-playground`. The community is named **The Open Table**, uses the app’s community accent and identity, and defaults to the **Posts** section.
- [ ] Switch between **Posts** and **Chat**. On Posts, check the existing **New / Top** controls, three image link previews, a comment, and votes.
- [ ] Open `/a/community-chat-playground/chat`. It should route to the first available channel, `#general`.
- [ ] Check that the channel list has `#general`, `#introductions`, `#field-notes`, `#announcements`, `#slow-mode`, and `#quiet-corner`, with their topics and ordering.

## Posts and image previews

- [ ] Confirm the three posts show image previews and that each image loads through the app’s link-preview image proxy.
- [ ] Open a post, read its comment, and exercise the existing vote and comment controls.
- [ ] Confirm Posts still feels like the community feed and Chat remains a separate conversation surface within the same community identity.

## Channel messages

- [ ] In `#general`, check grouped authors, timestamps, a reply reference, an edited label, a removed-message tombstone, a reaction, and the pinned welcome message.
- [ ] Send a text message, reply to a message, edit your own message, and delete your own message.
- [ ] Add and remove a reaction. Open the pins panel and jump to the pinned welcome message.
- [ ] Scroll up, receive a newer message from another signed-in account, and check the new-activity indicator and jump-to-latest behavior.
- [ ] Open `#introductions` and `#field-notes` to check that each room keeps its own history.
- [ ] In `#slow-mode`, send a message and immediately try another from the same account. Check the five-second restriction and retry after it expires.
- [ ] In `#quiet-corner`, confirm history is readable while composing is unavailable. As `anny` or `communitychat_mod`, open channel settings, unlock it, test writing, then restore the lock.
- [ ] In `#announcements`, confirm an active regular member cannot contribute and staff can. Restore any channel settings you change after testing.
- [ ] As `anny` or `communitychat_mod`, create a text channel and an announcement channel, then change a name, topic, and order in channel settings. Remove or archive anything created only for testing.

## Public and private threads

- [ ] In `#field-notes`, open **Making room for a creative habit** from its starter message and check the existing replies.
- [ ] Follow and unfollow the public thread, then verify the state after leaving and reopening it.
- [ ] Open **Friday studio details** as `communitychat_invited`; check its starter and reply.
- [ ] Sign in as `communitychat_member` and verify the private thread and its activity are absent from the channel thread list and unavailable by direct link.
- [ ] Return to `communitychat_invited`, follow the private thread, and send a reply.
- [ ] On web, start a private thread from a channel, search for `communitychat_invited`, invite that member, and confirm the starter message stays inside the private conversation.
- [ ] As a non-invitee, try the private fixture link `/a/community-chat-playground/chat/ccp_channel_general/threads/ccp_thread_small_group`; it should be unavailable. As the invitee, it should open.
- [ ] Start a public thread from a different channel message that has no thread yet. Confirm its replies are visible to active members of this public community.

## Membership and moderation states

- [ ] As `communitychat_pending`, confirm public channel history is readable, but sending, reacting, and starting a thread are blocked with a join explanation.
- [ ] As `communitychat_timedout`, confirm public history is readable, but sending and other contribution actions are blocked with a timeout explanation.
- [ ] As `communitychat_mod`, verify the staff identity appears in the community and staff-only announcement controls are available.
- [ ] As `anny`, verify owner-level channel controls are available and that channel changes update the visible list.

## Mobile and navigation

- [ ] Open the community in the native app or mobile web. Check that the transcript uses the available screen width and height, while channels open from the channel drawer.
- [ ] Switch channels, open a thread, send a reply, and return with the system back action or gesture.
- [ ] Open a message or thread link on mobile and confirm it lands in the right channel/thread.
- [ ] Check keyboard appearance, composer visibility, scrolling to latest, and that the channel drawer closes after selecting a room.
- [ ] In native mobile, check a public thread link and return with the system back action; private-thread creation is currently available in the web interface.

## Access and feature boundaries

- [ ] As a guest, confirm the public community and public chat history can be read, and that sending prompts you to sign in or join.
- [ ] Confirm the pending account is not counted as an active member; the fixture begins with five active members.
- [ ] Confirm private-thread access is limited to its invitee, creator, and community staff. Do not share that thread’s URL or content with non-invitees.
- [ ] Confirm the seeded pictures are **Posts link-preview images**. Community chat currently accepts text messages only; image/file uploads, inline chat attachments, chat search, typing indicators, and online roster are not part of the current UI to test.
- [ ] Confirm there are no DM-style seen lists or delivery receipts in community chat.

## Re-seeding and cleanup

- [ ] Dry-run first: `bun --env-file=.env.test scripts/seed-community-chat-playground.ts`
- [ ] Apply once: `bun --env-file=.env.test scripts/seed-community-chat-playground.ts --apply`
- [ ] The seed is idempotent: a repeat reports the existing fixture and does not duplicate or rewrite its data.
- [ ] The fixture script deliberately has no destructive reset option; keep the community for continued testing or remove it using the project’s normal local data cleanup process.
