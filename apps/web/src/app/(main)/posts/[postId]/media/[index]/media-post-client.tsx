"use client";

import type { PostData, UserData } from "@asm/db";
import ClientPost from "../../client-post";

interface MediaPostClientProps {
  initialIndex: number;
  post: PostData;
  userData: UserData;
}

// Thin client wrapper so the server component can pass the requested media
// index down to the post card, which opens the viewer at that index.
const MediaPostClient: React.FC<MediaPostClientProps> = ({
  initialIndex,
  post,
  userData,
}) => (
  <ClientPost
    initialMediaIndex={initialIndex}
    post={post}
    userData={userData}
  />
);

export default MediaPostClient;
