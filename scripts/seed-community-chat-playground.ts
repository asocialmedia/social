#!/usr/bin/env bun

import { hashPasswordWithScrypt } from "@asm/auth/core";
import { closePrisma, keys, prisma, toPrismaDateTime } from "@asm/db";

const OWNER_USERNAME = "anny";
const FIXTURE_SLUG = "community-chat-playground";
const FIXTURE_ID = "community_chat_playground_v1";
const TEST_PASSWORD = "Test@1234";
const NOW = new Date();

interface TestChannel {
  id: string;
  locked?: boolean;
  name: string;
  slug: string;
  slowModeSeconds?: number;
  sortOrder: number;
  topic: string;
  type: "ANNOUNCEMENT" | "TEXT";
}

const TEST_MEMBERS = [
  {
    displayName: "Mira Chen · Guide",
    email: "communitychat_mod@asocialmedia.local",
    id: "communitychat_mod",
    role: "MODERATOR" as const,
    status: "ACTIVE" as const,
    username: "communitychat_mod",
  },
  {
    displayName: "Nico Reyes · Invited",
    email: "communitychat_invited@asocialmedia.local",
    id: "communitychat_invited",
    role: "PARTICIPANT" as const,
    status: "ACTIVE" as const,
    username: "communitychat_invited",
  },
  {
    displayName: "Ari Patel · Member",
    email: "communitychat_member@asocialmedia.local",
    id: "communitychat_member",
    role: "PARTICIPANT" as const,
    status: "ACTIVE" as const,
    username: "communitychat_member",
  },
  {
    displayName: "Sam Okafor · Timed out",
    email: "communitychat_timedout@asocialmedia.local",
    id: "communitychat_timedout",
    role: "PARTICIPANT" as const,
    status: "ACTIVE" as const,
    username: "communitychat_timedout",
  },
  {
    displayName: "Casey Lane · Pending",
    email: "communitychat_pending@asocialmedia.local",
    id: "communitychat_pending",
    role: "PARTICIPANT" as const,
    status: "PENDING" as const,
    username: "communitychat_pending",
  },
];

const CHANNELS: TestChannel[] = [
  {
    id: "ccp_channel_general",
    name: "general",
    slug: "general",
    sortOrder: 0,
    topic: "A shared place to catch up and start a conversation.",
    type: "TEXT" as const,
  },
  {
    id: "ccp_channel_introductions",
    name: "introductions",
    slug: "introductions",
    sortOrder: 1,
    topic: "Say hello and share what brought you here.",
    type: "TEXT" as const,
  },
  {
    id: "ccp_channel_field_notes",
    name: "field-notes",
    slug: "field-notes",
    sortOrder: 2,
    topic: "Ideas, observations, and useful links from the community.",
    type: "TEXT" as const,
  },
  {
    id: "ccp_channel_announcements",
    name: "announcements",
    slug: "announcements",
    sortOrder: 3,
    topic: "Updates from the community team.",
    type: "ANNOUNCEMENT" as const,
  },
  {
    id: "ccp_channel_slow_mode",
    name: "slow-mode",
    slug: "slow-mode",
    slowModeSeconds: 5,
    sortOrder: 4,
    topic: "A five-second pause between your messages.",
    type: "TEXT" as const,
  },
  {
    id: "ccp_channel_quiet_corner",
    locked: true,
    name: "quiet-corner",
    slug: "quiet-corner",
    sortOrder: 5,
    topic: "Read-only room for a short community notice.",
    type: "TEXT" as const,
  },
];

const MESSAGE_IDS = {
  welcome: "ccp_msg_general_welcome",
  welcomeReply: "ccp_msg_general_reply",
  edited: "ccp_msg_general_edited",
  removed: "ccp_msg_general_removed",
  intro: "ccp_msg_intro_welcome",
  publicThreadRoot: "ccp_msg_field_thread_root",
  announcement: "ccp_msg_announcement",
  slowMode: "ccp_msg_slow_mode",
  quietCorner: "ccp_msg_quiet_corner",
};

const ROOM_IDS = {
  publicThread: "ccp_thread_field_notes",
  privateThread: "ccp_thread_small_group",
};

