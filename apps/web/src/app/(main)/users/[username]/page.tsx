import { getUserDataSelect, prisma } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/use-user-data";
import { absoluteUrl, excerpt, toAbsoluteUrl } from "@/lib/seo";
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

  return user;
});

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const { username } = params;
  const session = await getSessionFromApi();
  const user = await getUser(username, session?.user?.id ?? "");

  const title = `${user.displayName} (@${user.username})`;
  const description = user.bio?.trim()
    ? excerpt(user.bio, 160)
    : `${user.displayName} (@${user.username}) on Asocialmedia — join the conversation, read their eddies, and follow along.`;
  const url = absoluteUrl(`/users/${user.username}`);
  const avatar = toAbsoluteUrl(user.avatarUrl);

  return {
    alternates: { canonical: `/users/${user.username}` },
    description,
    openGraph: {
      description,
      images: avatar
        ? [{ alt: title, url: avatar }]
        : [
            {
              alt: siteConfig.name,
              height: 630,
              url: siteConfig.ogImage,
              width: 1200,
            },
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
      card: "summary",
      description,
      images: avatar ? [avatar] : [siteConfig.ogImage],
      title,
    },
  };
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const { username } = params;
  const session = await getSessionFromApi();

  const [userData, loggedInUserData] = await Promise.all([
    getUser(username, session?.user?.id ?? ""),
    session?.user ? getUserData(session.user.id) : Promise.resolve(null),
  ]);

  if (session?.user && !loggedInUserData) {
    notFound();
  }

  const profileUrl = absoluteUrl(`/users/${userData.username}`);
  const avatar = toAbsoluteUrl(userData.avatarUrl);

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

  return (
    <>
      <JsonLd data={profileJsonLd} />
      <ClientProfile loggedInUserData={loggedInUserData} userData={userData} />
    </>
  );
}
