import type { Prisma } from "../prisma/generated/prisma/client";

// The badged community roles a user holds, for the role banners on their name.
// Shared so every user payload in the app carries the same shape. Participants
// are excluded at the query: they carry no badge, so fetching them would be
// dead rows on every payload in every feed. The badge rail renders one banner
// per distinct role, and the tooltip names the communities, so each row carries
// the community's name and slug alongside the role.
export function getCommunityRoleSelect() {
  return {
    select: {
      community: {
        select: {
          accentColor: true,
          avatarUrl: true,
          name: true,
          slug: true,
        },
      },
      role: true,
    },
    where: {
      role: { in: ["OWNER", "MODERATOR", "MEMBER"] },
      status: "ACTIVE",
    },
  } satisfies Prisma.CommunityMemberFindManyArgs;
}

// One community role row a user holds. Typed with the FULL role union rather
// than the badged subset that `getCommunityRoleSelect`'s `where` guarantees:
// Prisma cannot express a filtered relation's narrowing in its return type, and
// the badge renderer guards with `isBadgedRole` anyway. A single cast here would
// be needed otherwise, which is worse than an honest wider type.
export interface CommunityRoleRow {
  community: {
    accentColor: string;
    avatarUrl: string | null;
    name: string;
    slug: string;
  };
  role: "MEMBER" | "MODERATOR" | "OWNER" | "PARTICIPANT";
}

export function getPublicUserSelect(loggedInUserId: string) {
  return {
    _count: {
      select: {
        followers: true,
        following: true,
        // Posts, including responses: the profile Posts tab lists both, so the
        // count matches what the tab actually shows.
        posts: true,
      },
    },
    aura: true,
    avatarUrl: true,
    badge: true,
    badges: true,
    bannerUrl: true,
    bio: true,
    communityMemberships: getCommunityRoleSelect(),
    createdAt: true,
    customDomain: true,
    displayName: true,
    displayUsername: true,
    followers: {
      select: {
        followerId: true,
      },
      where: {
        followerId: loggedInUserId,
      },
    },
    githubUsername: true,
    id: true,
    linkedinUsername: true,
    redditUsername: true,
    twitterUsername: true,
    username: true,
  } satisfies Prisma.UserSelect;
}

export function getUserDataSelect(loggedInUserId: string) {
  return getPublicUserSelect(loggedInUserId);
}

export function getPrivateUserSelect(loggedInUserId: string) {
  return {
    ...getPublicUserSelect(loggedInUserId),
    avatarKey: true,
    bannerKey: true,
    email: true,
    emailVerified: true,
    googleId: true,
    lastLoginMethod: true,
    redditId: true,
    twoFactorEnabled: true,
  } satisfies Prisma.UserSelect;
}

export type PrivateUserData = Prisma.UserGetPayload<{
  select: ReturnType<typeof getPrivateUserSelect>;
}>;

export function getPostDataInclude(loggedInUserId: string) {
  return {
    _count: {
      select: {
        comments: {
          where: {
            deleted: false,
          },
        },
        mentions: true,
        // Direct responses only (one level), matching the action-bar count.
        responses: true,
        vote: true,
      },
    },
    attachments: true,
    bookmarks: {
      select: {
        userId: true,
      },
      where: {
        userId: loggedInUserId,
      },
    },
    // Native community post: the compact community identity drives the accent
    // rail and the a/<slug> attribution on the card. Null for global posts.
    community: {
      select: {
        accentColor: true,
        id: true,
        name: true,
        slug: true,
      },
    },
    // Reshare of a community post onto the global feed: carries the source
    // post id and the community it came from for the attribution card.
    communityShare: {
      select: {
        community: {
          select: {
            accentColor: true,
            id: true,
            name: true,
            slug: true,
          },
        },
        sourcePostId: true,
      },
    },
    hnStoryShare: true,
    mentions: {
      include: {
        user: {
          select: {
            avatarUrl: true,
            displayName: true,
            id: true,
            username: true,
          },
        },
      },
    },
    // Compact embedded parent for responses: enough to render the quoted card
    // (or a tombstone when `parentPost` is null but `parentPostId` is set)
    // without dragging the parent's full include into every feed row.
    parentPost: {
      select: {
        attachments: {
          select: {
            id: true,
            type: true,
          },
          take: 1,
        },
        content: true,
        createdAt: true,
        embeds: true,
        id: true,
        isGust: true,
        moderated: true,
        user: {
          select: {
            avatarUrl: true,
            badge: true,
            badges: true,
            // Badged community roles, so the quoted parent card's author shows
            // the same role banners as the main card.
            communityMemberships: getCommunityRoleSelect(),
            displayName: true,
            id: true,
            username: true,
          },
        },
        userId: true,
      },
    },
    tags: true,
    user: {
      select: getUserDataSelect(loggedInUserId),
    },
    vote: {
      select: {
        userId: true,
        value: true,
      },
      where: {
        userId: loggedInUserId,
      },
    },
  } satisfies Prisma.PostInclude;
}

