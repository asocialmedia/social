import {
  externalComments,
  externalResponses,
  externalLibrary,
  externalPostStates,
  findExternalPost,
  mutateExternalPost,
  refreshExternalPost,
  ExternalInteractionError,
  prisma,
} from "@asm/db";
import type { PostData } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  externalMutationSchema,
  externalUriSchema,
} from "@asm/protocols/discovery";
import type { ExternalComment } from "@asm/protocols/discovery";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { consumeExternalCreationBudget } from "@/lib/protocols/budget";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolJsonBody,
  protocolRoute,
} from "@/lib/protocols/gateway";
import { readBlueskyPosts, readBlueskyThread } from "@/lib/protocols/service";

const commentCursor = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
const libraryCursor = z.object({
  externalPostId: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.iso.datetime(),
});

function mapBlueskyReplies(
  replies: ExternalPost[],
  rootUri: string
): ExternalComment[] {
  return replies.map((reply) => ({
    content: reply.text,
    createdAt: reply.createdAt,
    deleted: false,
    id: reply.id,
    parentId: reply.replyTo === rootUri ? null : (reply.replyTo ?? null),
    rootId: rootUri,
    source: "bluesky",
    uri: reply.id,
    user: {
      avatarUrl: reply.author.avatarUrl ?? null,
      displayName: reply.author.displayName || reply.author.handle,
      handle: reply.author.handle,
      id: reply.author.id,
      username: reply.author.handle,
    },
    userId: reply.author.id,
  }));
}

function mapLocalComments(
  items: {
    content: string;
    createdAt: string;
    deleted: boolean;
    id: string;
    user: {
      avatarUrl: string | null;
      displayName: string;
      id: string;
      username: string;
    } | null;
    userId: string;
  }[]
): ExternalComment[] {
  return items.map((comment) => ({
    content: comment.content,
    createdAt: comment.createdAt,
    deleted: comment.deleted,
    id: comment.id,
    parentId: null,
    rootId: null,
    source: "asm",
    user: {
      avatarUrl: comment.user?.avatarUrl ?? null,
      displayName:
        comment.user?.displayName || comment.user?.username || "Deleted User",
      id: comment.user?.id ?? comment.userId,
      username: comment.user?.username || "deleted",
    },
    userId: comment.userId,
  }));
}

function mapResponsePosts(posts: PostData[]): ExternalComment[] {
  return posts.map((post) => ({
    content: post.content,
    createdAt: post.createdAt.toISOString(),
    deleted: false,
    id: post.id,
    parentId: null,
    rootId: null,
    source: "asm",
    user: {
      avatarUrl: post.user?.avatarUrl ?? null,
      displayName: post.user?.displayName || post.user?.username || "Unknown",
      id: post.user?.id ?? post.userId,
      username: post.user?.username || "unknown",
    },
    userId: post.userId,
  }));
}

async function readCurrent(uris: string[], request: Request, id: string) {
  try {
    return {
      posts: uris.length
        ? await readBlueskyPosts(uris, request.signal, id)
        : [],
      verified: true,
    };
  } catch (error) {
    if (request.signal.aborted) {
      throw error;
    }
    return { posts: [], verified: false };
  }
}

