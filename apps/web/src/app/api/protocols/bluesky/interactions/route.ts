import {
  externalComments,
  externalResponses,
  externalLibrary,
  externalPostStates,
  findExternalPost,
  mutateExternalPost,
  refreshExternalPost,
  ExternalInteractionError,
} from "@asm/db";
import {
  externalMutationSchema,
  externalUriSchema,
} from "@asm/protocols/discovery";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { consumeExternalCreationBudget } from "@/lib/protocols/budget";
import {
  consumeProtocolBudget,
  ProtocolGatewayError,
  protocolJsonBody,
  protocolRoute,
} from "@/lib/protocols/gateway";
import { readBlueskyPosts } from "@/lib/protocols/service";

const commentCursor = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
const libraryCursor = z.object({
  externalPostId: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.iso.datetime(),
});

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
      return Response.json({
        comments: await externalComments(uri.data, parsed?.data),
      });
    }
    const [posts, comments, retained] = await Promise.all([
      readCurrent([uri.data], request, requestId),
      externalComments(uri.data, parsed?.data),
      findExternalPost(uri.data),
    ]);
    const post = posts.posts.find((entry) => entry.id === uri.data) ?? null;
    if (retained && posts.verified) {
      await refreshExternalPost(uri.data, post);
    }
    const states = await externalPostStates([uri.data], viewer);
    return Response.json({
      comments,
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
      return Response.json(
        await mutateExternalPost({ ...input, post, userId: session.user.id })
      );
    } catch (error) {
      if (error instanceof ExternalInteractionError) {
        throw new ProtocolGatewayError(error.status, error.code);
      }
      throw error;
    }
  });
}
