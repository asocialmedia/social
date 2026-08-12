import { getPostDataInclude, type PostData, prisma } from "@asm/db";
import { getSessionFromApi } from "@/lib/session";
import { suggestedUsersCache } from "@/lib/suggested-users-cache";

interface VoteInfo {
  aura: number;
  userVote: number;
}

const VALID_VOTE_VALUES = [-1, 0, 1];

export async function GET(
  _req: Request,
  props: { params: Promise<{ postId: string }> }
) {
  const params = await props.params;
  const { postId } = params;

  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: getPostDataInclude(user.id),
    });

    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    const voteInfo: VoteInfo = {
      aura: post.aura,
      userVote: post.vote[0]?.value || 0,
    };

    const postData: PostData & VoteInfo = {
      ...post,
      ...voteInfo,
    };

    return Response.json(postData);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { value } = (await request.json()) as { value?: number };
  if (typeof value !== "number" || !VALID_VOTE_VALUES.includes(value)) {
    return Response.json({ error: "Invalid vote value" }, { status: 400 });
  }

  let auraChanged = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { id: true, userId: true },
      });
      if (!post) {
        return null;
      }

      const existingVote = await tx.vote.findUnique({
        where: { userId_postId: { userId: user.id, postId } },
      });
      const oldValue = existingVote?.value || 0;

      if (value === 0) {
        if (existingVote) {
          await tx.vote.delete({
            where: { userId_postId: { userId: user.id, postId } },
          });
        }
      } else {
        await tx.vote.upsert({
          where: { userId_postId: { userId: user.id, postId } },
          create: { userId: user.id, postId, value },
          update: { value },
        });
      }

      // Aura follows the vote score: amplifying (+1) credits aura, muting (-1)
      // or removing a vote debits it. Self-votes are recorded but never award
      // aura, to prevent users from farming reputation on their own posts.
      const isSelfVote = post.userId === user.id;
      const auraDelta = isSelfVote ? 0 : value - oldValue;
      if (auraDelta !== 0) {
        auraChanged = true;
        await Promise.all([
          tx.post.update({
            where: { id: postId },
            data: { aura: { increment: auraDelta } },
          }),
          tx.user.update({
            where: { id: post.userId },
            data: { aura: { increment: auraDelta } },
          }),
        ]);

        await tx.auraLog.create({
          data: {
            userId: post.userId,
            issuerId: user.id,
            amount: auraDelta,
            type: auraDelta > 0 ? "POST_VOTE" : "POST_VOTE_REMOVED",
            postId,
          },
        });
      }

      if (!isSelfVote) {
        if (value === 1 && oldValue !== 1) {
          await tx.notification.create({
            data: {
              type: "AMPLIFY",
              recipientId: post.userId,
              issuerId: user.id,
              postId,
            },
          });
        } else if (value !== 1 && oldValue === 1) {
          await tx.notification.deleteMany({
            where: {
              type: "AMPLIFY",
              recipientId: post.userId,
              issuerId: user.id,
              postId,
            },
          });
        }
      }

      return await tx.post.findUnique({
        where: { id: postId },
        include: getPostDataInclude(user.id),
      });
    });

    if (!result) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (auraChanged) {
      await suggestedUsersCache.invalidateForUser(result.userId);
    }

    const voteInfo: VoteInfo = {
      aura: result.aura,
      userVote: result.vote[0]?.value || 0,
    };

    return Response.json(voteInfo);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let auraChanged = false;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const post = await tx.post.findUnique({
        where: { id: postId },
        select: { id: true, userId: true },
      });
      if (!post) {
        return null;
      }

      const existingVote = await tx.vote.findUnique({
        where: { userId_postId: { userId: user.id, postId } },
      });
      const oldValue = existingVote?.value || 0;

      if (existingVote) {
        await tx.vote.delete({
          where: { userId_postId: { userId: user.id, postId } },
        });
      }

      // Self-votes were never awarded aura, so they should not reverse any.
      const isSelfVote = post.userId === user.id;
      if (oldValue !== 0 && !isSelfVote) {
        auraChanged = true;
        await Promise.all([
          tx.post.update({
            where: { id: postId },
            data: { aura: { decrement: oldValue } },
          }),
          tx.user.update({
            where: { id: post.userId },
            data: { aura: { decrement: oldValue } },
          }),
        ]);

        await tx.auraLog.create({
          data: {
            userId: post.userId,
            issuerId: user.id,
            amount: -oldValue,
            type: "POST_VOTE_REMOVED",
            postId,
          },
        });
      }

      if (oldValue === 1 && !isSelfVote) {
        await tx.notification.deleteMany({
          where: {
            type: "AMPLIFY",
            recipientId: post.userId,
            issuerId: user.id,
            postId,
          },
        });
      }

      return await tx.post.findUnique({
        where: { id: postId },
        include: getPostDataInclude(user.id),
      });
    });

    if (!result) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    if (auraChanged) {
      await suggestedUsersCache.invalidateForUser(result.userId);
    }

    const voteInfo: VoteInfo = {
      aura: result.aura,
      userVote: 0,
    };

    return Response.json(voteInfo);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
