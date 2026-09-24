import type { ResultType } from "@prisma/orm-postgres/components/runtime";
import { and } from "@prisma/orm-postgres/orm-client";

import { communityVisibilityWhere } from "./communities/visibility";
import type { PrismaOrm } from "./prisma";
import { fromPrismaDateTime } from "./prisma";

export interface CommunityRoleRow {
  community: {
    accentColor: string;
    avatarUrl: string | null;
    name: string;
    slug: string;
  };
  role: "MEMBER" | "MODERATOR" | "OWNER" | "PARTICIPANT";
}

type UserQueryData = ResultType<ReturnType<typeof getUserDataQuery>>;

export interface UserData extends Omit<
  UserQueryData,
  "communityMembers" | "createdAt" | "followsFollows"
> {
  communityMemberships: CommunityRoleRow[];
  createdAt: Date;
  followers: { followerId: string }[];
}

export function mapUserData(user: UserQueryData): UserData {
  const { communityMembers, createdAt, followsFollows, ...scalars } = user;
  return {
    ...scalars,
    communityMemberships: communityMembers.flatMap((membership) =>
      membership.community
        ? [
            {
              community: membership.community,
              role: membership.role,
            },
          ]
        : []
    ),
    createdAt: fromPrismaDateTime(createdAt),
    followers: followsFollows,
  };
}

export function getPublicUserQuery(orm: PrismaOrm, loggedInUserId: string) {
  return orm.public.Users.select(
    "aura",
    "avatarUrl",
    "badge",
    "badges",
    "bannerUrl",
    "bio",
    "createdAt",
    "customDomain",
    "displayName",
    "displayUsername",
    "githubUsername",
    "id",
    "linkedinUsername",
    "redditUsername",
    "twitterUsername",
    "username"
  )
    .include("communityMembers", (memberships) =>
      memberships
        .where((member) =>
          and(
            member.status.eq("ACTIVE"),
            member.role.in(["OWNER", "MODERATOR", "MEMBER"])
          )
        )
        .select("role")
        .include("community", (community) =>
          community.select("accentColor", "avatarUrl", "name", "slug")
        )
    )
    .include("followsFollows", (follows) =>
      follows.where({ followerId: loggedInUserId }).select("followerId")
    );
}

export function getUserDataQuery(orm: PrismaOrm, loggedInUserId: string) {
  return getPublicUserQuery(orm, loggedInUserId);
}

export function getPrivateUserQuery(orm: PrismaOrm, loggedInUserId: string) {
  return orm.public.Users.select(
    "aura",
    "avatarKey",
    "avatarUrl",
    "badge",
    "badges",
    "bannerKey",
    "bannerUrl",
    "bio",
    "createdAt",
    "customDomain",
    "displayName",
    "displayUsername",
    "email",
    "emailVerified",
    "githubUsername",
    "googleId",
    "id",
    "lastLoginMethod",
    "linkedinUsername",
    "redditId",
    "redditUsername",
    "twitterUsername",
    "twoFactorEnabled",
    "username"
  )
    .include("communityMembers", (memberships) =>
      memberships
        .where((member) =>
          and(
            member.status.eq("ACTIVE"),
            member.role.in(["OWNER", "MODERATOR", "MEMBER"])
          )
        )
        .select("role")
        .include("community", (community) =>
          community.select("accentColor", "avatarUrl", "name", "slug")
        )
    )
    .include("followsFollows", (follows) =>
      follows.where({ followerId: loggedInUserId }).select("followerId")
    );
}

export type PrivateUserData = ResultType<
  ReturnType<typeof getPrivateUserQuery>
>;

