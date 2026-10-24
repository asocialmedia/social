import type { ExternalAuthor, ExternalPost } from "@asm/protocols/contracts";

const posts = new Map<string, ExternalPost>();
const authors = new Map<string, ExternalAuthor>();
export function rememberExternalPost(post: ExternalPost, viewer: string) {
  posts.set(`${viewer}:${post.id}`, post);
  authors.set(post.author.id, post.author);
  if (posts.size > 300) {
    posts.delete(posts.keys().next().value ?? "");
  }
  if (authors.size > 300) {
    authors.delete(authors.keys().next().value ?? "");
  }
}
export const cachedExternalPost = (uri: string, viewer: string) =>
  posts.get(`${viewer}:${uri}`);
export const cachedExternalAuthor = (actor: string) =>
  authors.get(actor) ??
  [...authors.values()].find((author) => author.handle === actor);
