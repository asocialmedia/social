import type { UserData } from "@asm/db";

export type MediaType = "AUDIO" | "DOCUMENT" | "IMAGE" | "VIDEO";

export function getUserCount(
  user: UserData,
  key: "followers" | "following"
): number {
  return user._count?.[key] ?? 0;
}

export function getUserPostCount(user: UserData): number {
  return user._count?.posts ?? 0;
}

export interface Media {
  attributionPublic?: boolean;
  aiGenerated?: boolean | null;
  altText?: string | null;
  generatedAltText?: string | null;
  originalProvenanceId?: string | null;
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
