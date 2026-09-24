import type { UserData } from "@asm/db";

export type MediaType = "AUDIO" | "DOCUMENT" | "IMAGE" | "VIDEO";

type UserWithCounts = UserData & {
  _count?: {
    followers: number;
    following: number;
    posts: number;
  };
};

export function getUserCount(
  user: UserData,
  key: "followers" | "following"
): number {
  return (user as UserWithCounts)._count?.[key] ?? 0;
}

export function getUserPostCount(user: UserData): number {
  return (user as UserWithCounts)._count?.posts ?? 0;
}

export interface Media {
  aiGenerated?: boolean | null;
  altText?: string | null;
  generatedAltText?: string | null;
  hasHls?: boolean;
  height?: number | null;
  id: string;
  key?: string;
  mimeType?: string;
  postId?: string | null;
  thumbnailKey?: string | null;
  transcript?: string | null;
  type: MediaType;
  width?: number | null;
  _type?: MediaType;
}

export interface Tag {
  createdAt: Date;
  id: string;
  name: string;
  updatedAt: Date;
}
