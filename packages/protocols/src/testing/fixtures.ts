export const authorDid = "did:plc:z72i7hdynmk6r22z27h6tvur";
export const profileFixture = {
  avatar: "https://cdn.bsky.app/img/avatar/plain/example.jpeg",
  description: "Public profile",
  did: authorDid,
  displayName: "Bluesky",
  followersCount: 12,
  followsCount: 2,
  handle: "bsky.app",
  postsCount: 5,
};
export const postFixture = {
  author: profileFixture,
  cid: "bafyreibfn4d6xedoe6jixkcl266v2fhiwga2x3zzsnq6yawnago2kb5ouu",
  indexedAt: "2026-10-16T10:00:01.000Z",
  likeCount: 8,
  record: {
    $type: "app.bsky.feed.post",
    createdAt: "2026-10-16T10:00:00.000Z",
    text: "Hello world",
  },
  uri: `at://${authorDid}/app.bsky.feed.post/example`,
};
export const eventFixture = {
  commit: {
    cid: "bafyreibfn4d6xedoe6jixkcl266v2fhiwga2x3zzsnq6yawnago2kb5ouu",
    collection: "app.bsky.feed.post",
    operation: "create",
    record: postFixture.record,
    rev: "3m23jhl2dbk2a",
    rkey: "example",
  },
  did: authorDid,
  kind: "commit",
  seq: 101,
  time: "2026-10-16T10:00:00.000Z",
};
