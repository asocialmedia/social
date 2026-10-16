import type {
  ComposerDraft,
  ComposerMode,
  HnShareDraft,
} from "../state/composer-store";

export type ComposerContext =
  | { kind: "global" | "reply" }
  | { kind: "hn"; story: HnShareDraft }
  | { kind: "community"; community: { id: string; slug: string } }
  | { kind: "share"; source: NonNullable<ComposerDraft["communityShare"]> };

function hnCaption(story: HnShareDraft): string {
  return `Sharing: "${story.title}"`;
}

export function removeHnStory(draft: ComposerDraft): ComposerDraft {
  return {
    ...draft,
    hnStory: undefined,
    text:
      draft.hnStory && draft.text === hnCaption(draft.hnStory)
        ? ""
        : draft.text,
  };
}

export function draftWithContext(
  draft: ComposerDraft,
  context: ComposerContext
): ComposerDraft {
  const cleared = {
    ...removeHnStory(draft),
    communityId: undefined,
    communityShare: undefined,
    communitySharePostId: undefined,
    communitySlug: undefined,
    hnStory: undefined,
  };
  switch (context.kind) {
    case "community": {
      return {
        ...cleared,
        communityId: context.community.id,
        communitySlug: context.community.slug,
      };
    }
    case "share": {
      return {
        ...cleared,
        communityShare: context.source,
        communitySharePostId: context.source.sourcePostId,
      };
    }
    case "hn": {
      return {
        ...cleared,
        hnStory: context.story,
        text: cleared.text.trim() ? cleared.text : hnCaption(context.story),
      };
    }
    default: {
      return cleared;
    }
  }
}

export function hasFleetContent(
  draft: ComposerDraft,
  mediaCount: number
): boolean {
  return Boolean(
    draft.text.trim() ||
    mediaCount > 0 ||
    draft.hnStory ||
    draft.communitySharePostId
  );
}

export function draftForComposerOpen(
  draft: ComposerDraft,
  mode: ComposerMode,
  replying: boolean
): ComposerDraft {
  if (replying || mode === "gust") {
    return draftWithContext(draft, { kind: replying ? "reply" : "global" });
  }
  return draftWithContext(
    draft,
    draft.hnStory ? { kind: "hn", story: draft.hnStory } : { kind: "global" }
  );
}

export function composerPublishContext(draft: ComposerDraft, replyId?: string) {
  return {
    communityId:
      replyId || draft.communitySharePostId ? undefined : draft.communityId,
    communitySharePostId: replyId ? undefined : draft.communitySharePostId,
    hnStory: replyId ? undefined : draft.hnStory,
    parentPostId: replyId,
  };
}
