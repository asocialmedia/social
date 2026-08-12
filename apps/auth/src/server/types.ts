export interface User {
  aura: number;
  avatarUrl: string | null;
  banned: boolean;
  bio: string | null;
  bookmarks: number;
  createdAt: string;
  displayName: string;
  displayUsername: string | null;
  email: string | null;
  emailVerified: boolean;
  followers: number;
  following: number;
  id: string;
  joinedDate: string;
  posts: number;
  role: "user" | "admin";
  sessions: number;
  updatedAt: string;
  username: string;
}
