export interface UserListMutual {
  avatarUrl: string | null;
  displayName: string | null;
  id: string;
  username: string;
}

export interface ProfileUserListData {
  _count: { followers: number };
  avatarUrl: string | null;
  bio: string | null;
  displayName: string | null;
  id: string;
  isFollowing: boolean;
  mutualCount: number;
  mutualFollowers: UserListMutual[];
  username: string;
}
