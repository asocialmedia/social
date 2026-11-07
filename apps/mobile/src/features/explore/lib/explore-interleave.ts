// Web explore-client's items memo, as a pure function. Search results weave
// a user card into every sixth slot; outside search every sixth post is
// followed by the next recommended account. Users left over once the posts
// run out are appended at the end.
export const EXPLORE_USER_INTERVAL = 6;

export type ExploreStreamItem<Post, User, Account> =
  | { kind: "post"; post: Post }
  | { kind: "user"; user: User }
  | { kind: "account"; account: Account };

export function interleaveExploreStream<Post, User, Account>(
  posts: readonly Post[],
  users: readonly User[],
  accounts: readonly Account[],
  searching: boolean
): ExploreStreamItem<Post, User, Account>[] {
  const result: ExploreStreamItem<Post, User, Account>[] = [];
  let postIndex = 0;
  let userIndex = 0;
  for (let slot = 0; postIndex < posts.length; slot += 1) {
    const user = users[userIndex];
    if (
      user !== undefined &&
      slot % EXPLORE_USER_INTERVAL === EXPLORE_USER_INTERVAL - 1
    ) {
      result.push({ kind: "user", user });
      userIndex += 1;
      continue;
    }
    const post = posts[postIndex];
    if (post !== undefined) {
      result.push({ kind: "post", post });
    }
    if (
      !searching &&
      postIndex % EXPLORE_USER_INTERVAL === EXPLORE_USER_INTERVAL - 1
    ) {
      const account = accounts[Math.floor(postIndex / EXPLORE_USER_INTERVAL)];
      if (account !== undefined) {
        result.push({ account, kind: "account" });
      }
    }
    postIndex += 1;
  }
  for (; userIndex < users.length; userIndex += 1) {
    const user = users[userIndex];
    if (user !== undefined) {
      result.push({ kind: "user", user });
    }
  }
  return result;
}
