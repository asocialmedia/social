// The network and result-kind filters the spotlight searches with. Kept in a
// React Native free module so the pure search helpers can share them.
export type SearchSource = "all" | "asm" | "bluesky";
export type SearchKind = "all" | "user" | "post" | "community";
