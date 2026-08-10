import { prisma } from "@asm/db";
import Header from "@/components/layouts/header";
import { getSessionFromApi } from "@/lib/session";

export default async function Navbar() {
  const session = await getSessionFromApi();
  const user = session?.user;

  if (!user) {
    return null;
  }

  let unreadNotificationCount = 0;
  let totalBookmarkCount = 0;

  try {
    const [notifications, postBookmarks, hnBookmarks] = await Promise.all([
      prisma.notification.count({
        where: {
          recipientId: user.id,
          read: false,
        },
      }),
      prisma.bookmark.count({
        where: { userId: user.id },
      }),
      prisma.hNBookmark.count({
        where: { userId: user.id },
      }),
    ]);

    unreadNotificationCount = notifications;
    totalBookmarkCount = postBookmarks + hnBookmarks;
  } catch (error) {
    console.error("Error fetching counts:", error);
  }

  return (
    <div className="sticky top-0 z-50">
      <Header
        bookmarkCount={totalBookmarkCount}
        unreadNotificationCount={unreadNotificationCount}
      />
    </div>
  );
}
