import {
  blueskyMediaIsExplicit,
  hasRestrictedDiscoveryLabels,
  postHasExplicitMedia,
} from "./content-safety";
import type { ExternalPost } from "./contracts";
import { networkInterestScore } from "./network-interest-scope";
import { matchesAvoidedTopic } from "./network-preferences";
import type { NetworkPreferences } from "./network-preferences";
import { scopedNetworkPreferences } from "./network-topics";
import type { NetworkTopicScope } from "./network-topics";
import { externalPostTopics } from "./post-metadata";

export interface NetworkPolicyPost {
  content?: string | null;
  semanticTags?: readonly string[] | null;
  tags?: readonly { name: string }[];
  attachments?: readonly { id?: string; altText?: string | null }[];
  embeds?: unknown;
  explicitContent?: boolean | null;
  moderated?: boolean | null;
  parentPost?: NetworkPolicyPost | null;
  external?: ExternalPost;
  discoveryContext?: ExternalPost["discoveryContext"];
}
function parseStoredEmbeds(
  value: unknown
): { title?: string; description?: string }[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown =
      typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.slice(0, 100).flatMap((item: unknown) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      return [
        {
          description:
            "description" in item && typeof item.description === "string"
              ? item.description
              : undefined,
          title:
            "title" in item && typeof item.title === "string"
              ? item.title
              : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

type ContentPreferences = Pick<
  NetworkPreferences,
  "avoidedTopics" | "showExplicitContent"
>;

export function activeNetworkInterests(
  preferences: Pick<NetworkPreferences, "profiles" | "activeProfileId">
): string[] {
  return (
    preferences.profiles.find(
      (profile) => profile.id === preferences.activeProfileId
    )?.interests ?? []
  );
}

export function externalNetworkInterestScore(
  post: ExternalPost,
  interests: readonly string[],
  scope?: NetworkTopicScope
): number {
  const visited = new Set<ExternalPost>();
  let current: ExternalPost | undefined = post;
  let score = 0;
  while (current && !visited.has(current)) {
    visited.add(current);
    score = Math.max(
      score,
      networkInterestScore(
        `${current.text} ${current.externalLink?.title ?? ""} ${current.externalLink?.description ?? ""}`,
        externalPostTopics(current),
        interests,
        scope
      ) * (current === post ? 1 : 0.5),
      networkInterestScore(
        current.media.map((media) => media.alt).join(" "),
        [],
        interests,
        scope
      ) * (current === post ? 0.25 : 0.125)
    );
    current = current.quote;
  }
  return score;
}

export function postNetworkInterestScore(
  post: NetworkPolicyPost,
  interests: readonly string[],
  scope?: NetworkTopicScope
): number {
  if (post.external) {
    return externalNetworkInterestScore(post.external, interests, scope);
  }
  const embeds = parseStoredEmbeds(post.embeds);
  return networkInterestScore(
    `${post.content} ${(post.attachments ?? []).map((media) => media.altText ?? "").join(" ")} ${embeds.map((embed) => `${embed.title ?? ""} ${embed.description ?? ""}`).join(" ")}`,
    [...(post.semanticTags ?? []), ...(post.tags ?? []).map((tag) => tag.name)],
    interests,
    scope
  );
}

export function networkPostRecommended(
  post: NetworkPolicyPost,
  preferences: NetworkPreferences,
  scope?: NetworkTopicScope
): boolean {
  const interests = activeNetworkInterests(preferences);
  return (
    networkPostAllowed(post, scopedNetworkPreferences(preferences, scope)) &&
    (!interests.length ||
      matchesDiscoveryContext(post.discoveryContext, interests) ||
      postNetworkInterestScore(post, interests, scope) > 0)
  );
}

export function externalNetworkPostRecommended(
  post: ExternalPost,
  preferences: NetworkPreferences,
  interests = activeNetworkInterests(preferences),
  scope?: NetworkTopicScope
): boolean {
  if (!preferences.showExplicitContent && blueskyMediaIsExplicit(post)) {
    return false;
  }
  return (
    externalNetworkPostAllowed(
      post,
      scopedNetworkPreferences(preferences, scope)
    ) &&
    (!interests.length ||
      matchesDiscoveryContext(post.discoveryContext, interests) ||
      externalNetworkInterestScore(post, interests, scope) > 0)
  );
}

function matchesDiscoveryContext(
  context: ExternalPost["discoveryContext"],
  interests: readonly string[]
) {
  return Boolean(
    context &&
    context.level > 0 &&
    context.level <= 2 &&
    JSON.stringify(context.interests) === JSON.stringify(interests)
  );
}

export function externalNetworkPostAllowed(
  post: ExternalPost,
  preferences: ContentPreferences,
  scope?: NetworkTopicScope
): boolean {
  const policy = scopedNetworkPreferences(preferences, scope);
  const visited = new Set<ExternalPost>();
  let current: ExternalPost | undefined = post;
  while (current) {
    if (visited.has(current)) {
      return false;
    }
    visited.add(current);
    const labels = [
      ...current.labels,
      ...(current.selfLabels ?? []),
      ...current.author.labels,
    ];
    const text = `${current.text} ${current.externalLink?.title ?? ""} ${current.externalLink?.description ?? ""} ${current.media.map((media) => media.alt).join(" ")}`;
    if (
      hasRestrictedDiscoveryLabels(current) ||
      (!policy.showExplicitContent && blueskyMediaIsExplicit(current)) ||
      matchesAvoidedTopic(
        text,
        [...externalPostTopics(current), ...labels],
        policy.avoidedTopics
      )
    ) {
      return false;
    }
    current = current.quote;
  }
  return true;
}

export function networkPostAllowed(
  post: NetworkPolicyPost,
  preferences: ContentPreferences,
  scope?: NetworkTopicScope
): boolean {
  const policy = scopedNetworkPreferences(preferences, scope);
  const parent = post.parentPost;
  if (
    parent &&
    (parent.moderated ||
      (!policy.showExplicitContent &&
        (postHasExplicitMedia({
          content: parent.content,
          explicitContent: parent.explicitContent ?? false,
        }) ||
          parseStoredEmbeds(parent.embeds).some((embed) =>
            blueskyMediaIsExplicit({
              externalLink: {
                description: embed.description ?? undefined,
                title: embed.title ?? undefined,
              },
            })
          ))))
  ) {
    return false;
  }
  if (
    !policy.showExplicitContent &&
    postHasExplicitMedia({
      ...post,
      explicitContent: post.explicitContent ?? false,
    })
  ) {
    return false;
  }
  if (
    !policy.showExplicitContent &&
    blueskyMediaIsExplicit({
      media: (post.attachments ?? []).map((media) => ({
        alt: media.altText ?? "",
      })),
      tags: [
        ...(post.semanticTags ?? []),
        ...(post.tags ?? []).map((tag) => tag.name),
      ],
      text: post.content ?? undefined,
    })
  ) {
    return false;
  }
  if (
    !policy.showExplicitContent &&
    parseStoredEmbeds(post.embeds).some((embed) =>
      blueskyMediaIsExplicit({
        externalLink: {
          description: embed.description ?? undefined,
          title: embed.title ?? undefined,
        },
      })
    )
  ) {
    return false;
  }
  const { external } = post;
  if (external) {
    return externalNetworkPostAllowed(external, policy);
  }
  const text = `${post.content ?? ""} ${(post.attachments ?? []).map((media) => media.altText ?? "").join(" ")}`;
  const topics = [
    ...(post.semanticTags ?? []),
    ...(post.tags ?? []).map((tag) => tag.name),
  ];
  return !matchesAvoidedTopic(text, topics, policy.avoidedTopics);
}