export function getPostDataQuery(orm: PrismaOrm, loggedInUserId: string) {
  return orm.public.Posts.include("bookmarks", (bookmarks) =>
    bookmarks.combine({
      total: bookmarks.count(),
      viewer: bookmarks.where({ userId: loggedInUserId }).select("userId"),
    })
  )
    .include("comments", (comments) =>
      comments.where((comment) => comment.deleted.eq(false)).count()
    )
    .include("mentions", (mentions) =>
      mentions.include("user", (user) =>
        user.select("avatarUrl", "displayName", "id", "username")
      )
    )
    .include("postMedias", (media) =>
      media.select("id", "_type", "thumbnailKey").limit(1)
    )
    .include("posts", (responses) => responses.count())
    .include("postToTags", (postTags) =>
      postTags.include("tag", (tag) => tag.select("name"))
    )
    .include("votes", (votes) =>
      votes.where({ userId: loggedInUserId }).select("userId", "value")
    )
    .include("community", (community) =>
      community.select("accentColor", "id", "name", "slug")
    )
    .include("communityPostShares", (share) =>
      share
        .select("sourcePostId")
        .include("community", (community) => community.select("slug"))
    )
    .include("hnStoryShares")
    .include("user", (_user) => getUserDataQuery(orm, loggedInUserId))
    .include("parentPost", (parent) =>
      parent
        .where(communityVisibilityWhere(loggedInUserId))
        .select(
          "content",
          "createdAt",
          "embeds",
          "id",
          "isGust",
          "moderated",
          "userId"
        )
        .include("postMedias", (media) => media.select("id", "_type").limit(1))
        .include("community", (community) => community.select("slug"))
        .include("user", (user) =>
          user
            .select(
              "avatarUrl",
              "badge",
              "badges",
              "displayName",
              "id",
              "username"
            )
            .include("communityMembers", (memberships) =>
              memberships
                .where((member) =>
                  and(
                    member.status.eq("ACTIVE"),
                    member.role.in(["OWNER", "MODERATOR", "MEMBER"])
                  )
                )
                .select("role")
                .include("community", (community) =>
                  community.select("accentColor", "avatarUrl", "name", "slug")
                )
            )
        )
    );
}

export type PostQueryData = ResultType<ReturnType<typeof getPostDataQuery>>;

export interface PostParentData {
  attachments: {
    id: string;
    type: "AUDIO" | "DOCUMENT" | "IMAGE" | "VIDEO";
  }[];
  community: { slug: string } | null;
  content: string;
  createdAt: Date;
  embeds: unknown;
  id: string;
  isGust: boolean;
  moderated: boolean;
  user: CommunityRoleUser;
  userId: string;
}

export interface PostData extends Omit<
  PostQueryData,
  | "bookmarks"
  | "comments"
  | "communityPostShares"
  | "createdAt"
  | "hnStoryShares"
  | "parentPost"
  | "postMedias"
  | "postToTags"
  | "posts"
  | "user"
  | "votes"
> {
  _count: {
    bookmarks: number;
    comments: number;
    responses: number;
    vote: number;
  };
  attachments: {
    id: string;
    thumbnailKey: string | null;
    type: "AUDIO" | "DOCUMENT" | "IMAGE" | "VIDEO";
  }[];
  bookmarks: { userId: string }[];
  createdAt: Date;
  communityShare: {
    community: { slug: string };
    sourcePostId: string;
  } | null;
  hnStoryShare: PostQueryData["hnStoryShares"][number] | undefined;
  parentPost: PostParentData | null;
  tags: { name: string }[];
  user: UserData;
  vote: { userId: string; value: number }[];
  aura: number;
}

interface CommunityRoleUser {
  avatarUrl: string | null;
  badge: string | null;
  badges: readonly string[];
  communityMemberships: CommunityRoleRow[];
  displayName: string;
  id: string;
  username: string;
}

export function mapPostData(post: PostQueryData): PostData {
  if (!post.user) {
    throw new Error(`Post ${post.id} has no author`);
  }
  const {
    bookmarks,
    communityPostShares,
    hnStoryShares,
    postMedias,
    posts,
    postToTags,
    user,
    votes,
    ...scalarsAndRelations
  } = post;
  return {
    ...scalarsAndRelations,
    _count: {
      bookmarks: bookmarks.total,
      comments: post.comments,
      responses: posts,
      vote: votes.length,
    },
    attachments: postMedias.map((media) => ({
      id: media.id,
      thumbnailKey: media.thumbnailKey,
      type: media._type,
    })),
    bookmarks: bookmarks.viewer,
    communityShare:
      communityPostShares[0] && communityPostShares[0].community
        ? {
            community: communityPostShares[0].community,
            sourcePostId: communityPostShares[0].sourcePostId,
          }
        : null,
    createdAt: fromPrismaDateTime(post.createdAt),
    hnStoryShare: hnStoryShares[0],
    parentPost: post.parentPost
      ? (() => {
          const {
            postMedias: parentPostMedias,
            user: parentUser,
            ...parent
          } = post.parentPost;
          if (!parentUser) {
            throw new Error(`Post ${post.parentPost.id} has no author`);
          }
          return {
            ...parent,
            attachments: parentPostMedias.map((media) => ({
              id: media.id,
              type: media._type,
            })),
            createdAt: fromPrismaDateTime(parent.createdAt),
            user: {
              avatarUrl: parentUser.avatarUrl,
              badge: parentUser.badge,
              badges: parentUser.badges ?? [],
              communityMemberships: parentUser.communityMembers.flatMap(
                (membership) =>
                  membership.community
                    ? [
                        {
                          community: membership.community,
                          role: membership.role,
                        },
                      ]
                    : []
              ),
              displayName: parentUser.displayName,
              id: parentUser.id,
              username: parentUser.username,
            },
          };
        })()
      : null,
    tags: postToTags.flatMap((postTag) => (postTag.tag ? [postTag.tag] : [])),
    user: mapUserData(user),
    vote: votes,
  };
}

