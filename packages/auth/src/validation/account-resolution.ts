export interface AccountResolutionProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  verified: boolean;
  protectedAccount: boolean;
  providers: string[];
  posts: number;
  comments: number;
  communities: number;
  privateHistory: boolean;
  ownsDen: boolean;
}

export interface AccountResolutionReview {
  id: string;
  kind: "oauth" | "email";
  current: AccountResolutionProfile;
  other: AccountResolutionProfile;
}
