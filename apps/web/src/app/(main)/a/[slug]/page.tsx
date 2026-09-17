import {
  getCachedCommunityStats,
  getCommunityBySlug,
  getMembership,
  getPublicUserSelect,
  prisma,
} from "@asm/db";
import type { UserData } from "@asm/db";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

import CommunityPage from "@/components/communities/community-page";
import JsonLd from "@/components/seo/json-ld";
import { getSessionFromApi } from "@/lib/auth/session";
import { absoluteUrl, excerpt } from "@/lib/seo/seo";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const getCommunity = cache(async (slug: string) => {
  const community = await getCommunityBySlug(slug);
  if (!community) {
    notFound();
  }
  return community;
});

// Metadata never varies by viewer; the public community select is enough.
async function getMetadataCommunity(slug: string) {
  "use cache";
  cacheLife("hours");
  return await getCommunityBySlug(slug);
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const community = await getMetadataCommunity(slug);

  if (!community) {
    notFound();
  }

  const title = `a/${community.slug} · ${community.name}`;
  const description = excerpt(community.description, 160);
  const url = absoluteUrl(`/a/${community.slug}`);
  const avatar = community.avatarUrl
    ? absoluteUrl(`/api/communities/avatar/${community.id}/image`)
    : null;

  return {
    alternates: { canonical: `/a/${community.slug}` },
    description,
    openGraph: {
      description,
      images: avatar ? [{ alt: title, url: avatar }] : [],
      locale: siteConfig.locale,
      siteName: siteConfig.name,
      title,
      type: "website",
      url,
    },
    title,
    twitter: {
      card: "summary",
      description,
      images: avatar ? [avatar] : [],
      title,
    },
  };
}

export default function Page(props: PageProps) {
  return (
    <Suspense>
      <CommunityContent params={props.params} />
    </Suspense>
  );
}

async function CommunityContent({ params }: PageProps) {
  const { slug } = await params;
  const session = await getSessionFromApi();
  const userId = session?.user?.id ?? "";

  const community = await getCommunity(slug);
  const [stats, membership, owner] = await Promise.all([
    getCachedCommunityStats(community.id),
    userId ? getMembership(community.id, userId) : Promise.resolve(null),
    prisma.user.findUnique({
      select: getPublicUserSelect(userId),
      where: { id: community.ownerId },
    }),
  ]);

  const communityUrl = absoluteUrl(`/a/${community.slug}`);
  const avatar = community.avatarUrl
    ? absoluteUrl(`/api/communities/avatar/${community.id}/image`)
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    dateCreated: community.createdAt.toISOString(),
    description: community.description,
    image: avatar ?? undefined,
    inLanguage: "en",
    name: community.name,
    url: communityUrl,
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <CommunityPage
        community={community}
        membership={membership}
        owner={
          owner as Pick<
            UserData,
            "avatarUrl" | "displayName" | "id" | "username"
          > | null
        }
        slug={community.slug}
        stats={stats}
      />
    </>
  );
}
