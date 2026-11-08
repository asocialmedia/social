import type { ExternalPost } from "@asm/protocols/contracts";
import { siteConfig } from "@asm/ui/meta/site";
import type { Metadata } from "next";

import { excerpt } from "./seo";

export function blueskyPostPath(uri: string) {
  return `/network/bluesky?${new URLSearchParams({ uri })}`;
}

export function blueskyPostMetadata(post: ExternalPost): Metadata {
  const title = `${post.author.displayName || post.author.handle}: ${excerpt(post.text || "Bluesky post", 60)}`;
  const description = excerpt(
    post.text ||
      `A post by @${post.author.handle} on Bluesky. Read it on asocialmedia.`
  );
  const url = `${siteConfig.url}${blueskyPostPath(post.id)}`;
  const [image] = post.media;
  const imageUrl = image?.type === "video" ? image.thumbnailUrl : image?.url;
  const images = imageUrl
    ? [{ alt: image?.alt || description, url: imageUrl }]
    : [siteConfig.ogImage];
  return {
    alternates: { canonical: url },
    description,
    openGraph: {
      authors: [post.author.url],
      description,
      images,
      publishedTime: post.createdAt,
      siteName: siteConfig.name,
      title,
      type: "article",
      url,
    },
    robots: { follow: true, index: true },
    title,
    twitter: { card: "summary_large_image", description, images, title },
  };
}

export function blueskyPostJsonLd(post: ExternalPost) {
  const url = `${siteConfig.url}${blueskyPostPath(post.id)}`;
  return {
    "@context": "https://schema.org",
    "@type": "SocialMediaPosting",
    author: {
      "@type": "Person",
      alternateName: `@${post.author.handle}`,
      name: post.author.displayName || post.author.handle,
      url: post.author.url,
    },
    datePublished: post.createdAt,
    headline: excerpt(post.text || "Bluesky post", 110),
    ...(post.text.trim() ? { text: post.text } : {}),
    image: post.media
      .filter((media) => media.type === "image")
      .map((media) => media.url),
    isBasedOn: post.url,
    mainEntityOfPage: url,
    url,
  };
}