function requireLocalTestDatabase(): void {
  const url = new URL(keys.DATABASE_URL);
  const allowedHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const allowedDatabase = url.pathname.replace(/^\//u, "") === "asocialmedia";
  if (
    process.env.NODE_ENV === "production" ||
    !allowedHost ||
    url.port !== "5433" ||
    !allowedDatabase
  ) {
    throw new Error(
      "Refusing to seed outside the local .env.test database on localhost:5433/asocialmedia"
    );
  }
}

function timestamp(minutesAgo: number) {
  return toPrismaDateTime(new Date(NOW.getTime() - minutesAgo * 60_000));
}

function requireCommunityMemberId(
  memberIds: Map<string, string>,
  username: string
): string {
  const id = memberIds.get(username);
  if (!id) {
    throw new Error(`Community membership was not prepared for @${username}`);
  }
  return id;
}

async function printExistingFixture(communityId: string): Promise<void> {
  const [rooms, messages, posts, memberships] = await Promise.all([
    prisma.orm.public.CommunityChatRooms.where({ communityId }).all(),
    prisma.orm.public.CommunityChatMessages.where((message) =>
      message.roomId.in([
        ...CHANNELS.map((channel) => channel.id),
        ROOM_IDS.publicThread,
        ROOM_IDS.privateThread,
      ])
    ).all(),
    prisma.orm.public.Posts.where({ communityId }).all(),
    prisma.orm.public.CommunityMembers.where({ communityId }).all(),
  ]);
  console.log(
    JSON.stringify(
      {
        alreadySeeded: true,
        community: FIXTURE_SLUG,
        counts: {
          channels: rooms.filter((room) => room.kind === "CHANNEL").length,
          members: memberships.filter((member) => member.status === "ACTIVE")
            .length,
          messages: messages.length,
          posts: posts.length,
          threads: rooms.filter((room) => room.kind === "THREAD").length,
        },
        path: `/a/${FIXTURE_SLUG}`,
      },
      null,
      2
    )
  );
}

async function main(): Promise<void> {
  requireLocalTestDatabase();
  const apply = process.argv.includes("--apply");
  const owner = await prisma.orm.public.Users.select("id", "username")
    .where({ username: OWNER_USERNAME })
    .first();
  if (!owner) {
    throw new Error(
      `Expected existing owner account @${OWNER_USERNAME}; no account was modified`
    );
  }

  const existingCommunity = await prisma.orm.public.Communities.select(
    "id",
    "ownerId"
  )
    .where({ slug: FIXTURE_SLUG })
    .first();
  if (existingCommunity) {
    if (
      existingCommunity.id !== FIXTURE_ID ||
      existingCommunity.ownerId !== owner.id
    ) {
      throw new Error(
        `Slug ${FIXTURE_SLUG} is already owned by another community; refusing to modify it`
      );
    }
    await printExistingFixture(existingCommunity.id);
    return;
  }

  const testUsernames = TEST_MEMBERS.map((member) => member.username);
  const existingUsers = await prisma.orm.public.Users.select("id", "username")
    .where((user) => user.username.in(testUsernames))
    .all();
  const existingUserIds = await prisma.orm.public.Users.select("id")
    .where((user) => user.id.in(TEST_MEMBERS.map((member) => member.id)))
    .all();
  const existingEmails = await prisma.orm.public.Users.select("email")
    .where((user) => user.email.in(TEST_MEMBERS.map((member) => member.email)))
    .all();
  const existingAccounts = await prisma.orm.public.Accounts.select(
    "accountId",
    "providerId"
  )
    .where((account) =>
      account.accountId.in(TEST_MEMBERS.map((member) => member.id))
    )
    .all();
  if (
    existingUsers.length > 0 ||
    existingUserIds.length > 0 ||
    existingEmails.length > 0 ||
    existingAccounts.length > 0
  ) {
    throw new Error(
      `Test account collision (${existingUsers.map((user) => user.username).join(", ") || "id or email"}); refusing to modify existing accounts`
    );
  }
  const existingId = await prisma.orm.public.Communities.select("id")
    .where({ id: FIXTURE_ID })
    .first();
  if (existingId) {
    throw new Error(`Fixture id ${FIXTURE_ID} is already in use`);
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          plan: {
            community: FIXTURE_SLUG,
            channels: CHANNELS.length,
            owner: `@${owner.username}`,
            testAccounts: TEST_MEMBERS.length,
            threads: 2,
            testPassword: TEST_PASSWORD,
          },
          applyCommand:
            "bun --env-file=.env.test scripts/seed-community-chat-playground.ts --apply",
        },
        null,
        2
      )
    );
    return;
  }

  const accountPasswords = await Promise.all(
    TEST_MEMBERS.map(() => hashPasswordWithScrypt(TEST_PASSWORD))
  );
  const testAccounts = TEST_MEMBERS.map((member, index) => {
    const password = accountPasswords[index];
    if (!password) {
      throw new Error(
        `Credential hash was not prepared for @${member.username}`
      );
    }
    return { member, password };
  });
  const allUsers = [
    {
      id: owner.id,
      role: "OWNER" as const,
      status: "ACTIVE" as const,
      username: owner.username,
    },
    ...TEST_MEMBERS.map((member) => ({
      id: member.id,
      role: member.role,
      status: member.status,
      username: member.username,
    })),
  ];
  const communityMemberIdByUser = new Map(
    allUsers.map((member) => [member.username, `ccp_member_${member.username}`])
  );

  await prisma.transaction(async (tx) => {
    await tx.orm.public.Users.createAll(
      TEST_MEMBERS.map((member) => ({
        displayName: member.displayName,
        email: member.email,
        emailVerified: true,
        id: member.id,
        username: member.username,
      }))
    );
    await tx.orm.public.Accounts.createAll(
      testAccounts.map(({ member, password }) => ({
        accountId: member.id,
        password,
        providerId: "credential",
        userId: member.id,
      }))
    );
    await tx.orm.public.Communities.create({
      _type: "PUBLIC",
      accentColor: "pine",
      activeMemberCount:
        1 + TEST_MEMBERS.filter((member) => member.status === "ACTIVE").length,
      createdAt: toPrismaDateTime(NOW),
      description:
        "A hands-on community for exploring conversations, shared ideas, and everyday creativity.",
      id: FIXTURE_ID,
      name: "The Open Table",
      ownerId: owner.id,
      slug: FIXTURE_SLUG,
      topics: ["creative practice", "community", "field notes"],
    });
    await tx.orm.public.CommunityMembers.createAll(
      allUsers.map((member) => ({
        communityId: FIXTURE_ID,
        createdAt: toPrismaDateTime(NOW),
        id: requireCommunityMemberId(communityMemberIdByUser, member.username),
        role: member.role,
        status: member.status,
        userId: member.id,
      }))
    );
    await tx.orm.public.CommunityChatRooms.createAll(
      CHANNELS.map((channel) => ({
        channelType: channel.type,
        communityId: FIXTURE_ID,
        creatorId: owner.id,
        id: channel.id,
        kind: "CHANNEL" as const,
        locked: channel.locked ?? false,
        name: channel.name,
        nextSequence: 0n,
        slug: channel.slug,
        slowModeSeconds: channel.slowModeSeconds ?? 0,
        sortOrder: channel.sortOrder,
        topic: channel.topic,
      }))
    );

    const channelMessages = [
      {
        id: MESSAGE_IDS.welcome,
        minutesAgo: 160,
        roomId: "ccp_channel_general",
        senderId: owner.id,
        text: "Welcome to The Open Table 🌿 This is a space for sharing what you are making, learning, and noticing. Start anywhere; the channels are just gentle signposts.",
      },
      {
        id: MESSAGE_IDS.welcomeReply,
        minutesAgo: 156,
        replyToId: MESSAGE_IDS.welcome,
        roomId: "ccp_channel_general",
        senderId: "communitychat_invited",
        text: "Happy to be here. I found the group through the weekend sketch walk!",
      },
      {
        id: MESSAGE_IDS.edited,
        minutesAgo: 148,
        roomId: "ccp_channel_general",
        senderId: "communitychat_mod",
        text: "Small update: our open studio starts at 6:30 this Friday. Bring any work in progress.",
        edited: true,
      },
      {
        id: MESSAGE_IDS.removed,
        minutesAgo: 142,
        roomId: "ccp_channel_general",
        senderId: "communitychat_member",
        text: "A removed message left here as a moderation example.",
        deleted: true,
      },
      {
        id: MESSAGE_IDS.intro,
        minutesAgo: 128,
        roomId: "ccp_channel_introductions",
        senderId: "communitychat_member",
        text: "Hi all! I am Ari. Lately I have been taking the long way home and collecting colors from the neighborhood for a small illustration series.",
      },
      {
        id: MESSAGE_IDS.publicThreadRoot,
        minutesAgo: 112,
        roomId: "ccp_channel_field_notes",
        senderId: "communitychat_invited",
        text: "What is one small thing that helped you make time for a creative habit this week? I started leaving a sketchbook by the kettle.",
      },
      {
        id: MESSAGE_IDS.announcement,
        minutesAgo: 90,
        roomId: "ccp_channel_announcements",
        senderId: owner.id,
        text: "Community note: the shared studio is open Friday from 6:30–8:00. Add your access needs in the related post on the community page.",
      },
      {
        id: MESSAGE_IDS.slowMode,
        minutesAgo: 72,
        roomId: "ccp_channel_slow_mode",
        senderId: "communitychat_member",
        text: "A quick prompt: what is a useful tool you only discovered recently?",
      },
      {
        id: MESSAGE_IDS.quietCorner,
        minutesAgo: 58,
        roomId: "ccp_channel_quiet_corner",
        senderId: owner.id,
        text: "This room is read-only while the team updates the community guide. Try the other channels for conversation.",
      },
    ];
    const channelSequenceByRoom = new Map<string, bigint>();
    const channelRows = channelMessages.map((message, index) => {
      const sequence = (channelSequenceByRoom.get(message.roomId) ?? 0n) + 1n;
      channelSequenceByRoom.set(message.roomId, sequence);
      const timestampValue = timestamp(message.minutesAgo);
      return {
        changeSequence: sequence,
        clientId: `ccp-seed-${index.toString().padStart(2, "0")}`,
        createdAt: timestampValue,
        deletedAt: message.deleted ? timestampValue : undefined,
        editedAt: message.edited ? timestampValue : undefined,
        id: message.id,
        payload: { content: message.text, type: "text" },
        replyToId: message.replyToId,
        revision: message.edited || message.deleted ? 2 : 1,
        roomId: message.roomId,
        senderId: message.senderId,
        sequence,
      };
    });
    await tx.orm.public.CommunityChatMessages.createAll(channelRows);

    await tx.orm.public.CommunityChatRooms.createAll([
      {
        communityId: FIXTURE_ID,
        creatorId: "communitychat_invited",
        id: ROOM_IDS.publicThread,
        kind: "THREAD",
        name: "Making room for a creative habit",
        nextSequence: 0n,
        parentRoomId: "ccp_channel_field_notes",
        slug: ROOM_IDS.publicThread,
        sourceMessageId: MESSAGE_IDS.publicThreadRoot,
        visibility: "PUBLIC",
      },
      {
        communityId: FIXTURE_ID,
        creatorId: owner.id,
        id: ROOM_IDS.privateThread,
        kind: "THREAD",
        name: "Friday studio details",
        nextSequence: 1n,
        parentRoomId: "ccp_channel_general",
        slug: ROOM_IDS.privateThread,
        visibility: "PRIVATE",
      },
    ]);

    const threadStarter = {
      changeSequence: 1n,
      clientId: "ccp-private-start-01",
      createdAt: timestamp(46),
      id: "ccp_msg_private_starter",
      payload: {
        content:
          "The side entrance is step-free. Nico, I have shared the supply list below; feel free to add anything we should bring.",
        type: "text",
      },
      roomId: ROOM_IDS.privateThread,
      senderId: owner.id,
      sequence: 1n,
    };
    const threadReplies = [
      {
        changeSequence: 1n,
        clientId: "ccp-public-reply-01",
        createdAt: timestamp(104),
        id: "ccp_msg_public_thread_reply_1",
        payload: {
          content:
            "Putting the materials out the night before made it much easier to begin.",
          type: "text",
        },
        roomId: ROOM_IDS.publicThread,
        senderId: "communitychat_mod",
        sequence: 1n,
      },
      {
        changeSequence: 2n,
        clientId: "ccp-public-reply-02",
        createdAt: timestamp(98),
        id: "ccp_msg_public_thread_reply_2",
        payload: {
          content:
            "I like the kettle idea. A tiny routine can take the pressure off making something impressive.",
          type: "text",
        },
        replyToId: "ccp_msg_public_thread_reply_1",
        roomId: ROOM_IDS.publicThread,
        senderId: "communitychat_member",
        sequence: 2n,
      },
      {
        changeSequence: 2n,
        clientId: "ccp-private-reply-01",
        createdAt: timestamp(42),
        id: "ccp_msg_private_reply",
        payload: {
          content: "Thanks! I will bring paper, tape, and the portable lamp.",
          type: "text",
        },
        replyToId: threadStarter.id,
        roomId: ROOM_IDS.privateThread,
        senderId: "communitychat_invited",
        sequence: 2n,
      },
    ];
    await tx.orm.public.CommunityChatMessages.create(threadStarter);
    await tx.orm.public.CommunityChatMessages.createAll(threadReplies);
    await tx.orm.public.CommunityChatRooms.where({
      id: "ccp_channel_general",
    }).updateAndCount({
      changeSequence: channelSequenceByRoom.get("ccp_channel_general") ?? 0n,
      nextSequence: channelSequenceByRoom.get("ccp_channel_general") ?? 0n,
      updatedAt: toPrismaDateTime(NOW),
    });
    for (const room of CHANNELS) {
      if (room.id === "ccp_channel_general") {
        continue;
      }
      const sequence = channelSequenceByRoom.get(room.id) ?? 0n;
      await tx.orm.public.CommunityChatRooms.where({
        id: room.id,
      }).updateAndCount({
        changeSequence: sequence,
        nextSequence: sequence,
        updatedAt: toPrismaDateTime(NOW),
      });
    }
    await tx.orm.public.CommunityChatRooms.where({
      id: ROOM_IDS.publicThread,
    }).updateAndCount({
      changeSequence: 2n,
      nextSequence: 2n,
      updatedAt: toPrismaDateTime(NOW),
    });
    await tx.orm.public.CommunityChatRooms.where({
      id: ROOM_IDS.privateThread,
    }).updateAndCount({
      changeSequence: 2n,
      nextSequence: 2n,
      updatedAt: toPrismaDateTime(NOW),
    });
    await tx.orm.public.CommunityChatOutbox.createAll(
      [...channelRows, threadStarter, ...threadReplies].map((message) => ({
        createdAt: message.createdAt,
        id: `ccp_outbox_${message.id}`,
        kind: "message.created",
        messageId: message.id,
        payload: {
          messageId: message.id,
          sequence: message.sequence.toString(),
        },
        publishedAt: toPrismaDateTime(NOW),
        roomId: message.roomId,
        sequence: message.changeSequence,
      }))
    );

    const privateMembers = [owner.username, "communitychat_invited"];
    await tx.orm.public.CommunityChatRoomMembers.createAll(
      privateMembers.map((username) => ({
        communityMemberId: requireCommunityMemberId(
          communityMemberIdByUser,
          username
        ),
        invitedById: owner.id,
        roomId: ROOM_IDS.privateThread,
      }))
    );
    await tx.orm.public.CommunityChatSubscriptions.createAll([
      {
        following: true,
        roomId: ROOM_IDS.publicThread,
        userId: "communitychat_invited",
      },
      {
        following: true,
        roomId: ROOM_IDS.publicThread,
        userId: "communitychat_mod",
      },
      { following: true, roomId: ROOM_IDS.privateThread, userId: owner.id },
      {
        following: true,
        roomId: ROOM_IDS.privateThread,
        userId: "communitychat_invited",
      },
    ]);
    await tx.orm.public.CommunityChatReactions.createAll([
      {
        createdAt: timestamp(150),
        emoji: "🌿",
        messageId: MESSAGE_IDS.welcome,
        userId: "communitychat_invited",
      },
      {
        createdAt: timestamp(149),
        emoji: "🌿",
        messageId: MESSAGE_IDS.welcome,
        userId: "communitychat_mod",
      },
      {
        createdAt: timestamp(103),
        emoji: "✨",
        messageId: "ccp_msg_public_thread_reply_1",
        userId: "communitychat_invited",
      },
    ]);
    await tx.orm.public.CommunityChatPins.create({
      createdAt: timestamp(145),
      messageId: MESSAGE_IDS.welcome,
      pinnedById: owner.id,
      roomId: "ccp_channel_general",
    });
    await tx.orm.public.CommunityChatSanctions.create({
      actorId: owner.id,
      communityId: FIXTURE_ID,
      createdAt: timestamp(12),
      expiresAt: toPrismaDateTime(new Date(NOW.getTime() + 24 * 60 * 60_000)),
      id: "ccp_sanction_timedout",
      kind: "TIMEOUT",
      reason: "Fixture account for checking contribution restrictions.",
      userId: "communitychat_timedout",
    });

    const posts = [
      {
        content:
          "A few colors from this morning's walk. What shades have you been noticing lately?",
        embeds: [
          {
            description:
              "A quiet mountain lake surrounded by forest and soft morning light.",
            imageUrl:
              "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=1200&h=800&fit=crop&auto=format",
            siteName: "Unsplash",
            title: "Morning colors by the lake",
            type: "link",
            url: "https://unsplash.com/photos/mountain-lake-in-the-morning",
          },
        ],
        id: "ccp_post_morning_colors",
        minutesAgo: 220,
        userId: owner.id,
      },
      {
        content:
          "A small collection of textures for the next collage session: leaves, stone, and old paper.",
        embeds: [
          {
            description:
              "A close view of green leaves catching gentle daylight.",
            imageUrl:
              "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1200&h=800&fit=crop&auto=format",
            siteName: "Unsplash",
            title: "Textures for a collage walk",
            type: "link",
            url: "https://unsplash.com/photos/green-forest-trees",
          },
        ],
        id: "ccp_post_texture_walk",
        minutesAgo: 170,
        userId: "communitychat_mod",
      },
      {
        content:
          "Weekend prompt: take a photo of something ordinary that looked different when you slowed down.",
        embeds: [
          {
            description:
              "A path through a sunlit garden, framed by trees and green grass.",
            imageUrl:
              "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&h=800&fit=crop&auto=format",
            siteName: "Unsplash",
            title: "A slower path through the garden",
            type: "link",
            url: "https://unsplash.com/photos/forest-path",
          },
        ],
        id: "ccp_post_weekend_prompt",
        minutesAgo: 110,
        userId: "communitychat_invited",
      },
    ];
    await tx.orm.public.Posts.createAll(
      posts.map((post) => ({
        communityId: FIXTURE_ID,
        content: post.content,
        createdAt: timestamp(post.minutesAgo),
        embeds: post.embeds,
        id: post.id,
        userId: post.userId,
      }))
    );
    await tx.orm.public.Comments.createAll([
      {
        content:
          "The fern green and warm stone colors are a lovely combination.",
        createdAt: timestamp(205),
        id: "ccp_comment_morning_colors",
        postId: "ccp_post_morning_colors",
        userId: "communitychat_member",
      },
    ]);
    await tx.orm.public.Votes.createAll([
      {
        createdAt: timestamp(204),
        postId: "ccp_post_morning_colors",
        userId: "communitychat_mod",
        value: 1,
      },
      {
        createdAt: timestamp(109),
        postId: "ccp_post_weekend_prompt",
        userId: "communitychat_member",
        value: 1,
      },
    ]);
  });

  console.log(
    JSON.stringify(
      {
        seeded: true,
        community: {
          name: "The Open Table",
          owner: `@${owner.username}`,
          slug: FIXTURE_SLUG,
          url: `/a/${FIXTURE_SLUG}`,
        },
        testAccounts: TEST_MEMBERS.map(({ displayName, username }) => ({
          displayName,
          username,
        })),
        sharedTestPassword: TEST_PASSWORD,
        channels: CHANNELS.map((channel) => channel.slug),
        threads: [
          "public: Making room for a creative habit",
          "private: Friday studio details",
        ],
        counts: { chatMessages: 13, posts: 3, imagePreviews: 3 },
        note: "Community chat currently stores text only. The three image previews are community posts and use the existing safe link-preview image proxy.",
      },
      null,
      2
    )
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrisma();
  });
