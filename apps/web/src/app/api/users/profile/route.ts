import { updateUserProfileSchema } from "@asm/auth/validation";
import { getPrivateUserSelect, prisma } from "@asm/db";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getSessionFromApi } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const session = await getSessionFromApi();
    const user = session?.user;
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Identity always comes from the session. The legacy client still appends
    // a userId form field; it is ignored so a crafted value can never target
    // another account.
    const userId = user.id;

    const formData = await request.formData();
    const rawValues = formData.get("values");
    const avatar = formData.get("avatar");

    // Binary uploads are pipeline-only: the profile edit form's avatar goes
    // through /api/upload/initiate -> presigned PUT -> scan -> /api/users/avatar.
    // A raw multipart file here would bypass quarantine, antivirus, metadata
    // stripping, quota and rate limits, so it is refused outright.
    if (avatar instanceof File && avatar.size > 0) {
      return Response.json(
        {
          error:
            "Avatar files must be uploaded through the media pipeline (/api/upload/initiate + /api/users/avatar)",
        },
        { status: 415 }
      );
    }

    let parsedValues: ReturnType<typeof updateUserProfileSchema.parse>;
    try {
      parsedValues = updateUserProfileSchema.parse(
        JSON.parse((rawValues as string) ?? "{}")
      );
    } catch {
      return Response.json(
        { error: "Invalid profile values" },
        { status: 400 }
      );
    }

    const updatedUser = await prisma.user.update({
      data: {
        bio: parsedValues.bio,
        customDomain: parsedValues.customDomain || null,
        displayName: parsedValues.displayName,
        githubUsername: parsedValues.githubUsername || null,
        linkedinUsername: parsedValues.linkedinUsername || null,
        redditUsername: parsedValues.redditUsername || null,
        twitterUsername: parsedValues.twitterUsername || null,
      },
      select: getPrivateUserSelect(userId),
      where: { id: userId },
    });

    // Avatar updates never happen here: profile edits change text fields only,
    // and avatar files flow through the media pipeline's own link route.
    return NextResponse.json({
      avatar: null,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid profile values", issues: error.issues },
        { status: 400 }
      );
    }
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