export function GET(request: Request) {
  return protocolRoute(request, "discovery", async (requestId) => {
    const query = new URL(request.url).searchParams;
    const session = await getSessionFromApi();
    const viewer = session?.user.id ?? "";
    if (viewer) {
      await consumeProtocolBudget(viewer, "read", true);
    }
    const kind = query.get("kind");
    const rawCursor = query.get("cursor");
    let cursor: unknown;
    if (rawCursor) {
      if (rawCursor.length > 512) {
        throw new ProtocolGatewayError(400, "invalid_cursor");
      }
      try {
        cursor = JSON.parse(rawCursor);
      } catch {
        throw new ProtocolGatewayError(400, "invalid_cursor");
      }
    }
    if (kind === "bookmarks" || kind === "amplified") {
      if (!viewer) {
        throw new ProtocolGatewayError(401, "sign_in_required");
      }
      const parsed = cursor ? libraryCursor.safeParse(cursor) : undefined;
      if (parsed && !parsed.success) {
        throw new ProtocolGatewayError(400, "invalid_cursor");
      }
      const page = await externalLibrary(viewer, kind, parsed?.data);
      const source = await readCurrent(
        page.items.map((item) => item.uri),
        request,
        requestId
      );
      const current = source.posts;
      if (!source.verified) {
        throw new ProtocolGatewayError(503, "source_read_failed");
      }
      const byUri = new Map(current.map((post) => [post.id, post]));
      if (source.verified) {
        await Promise.all(
          page.items.map((item) =>
            refreshExternalPost(item.uri, byUri.get(item.uri) ?? null)
          )
        );
      }
      const states = await externalPostStates(
        current.map((post) => post.id),
        viewer
      );
      return Response.json({
        cursor: page.cursor,
        items: page.items.map((item) => ({
          post: byUri.has(item.uri)
            ? { ...byUri.get(item.uri), asm: states.get(item.uri) }
            : null,
          uri: item.uri,
        })),
      });
    }
    const uri = externalUriSchema.safeParse(query.get("uri"));
    const parsed = cursor ? commentCursor.safeParse(cursor) : undefined;
    if (!uri.success || (parsed && !parsed.success)) {
      throw new ProtocolGatewayError(400, "invalid_query");
    }
    if (kind === "responses") {
      return Response.json(
        await externalResponses(uri.data, viewer, parsed?.data)
      );
    }
    if (kind === "comments") {
      const local = await externalComments(uri.data, parsed?.data);
      let bskyReplies: ExternalPost[] = [];
      let asmResponses: PostData[] = [];
      if (!parsed?.data) {
        const [threadResult, responsesResult] = await Promise.allSettled([
          readBlueskyThread(uri.data, 3, request.signal, requestId),
          externalResponses(uri.data, viewer),
        ]);
        if (threadResult.status === "fulfilled") {
          bskyReplies = threadResult.value.replies;
        } else if (request.signal.aborted) {
          throw threadResult.reason;
        }
        if (responsesResult.status === "fulfilled") {
          asmResponses = responsesResult.value.items;
        }
      }
      return Response.json({
        comments: {
          cursor: local.cursor,
          items: [
            ...mapBlueskyReplies(bskyReplies, uri.data),
            ...mapLocalComments(local.items),
            ...mapResponsePosts(asmResponses),
          ],
        },
      });
    }
    const [posts, local, retained, thread, responsesResult] = await Promise.all(
      [
        readCurrent([uri.data], request, requestId),
        externalComments(uri.data, parsed?.data),
        findExternalPost(uri.data),
        readBlueskyThread(uri.data, 3, request.signal, requestId).catch(
          (error) => {
            if (request.signal.aborted) {
              throw error;
            }
            return null;
          }
        ),
        parsed?.data
          ? Promise.resolve({ items: [] as PostData[] })
          : externalResponses(uri.data, viewer).catch(() => ({
              items: [] as PostData[],
            })),
      ]
    );
    if (!posts.verified) {
      throw new ProtocolGatewayError(503, "source_read_failed");
    }
    let post =
      posts.posts.find((entry) => entry.id === uri.data) ??
      thread?.post ??
      null;
    if (post && thread?.post) {
      post = {
        ...post,
        upstreamCounts: thread.post.upstreamCounts,
      };
    }
    if (retained && posts.verified) {
      await refreshExternalPost(uri.data, post);
    }
    const states = await externalPostStates([uri.data], viewer);
    const bskyComments = thread
      ? mapBlueskyReplies(thread.replies, uri.data)
      : [];
    const localComments = mapLocalComments(local.items);
    return Response.json({
      comments: {
        cursor: local.cursor,
        items: [
          ...bskyComments,
          ...localComments,
          ...mapResponsePosts(responsesResult.items),
        ],
      },
      post: post ? { ...post, asm: states.get(uri.data) } : null,
    });
  });
}

export function POST(request: Request) {
  return protocolRoute(request, "feedback", async (requestId) => {
    const session = await getSessionFromApi();
    if (!session?.user.id) {
      throw new ProtocolGatewayError(401, "sign_in_required");
    }
    await consumeProtocolBudget(session.user.id, "feedback", true);
    const parsed = externalMutationSchema.safeParse(
      await protocolJsonBody(request, 8192)
    );
    if (!parsed.success) {
      throw new ProtocolGatewayError(400, "invalid_interaction");
    }
    const input = parsed.data;
    const needsPost =
      input.action === "comment" ||
      ((input.action === "amplify" || input.action === "bookmark") &&
        input.active);
    if (needsPost) {
      await consumeExternalCreationBudget(session.user.id);
    }
    const posts = needsPost
      ? await readBlueskyPosts([input.uri], request.signal, requestId)
      : [];
    const post = posts.find((entry) => entry.id === input.uri);
    if (needsPost && !post) {
      if (await findExternalPost(input.uri)) {
        await refreshExternalPost(input.uri, null);
      }
      throw new ProtocolGatewayError(410, "source_unavailable");
    }
    try {
      const result = await mutateExternalPost({
        ...input,
        post,
        userId: session.user.id,
      });

      if (
        post &&
        (input.action === "comment" ||
          (input.action === "amplify" && input.active))
      ) {
        void (async () => {
          try {
            const blueskyAccount = await prisma.orm.public.Accounts.where({
              providerId: "bluesky",
              userId: session.user.id,
            }).first();

            if (blueskyAccount?.password || blueskyAccount?.accessToken) {
              const {
                createBlueskySession,
                publishBlueskyLike,
                publishBlueskyReply,
              } = await import("@asm/protocols/bluesky");

              let token = blueskyAccount.accessToken;
              if (!token && blueskyAccount.password) {
                const refreshed = await createBlueskySession({
                  identifier: blueskyAccount.accountId,
                  password: blueskyAccount.password,
                });
                token = refreshed.accessJwt;
              }

              if (token) {
                if (input.action === "comment" && input.content) {
                  const rootUri = post.id;
                  const rootCid = post.revision;
                  await publishBlueskyReply(
                    { accessJwt: token, did: blueskyAccount.accountId },
                    {
                      parentCid: rootCid,
                      parentUri: rootUri,
                      rootCid,
                      rootUri,
                      text: input.content,
                    }
                  );
                } else if (input.action === "amplify" && post.revision) {
                  await publishBlueskyLike(
                    { accessJwt: token, did: blueskyAccount.accountId },
                    { cid: post.revision, uri: post.id }
                  );
                }
              }
            }
          } catch {
            // Background ATProto cross-posting failure should never fail the local interaction
          }
        })();
      }

      return Response.json(result);
    } catch (error) {
      if (error instanceof ExternalInteractionError) {
        throw new ProtocolGatewayError(error.status, error.code);
      }
      throw error;
    }
  });
}
