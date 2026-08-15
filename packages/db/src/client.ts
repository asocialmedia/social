import type { Prisma } from "../prisma/generated/prisma/client";

export function getUserDataSelect(loggedInUserId: string) {
  return {
    _count: {
      select: {
        followers: true,
        following: true,
        posts: true,
      },
    },
    aura: true,
    avatarKey: true,
    avatarUrl: true,
    badge: true,
    bannerKey: true,
    bannerUrl: true,
    bio: true,
    createdAt: true,
    displayName: true,
    email: true,
    emailVerified: true,
    followers: {
      select: {
        followerId: true,
      },
      where: {
        followerId: loggedInUserId,
      },
    },
    githubUsername: true,
    googleId: true,
    id: true,
    linkedinUsername: true,
    passwordHash: true,
    redditId: true,
    redditUsername: true,
    twitterUsername: true,
    username: true,
  } satisfies Prisma.UserSelect;
}

export function getPostDataInclude(loggedInUserId: string) {
  return {
    _count: {
      select: {
        comments: true,
        mentions: true,
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

export type PostData = Prisma.PostGetPayload<{
  include: {
    user: {
      select: ReturnType<typeof getUserDataSelect>;
    };
    attachments: true;
    tags: true;
    mentions: {
      include: {
        user: {
          select: {
            id: true;
            username: true;
            displayName: true;
            avatarUrl: true;
          };
        };
      };
    };
    bookmarks: {
      where: {
        userId: string;
      };
      select: {
        userId: true;
      };
    };
    vote: {
      where: {
        userId: string;
      };
      select: {
        userId: true;
        value: true;
      };
    };
    hnStoryShare: true;
    _count: {
      select: {
        vote: true;
        comments: true;
        mentions: true;
      };
    };
  };
}> & {
  aura: number;
};

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
          displayName: true,
          id: true,
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