export interface PostsPage {
  nextCursor: string | null;
  posts: PostData[];
}

export function getCommentDataQuery(orm: PrismaOrm, loggedInUserId: string) {
  return orm.public.Comments.include("commentVotes", (commentVotes) =>
    commentVotes.where({ userId: loggedInUserId }).select("userId", "value")
  ).include("user", (_user) => getUserDataQuery(orm, loggedInUserId));
}

export type CommentQueryData = ResultType<
  ReturnType<typeof getCommentDataQuery>
>;

export interface CommentData extends Omit<
  CommentQueryData,
  "commentVotes" | "createdAt" | "user"
> {
  createdAt: Date;
  user: UserData;
  vote: CommentQueryData["commentVotes"];
}

export function mapCommentData(comment: CommentQueryData): CommentData {
  if (!comment.user) {
    throw new Error(`Comment ${comment.id} has no author`);
  }
  const { commentVotes, createdAt, user, ...rest } = comment;
  return {
    ...rest,
    createdAt: fromPrismaDateTime(createdAt),
    user: mapUserData(user),
    vote: commentVotes,
  };
}

export interface CommentVoteInfo {
  aura: number;
  userVote: number;
}

export interface CommentsPage {
  comments: CommentData[];
  previousCursor: string | null;
}

export function getNotificationDataQuery(orm: PrismaOrm) {
  return orm.public.Notifications.include("comment", (comment) =>
    comment
      .select("id", "parentId")
      .include("parent", (parent) => parent.select("userId"))
  )
    .include("community", (community) =>
      community.select("accentColor", "id", "name", "slug")
    )
    .include("issuer", (issuer) =>
      issuer.select("avatarUrl", "displayName", "id", "username")
    )
    .include("post", (post) =>
      post
        .select("content", "id", "isGust", "parentPostId")
        .include("community", (community) => community.select("slug"))
    );
}

export type NotificationQueryData = ResultType<
  ReturnType<typeof getNotificationDataQuery>
>;

export interface NotificationData extends Omit<
  NotificationQueryData,
  "_type" | "createdAt" | "issuer"
> {
  createdAt: Date;
  issuer: NonNullable<NotificationQueryData["issuer"]>;
  type: NotificationQueryData["_type"];
}

export function mapNotificationData(
  notification: NotificationQueryData
): NotificationData {
  const { _type, createdAt, issuer, ...rest } = notification;
  if (!issuer) {
    throw new Error(`Notification ${notification.id} has no issuer`);
  }
  return {
    ...rest,
    createdAt: fromPrismaDateTime(createdAt),
    issuer,
    type: _type,
  };
}

export interface NotificationsPage {
  nextCursor: string | null;
  notifications: NotificationData[];
}

export interface FollowerInfo {
  followers: number;
  isFollowedByUser: boolean;
}

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

export function getMessageConversationDataQuery(orm: PrismaOrm) {
  return orm.public.MessageConversations.include(
    "messageConversationKeys"
  ).include("messageConversationMembers", (members) =>
    members.include("user", (user) =>
      user
        .select("avatarUrl", "badge", "badges", "displayName", "id", "username")
        .include("communityMembers", (memberships) =>
          memberships
            .where((member) =>
              and(
                member.status.eq("ACTIVE"),
                member.role.in(["OWNER", "MODERATOR", "MEMBER"])
              )
            )
            .select("role")
            .include("community", (community) =>
              community.select("accentColor", "avatarUrl", "name", "slug")
            )
        )
        .include("messageIdentities", (identity) =>
          identity.select("publicKey")
        )
    )
  );
}

export type MessageConversationData = ResultType<
  ReturnType<typeof getMessageConversationDataQuery>
>;

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

export function getMessageDataQuery(orm: PrismaOrm) {
  return orm.public.Messages.include("sender", (sender) =>
    sender.select(
      "avatarUrl",
      "badge",
      "badges",
      "displayName",
      "id",
      "username"
    )
  );
}

export type MessageData = ResultType<ReturnType<typeof getMessageDataQuery>>;

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

export function getMentionDataQuery(orm: PrismaOrm) {
  return orm.public.Mentions.include("user", (user) =>
    user.select("avatarUrl", "displayName", "id", "username")
  );
}

export interface UnfollowUserDialogProps {
  handleUnfollow: (userId: string) => void;
  onClose: () => void;
  open: boolean;
  user: UserData;
}
