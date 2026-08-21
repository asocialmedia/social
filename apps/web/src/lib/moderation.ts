// Shared authorization rule for post/gust moderation: the app admin or the
// author of the post itself may moderate it. Used by every surface that shows
// moderation controls so the rule can never drift between call sites.
export function canModeratePost(
  user: { id?: string; role?: string } | null | undefined,
  post: { userId: string }
): boolean {
  return Boolean(user && (user.role === "admin" || user.id === post.userId));
}