export type UserData = Prisma.UserGetPayload<{
  select: ReturnType<typeof getUserDataSelect>;
}>;

export interface PostsPage {
  nextCursor: string | null;
  posts: PostData[];
}

export function getCommentDataInclude(loggedInUserId: string) {
  return {
    _count: {
      select: {
        votes: true,
      },
    },
    attachments: true,
    user: {
      select: getUserDataSelect(loggedInUserId),
    },
    votes: {
      select: {
        userId: true,
        value: true,
      },
      where: {
        userId: loggedInUserId,
      },
    },
  } satisfies Prisma.CommentInclude;
}

export type CommentData = Prisma.CommentGetPayload<{
  include: ReturnType<typeof getCommentDataInclude>;
}>;

export interface CommentVoteInfo {
  aura: number;
  userVote: number;
}

export interface CommentsPage {
  comments: CommentData[];
  previousCursor: string | null;
}

export const notificationsInclude = {
  comment: {
    select: {
      id: true,
      parent: {
        select: {
          userId: true,
        },
      },
      parentId: true,
    },
  },
  issuer: {
    select: {
      avatarUrl: true,
      displayName: true,
      id: true,
      username: true,
    },
  },
  post: {
    select: {
      content: true,
      id: true,
      isGust: true,
      parentPostId: true,
    },
  },
} satisfies Prisma.NotificationInclude;

export type NotificationData = Prisma.NotificationGetPayload<{
  include: typeof notificationsInclude;
}>;

export interface NotificationsPage {
  nextCursor: string | null;
  notifications: NotificationData[];
}

export interface FollowerInfo {
  followers: number;
  isFollowedByUser: boolean;
}

// Derived from the single source of truth (getPostDataInclude) so new relation
// projections stay in sync automatically.
export type PostData = Prisma.PostGetPayload<{
  include: ReturnType<typeof getPostDataInclude>;
}> & {
  aura: number;
};

// The compact embedded parent carried on a response row.
export type PostParentData = NonNullable<PostData["parentPost"]>;

export interface ResponsesPage {
  previousCursor: string | null;
  responses: PostData[];
}

export interface TagWithCount {
  _count?: {
    posts: number;
  };
  createdAt: Date;
  id: string;
  name: string;
  updatedAt: Date;
}

export interface VoteInfo {
  aura: number;
  userVote: number;
}

export interface BookmarkInfo {
  isBookmarkedByUser: boolean;
}

export interface NotificationCountInfo {
  unreadCount: number;
}

// E2EE message shapes. The server only ever sees ciphertext; the include below
// is intentionally lean (no plaintext fields to leak).
export const messageConversationInclude = {
  keys: true,
  members: {
    include: {
      user: {
        select: {
          avatarUrl: true,
          badge: true,
          badges: true,
          // Badged community roles, so the conversation header and message
          // rows show the same role banners as every other surface.
          communityMemberships: getCommunityRoleSelect(),
          displayName: true,
          id: true,
          messageIdentity: {
            select: { publicKey: true },
          },
          username: true,
        },
      },
    },
  },
} satisfies Prisma.MessageConversationInclude;

export type MessageConversationData = Prisma.MessageConversationGetPayload<{
  include: typeof messageConversationInclude;
}>;

export const messageInclude = {
  sender: {
    select: {
      avatarUrl: true,
      badge: true,
      badges: true,
      displayName: true,
      id: true,
      username: true,
    },
  },
} satisfies Prisma.MessageInclude;

export type MessageData = Prisma.MessageGetPayload<{
  include: typeof messageInclude;
}>;

export interface MessagePage {
  messages: MessageData[];
  previousCursor: string | null;
}

export interface ConversationListPage {
  conversations: MessageConversationData[];
  hasMore: boolean;
}

export interface BookmarkCountInfo {
  totalCount: number;
  // Split by kind so the bookmarks page tabs and sidebar tiles can show
  // per-category counts from one shared, reactive query.
  gustCount: number;
  hnCount: number;
  postCount: number;
}

export interface MessageCountInfo {
  error?: string;
  unreadCount: number;
}

export interface ShareStats {
  clicks: number;
  platform: string;
  shares: number;
}

export interface ShareResponse {
  shares: number;
}

export interface ClickResponse {
  clicks: number;
}

export interface FormStatus {
  error?: string;
  isLoading: boolean;
  isResending: boolean;
}

export interface SignUpFormProps {
  onError?: (error: Error) => void;
  onSuccess?: () => void;
}

export interface MentionData {
  createdAt: Date;
  id: string;
  postId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  userId: string;
}

export const mentionsInclude = {
  user: {
    select: {
      avatarUrl: true,
      displayName: true,
      id: true,
      username: true,
    },
  },
} satisfies Prisma.MentionInclude;

export interface UnfollowUserDialogProps {
  handleUnfollow: (userId: string) => void;
  onClose: () => void;
  open: boolean;
  user: UserData;
}

export * from "../prisma/generated/prisma/client";
