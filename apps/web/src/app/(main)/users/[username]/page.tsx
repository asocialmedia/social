import { getUserDataSelect, prisma, SYSTEM_MODERATION_USER_ID } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import ProfileSkeleton from "@/components/layouts/skeletons/profile-skeleton";
import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/use-user-data";
import { absoluteUrl, excerpt } from "@/lib/seo";
import { getUserPostsForCrawl } from "@/lib/server-feed";
import { getSessionFromApi } from "@/lib/session";

import ClientProfile from "./client-profile";

interface PageProps {
  params: Promise<{ username: string }>;
}

const getUser = cache(async (username: string, loggedInUserId: string) => {
  const user = await prisma.user.findFirst({
    select: getUserDataSelect(loggedInUserId),
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
  });

  if (!user) {
    notFound();
  }

  // The system moderation persona has no public profile.
  if (user.id === SYSTEM_MODERATION_USER_ID) {
    notFound();
  }

  return user;
});

// Metadata never varies by viewer, so it reads through a cached scope instead
// of touching the session's connection() - keeping generateMetadata
// prerenderable instead of blocking the route's metadata on request data.
async function getMetadataUser(username: string) {
  "use cache";
  cacheLife("hours");

  const user = await prisma.user.findFirst({
    select: getUserDataSelect(""),
    where: {
      username: {
        equals: username,
        mode: "insensitive",
      },
    },
  });

  if (!user || user.id === SYSTEM_MODERATION_USER_ID) {
    return null;
  }
  return user;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const { username } = params;
  const user = await getMetadataUser(username);

  if (!user) {
    return { robots: { follow: false, index: false }, title: "User not found" };
  }

  const title = `${user.displayName} (@${user.username})`;
  const bio = user.bio?.trim();
  const description =
    bio && bio.length >= 25
      ? excerpt(bio, 160)
      : `${user.displayName || user.username} (@${user.username}) on asocialmedia — ${bio ? `${bio}. ` : ""}Join the conversation, read their eddies, and follow along.`;
  const url = absoluteUrl(`/users/${user.username}`);
  // Avatar is streamed through the app proxy (buckets are private).
  const avatar = user.avatarUrl
    ? absoluteUrl(`/api/users/avatar/${user.id}/image`)
    : null;

  const ogImageUrl = absoluteUrl(`/users/${user.username}/opengraph-image`);

  return {
    alternates: { canonical: `/users/${user.username}` },
    description,
    openGraph: {
      description,
      images: [
        {
          alt: title,
          height: 630,
          url: ogImageUrl,
          width: 1200,
        },
        ...(avatar ? [{ alt: title, url: avatar }] : []),
      ],
      locale: siteConfig.locale,
      siteName: siteConfig.name,
      title,
      type: "profile",
      url,
      username: user.username,
    },
    title,
    twitter: {
      card: "summary_large_image",
      creator: `@${user.username}`,
      description,
      images: [ogImageUrl],
      title,
    },
  };
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileContent params={props.params} />
    </Suspense>
  );
}

async function ProfileContent({ params }: PageProps) {
  const { username } = await params;
  const session = await getSessionFromApi();

  const [userData, loggedInUserData] = await Promise.all([
    getUser(username, session?.user?.id ?? ""),
    session?.user ? getUserData(session.user.id) : Promise.resolve(null),
  ]);

  if (session?.user && !loggedInUserData) {
    notFound();
  }

  const profileUrl = absoluteUrl(`/users/${userData.username}`);
  // Avatar is streamed through the app proxy (buckets are private).
  const avatar = userData.avatarUrl
    ? absoluteUrl(`/api/users/avatar/${userData.id}/image`)
    : null;

  const profileJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    dateCreated: userData.createdAt.toISOString(),
    inLanguage: "en",
    mainEntity: {
      "@type": "Person",
      alternateName: `@${userData.username}`,
      description: userData.bio ?? undefined,
      image: avatar ?? undefined,
      name: userData.displayName,
      url: profileUrl,
    },
    url: profileUrl,
  };

  // Crawlable recent posts from this user - visible in SSR HTML so
  // profile pages link to post URLs without JS.
  const recentPosts = await getUserPostsForCrawl(userData.id, 12);

  const itemListJsonLd =
    recentPosts.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: recentPosts.map((post, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${siteConfig.url}/posts/${post.id}`,
          })),
          name: `Posts by @${userData.username}`,
        }
      : null;

  return (
    <>
      <JsonLd
        data={itemListJsonLd ? [profileJsonLd, itemListJsonLd] : profileJsonLd}
      />
      <ClientProfile loggedInUserData={loggedInUserData} userData={userData} />
      {/* Hidden fallback list for bots - no visible block */}
      <div className="sr-only" aria-hidden={false}>
        <nav aria-label={`Posts by @${userData.username} crawlable`}>
          <ul>
            {recentPosts.map((p) => (
              <li key={p.id}>
                <a href={`/posts/${p.id}`} tabIndex={-1}>
                  {p.content || p.id}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
