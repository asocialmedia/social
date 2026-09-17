"use client";

import { createCommunitySchema } from "@asm/auth/validation";
import { COMMUNITY_LIMITS, slugifyCommunityName } from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import { Checkbox } from "@asm/ui/shadui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { RadioGroup, RadioGroupItem } from "@asm/ui/shadui/radio-group";
import { Textarea } from "@asm/ui/shadui/textarea";
import avatarPlaceholder from "@assets/general/avatar-placeholder.png";
import { ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useCreateCommunityMutation } from "@/communities/mutations";
import CommunityAccentPicker from "@/components/communities/create/community-accent-picker";
import CommunityTopicPicker from "@/components/communities/create/community-topic-picker";
import CreateCommunityPreview from "@/components/communities/create/create-community-preview";
import {
  AvatarInput,
  BannerInput,
  pipelineStageLabel,
} from "@/components/profile/profile-media-inputs";
import { useToast } from "@/lib/gooey-toast";
import { croppedImageFile } from "@/lib/media/cropped-image-file";
import { uploadMediaFile } from "@/lib/media/media-upload-client";
import type { UploadStage } from "@/lib/media/media-upload-client";
import { cn } from "@/lib/utils";

import {
  clearCommunityDraft,
  getCommunityDraft,
  hasCommunityDraftProgress,
  saveCommunityDraft,
} from "./community-draft-store";

type CommunityType = "PUBLIC" | "RESTRICTED" | "PRIVATE";

// Module scope, not inside the hook: React Compiler cannot lower a ThrowStatement
// or a finally clause inside a hook's try block, so the pipeline call and its
// rejection check live here and report through a result union instead of
// exceptions.
async function uploadCommunityImage(
  file: File,
  kind: "avatar" | "banner",
  onProgress: (percent: number) => void,
  onStage: (stage: UploadStage) => void
): Promise<{ mediaId: string } | { error: string }> {
  try {
    const uploaded = await uploadMediaFile(file, {
      onProgress,
      onStage,
      purpose: kind,
    });
    if (uploaded.status === "REJECTED") {
      return {
        error:
          uploaded.rejectedReason === "MALWARE"
            ? "That file failed the security scan"
            : "That file was rejected",
      };
    }
    return { mediaId: uploaded.mediaId };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Couldn't upload that image",
    };
  }
}

// Short labels: the step rail shows them under the progress bars, so they read
// better as single words than as the sentence the old header used.
const STEPS = ["Topics", "Access", "Details", "Accent", "Imagery"] as const;

const TYPE_META: {
  description: string;
  label: string;
  value: CommunityType;
}[] = [
  {
    description: "Anyone can view, post, and comment",
    label: "Public",
    value: "PUBLIC",
  },
  {
    description: "Anyone can view, only approved users can post",
    label: "Restricted",
    value: "RESTRICTED",
  },
  {
    description: "Only approved users can view and post",
    label: "Private",
    value: "PRIVATE",
  },
];

// A compact segmented step rail. Just the progress bars - the bars alone carry
// the position, so there is no text caption beside them.
function StepRail({ current }: { current: number }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {STEPS.map((label, index) => {
        let barClass = "bg-muted-foreground/25 w-2.5";
        if (index === current) {
          barClass = "bg-primary w-5";
        } else if (index < current) {
          barClass = "bg-primary/50 w-2.5";
        }
        return (
          <span
            aria-hidden="true"
            className={cn(
              "h-1 rounded-full transition-all duration-300 ease-out",
              barClass
            )}
            key={label}
          />
        );
      })}
    </div>
  );
}

// A labelled form field, so the steps stay consistent.
function Field({
  children,
  hint,
  label,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-foreground text-sm font-medium">{label}</span>
      {children}
      {hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

export default function CreateCommunityDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { user } = useSession();
  const { toast } = useToast();
  const createMutation = useCreateCommunityMutation();

  // Restored once per mount through lazy initializers rather than a hydrating
  // effect (the app's comment drafts read storage the same way). Reading during
  // render is safe here because the dialog renders nothing while it is closed,
  // so the server pass and the hydrating client agree on the DOM no matter what
  // the draft holds.
  // eslint-disable-next-line react/hook-use-state -- one-time read feeding the initial state; the setter is intentionally unused
  const [draft] = useState(() => getCommunityDraft());

  const [step, setStep] = useState(draft?.step ?? 0);
  const [topics, setTopics] = useState<string[]>(draft?.topics ?? []);
  const [type, setType] = useState<CommunityType>(draft?.type ?? "PUBLIC");
  const [mature, setMature] = useState(draft?.mature ?? false);
  const [name, setName] = useState(draft?.name ?? "");
  const [slug, setSlug] = useState(draft?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(draft?.slugTouched ?? false);
  const [description, setDescription] = useState(draft?.description ?? "");
  const [accentColor, setAccentColor] = useState(draft?.accentColor ?? "slate");

  // Imagery is uploaded when chosen, so only the resulting media id needs to
  // survive a reload (a File cannot be serialized). The preview is that id's
  // proxy URL, which the owner may read while the row is still an unlinked
  // draft.
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(
    draft?.avatarMediaId ?? null
  );
  const [bannerMediaId, setBannerMediaId] = useState<string | null>(
    draft?.bannerMediaId ?? null
  );
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    draft?.avatarMediaId ? `/api/media/${draft.avatarMediaId}` : null
  );
  const [bannerPreview, setBannerPreview] = useState<string | null>(
    draft?.bannerMediaId ? `/api/media/${draft.bannerMediaId}` : null
  );
  const [uploadingSlot, setUploadingSlot] = useState<
    "avatar" | "banner" | null
  >(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);

  const effectiveSlug = slugTouched ? slug : slugifyCommunityName(name);

  const reset = useCallback(() => {
    setStep(0);
    setTopics([]);
    setType("PUBLIC");
    setMature(false);
    setName("");
    setSlug("");
    setSlugTouched(false);
    setDescription("");
    setAccentColor("slate");
    setAvatarMediaId(null);
    setBannerMediaId(null);
    setAvatarPreview(null);
    setBannerPreview(null);
    setUploadingSlot(null);
  }, []);

  // Resume the flow on mount when a draft holds real work. Calling the parent's
  // setter (not local state) keeps this out of the cascading-render lint, and it
  // runs after hydration so the dialog's first paint never disagrees with SSR.
  useEffect(() => {
    if (draft && hasCommunityDraftProgress(draft)) {
      onOpenChange(true);
    }
  }, [draft, onOpenChange]);

  // Persist on every change. The payload is a few hundred bytes, so writing it
  // directly is cheaper than the bookkeeping a debounce would add.
  useEffect(() => {
    saveCommunityDraft({
      accentColor,
      avatarMediaId,
      bannerMediaId,
      description,
      mature,
      name,
      slug,
      slugTouched,
      step,
      topics,
      type,
    });
  }, [
    accentColor,
    avatarMediaId,
    bannerMediaId,
    description,
    mature,
    name,
    slug,
    slugTouched,
    step,
    topics,
    type,
  ]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && createMutation.isPending) {
        return;
      }
      // Closing deliberately preserves the draft: the reader can come back and
      // pick up where they left off. Only a successful create clears it.
      onOpenChange(next);
    },
    [createMutation.isPending, onOpenChange]
  );

  // Only the fields that gate advancing. Topics need one pick; details need the
  // three required strings to satisfy the same schema the server will run.
  const stepValid = useMemo(() => {
    if (step === 0) {
      return topics.length > 0;
    }
    if (step === 2) {
      return createCommunitySchema.safeParse({
        accentColor,
        description,
        mature,
        name,
        slug: effectiveSlug,
        topics: topics.length > 0 ? topics : ["art"],
        type,
      }).success;
    }
    return true;
  }, [
    accentColor,
    description,
    effectiveSlug,
    mature,
    name,
    step,
    topics,
    type,
  ]);

  // Upload the file the cropper hands back, the same upload-on-select the post
  // composer uses. Only the media id is kept, which is what makes the choice
  // survive a reload; a File object could not.
  const runUpload = useCallback(
    async (kind: "avatar" | "banner", file: File) => {
      if (file.size > 10 * 1024 * 1024) {
        toast({
          description: "That image is over 10MB, try a smaller one",
          title: "File Too Big",
          variant: "destructive",
        });
        return;
      }

      // Show the local bytes immediately, then swap to the proxy URL once the
      // pipeline hands back an id.
      const objectUrl = URL.createObjectURL(file);
      if (kind === "avatar") {
        setAvatarPreview(objectUrl);
      } else {
        setBannerPreview(objectUrl);
      }
      setUploadingSlot(kind);
      setUploadProgress(0);
      setUploadStage(null);

      const result = await uploadCommunityImage(
        file,
        kind,
        setUploadProgress,
        setUploadStage
      );

      if ("error" in result) {
        // Roll the slot back so the user is not left on a preview that does not
        // correspond to a stored upload.
        if (kind === "avatar") {
          setAvatarMediaId(null);
          setAvatarPreview(null);
        } else {
          setBannerMediaId(null);
          setBannerPreview(null);
        }
        toast({
          description: result.error,
          title: "Upload Failed",
          variant: "destructive",
        });
      } else {
        const previewUrl = `/api/media/${result.mediaId}`;
        if (kind === "avatar") {
          setAvatarMediaId(result.mediaId);
          setAvatarPreview(previewUrl);
        } else {
          setBannerMediaId(result.mediaId);
          setBannerPreview(previewUrl);
        }
      }

      URL.revokeObjectURL(objectUrl);
      setUploadingSlot(null);
      setUploadStage(null);
      setUploadProgress(0);
    },
    [toast]
  );

  // The croppers report finished Blobs, the GIF path reports the raw File (its
  // animation must not be flattened by re-encoding).
  const handleAvatarCropped = useCallback(
    (blob: Blob | null) => {
      if (!blob) {
        return;
      }
      void runUpload("avatar", croppedImageFile(blob, "community-avatar"));
    },
    [runUpload]
  );

  const handleAvatarGif = useCallback(
    (file: File | null) => {
      if (!file) {
        return;
      }
      void runUpload("avatar", file);
    },
    [runUpload]
  );

  const handleBannerCropped = useCallback(
    (blob: Blob | null) => {
      if (!blob) {
        return;
      }
      void runUpload("banner", croppedImageFile(blob, "community-banner"));
    },
    [runUpload]
  );

  const handleBannerGif = useCallback(
    (file: File | null) => {
      if (!file) {
        return;
      }
      void runUpload("banner", file);
    },
    [runUpload]
  );

  const clearFile = useCallback((kind: "avatar" | "banner") => {
    if (kind === "avatar") {
      setAvatarMediaId(null);
      setAvatarPreview(null);
    } else {
      setBannerMediaId(null);
      setBannerPreview(null);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!user) {
      toast({
        description: "Sign in to create a community",
        variant: "destructive",
      });
      return;
    }
    const parsed = createCommunitySchema.safeParse({
      accentColor,
      description,
      mature,
      name,
      slug: effectiveSlug,
      topics,
      type,
    });
    if (!parsed.success) {
      toast({
        description: parsed.error.issues[0]?.message ?? "Check your details",
        variant: "destructive",
      });
      return;
    }

    try {
      // Imagery is already uploaded (upload-on-select), so creation only links
      // the ids - submitting is now a single round trip.
      const community = await createMutation.mutateAsync(parsed.data);

      if (avatarMediaId) {
        await fetch(`/api/communities/${community.slug}/avatar`, {
          body: JSON.stringify({ mediaId: avatarMediaId }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
      }
      if (bannerMediaId) {
        await fetch(`/api/communities/${community.slug}/banner`, {
          body: JSON.stringify({ mediaId: bannerMediaId }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
      }

      // The draft is done with; a fresh wizard starts clean.
      clearCommunityDraft();
      reset();
      handleOpenChange(false);
    } catch (error) {
      // createCommunity mutation already surfaces a toast for its own errors.
      if (!createMutation.isError) {
        toast({
          description:
            error instanceof Error
              ? error.message
              : "Couldn't create that community",
          variant: "destructive",
        });
      }
    }
  }, [
    accentColor,
    avatarMediaId,
    bannerMediaId,
    createMutation,
    description,
    effectiveSlug,
    handleOpenChange,
    mature,
    name,
    reset,
    toast,
    topics,
    type,
    user,
  ]);

  const isUploadingMedia = uploadingSlot !== null;
  const isSubmitting = createMutation.isPending || isUploadingMedia;
  const isLastStep = step === STEPS.length - 1;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {/* `w-[calc(100%-2rem)]` keeps a gutter on phones - DialogContent's base
          is `w-full`, which sits flush to both edges. rounded-2xl applies below
          sm too (the base only rounds from sm up), matching the app's surfaces.
          `[&>button:last-child]:hidden` hides DialogContent's stock close so the
          header can carry the app's 3D one instead. */}
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[56rem] [&>button:last-child]:hidden">
        {/* Compact header: title, a slim segmented step rail, and the 3D close. */}
        <header className="border-border/60 flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
          <DialogTitle className="text-base leading-tight font-bold tracking-tight">
            Create a community
          </DialogTitle>
          <span className="ml-auto">
            <StepRail current={step} />
          </span>
          <DialogClose
            aria-label="Close"
            className="icon-btn-3d flex size-7 shrink-0 items-center justify-center rounded-full border-0"
          >
            <X className="size-4" />
          </DialogClose>
          <DialogDescription className="sr-only">
            Set up a community in {STEPS.length} steps.
          </DialogDescription>
        </header>

        {/* Body: one scroll column on mobile, two independent columns from md -
            the form on the left and the live preview pinned on the right. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_19rem] md:overflow-hidden">
          <div className="hide-native-scrollbar min-h-0 px-4 py-4 md:overflow-y-auto">
            {step === 0 ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    What is your community about?
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Pick up to {COMMUNITY_LIMITS.topicMax} so people can find
                    it.
                  </p>
                </div>
                <CommunityTopicPicker onChange={setTopics} selected={topics} />
              </div>
            ) : null}

            {step === 1 ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    Who can take part?
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Only public communities appear in search.
                  </p>
                </div>
                {/* The app's tactile radio (.premium-radio), not a hand-rolled
                    circle. The label carries htmlFor so the whole row selects,
                    not just the control. */}
                <RadioGroup
                  aria-label="Community access"
                  className="flex flex-col gap-1.5"
                  onValueChange={(value) => setType(value as CommunityType)}
                  value={type}
                >
                  {TYPE_META.map((option) => {
                    const isSelected = type === option.value;
                    const id = `community-type-${option.value}`;
                    return (
                      <label
                        className="sidebar-subcard select-option-3d flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                        data-selected={isSelected}
                        htmlFor={id}
                        key={option.value}
                      >
                        <RadioGroupItem id={id} value={option.value} />
                        <span className="min-w-0">
                          <span className="text-foreground block text-sm font-medium">
                            {option.label}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {option.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </RadioGroup>

                <label
                  className="sidebar-subcard select-option-3d flex items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                  data-selected={mature}
                  htmlFor="community-mature"
                >
                  <Checkbox
                    checked={mature}
                    id="community-mature"
                    onCheckedChange={(value) => setMature(value === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block text-sm font-medium">
                      Mature (18+)
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      Viewers must be over 18
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="flex flex-col gap-4">
                <Field
                  hint={`${name.length}/${COMMUNITY_LIMITS.nameMax}`}
                  label="Name"
                >
                  <Input
                    maxLength={COMMUNITY_LIMITS.nameMax}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Hackers"
                    value={name}
                  />
                </Field>

                <Field
                  hint="Lowercase letters, numbers, underscores. Cannot be changed later."
                  label="Address"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground shrink-0 text-sm">
                      a/
                    </span>
                    <Input
                      maxLength={COMMUNITY_LIMITS.slugMax}
                      onChange={(event) => {
                        setSlugTouched(true);
                        setSlug(event.target.value.toLowerCase());
                      }}
                      placeholder={slugifyCommunityName(name) || "hackers"}
                      value={effectiveSlug}
                    />
                  </div>
                </Field>

                <Field
                  hint={`${description.length}/${COMMUNITY_LIMITS.descriptionMax}`}
                  label="Description"
                >
                  <Textarea
                    className="resize-none"
                    maxLength={COMMUNITY_LIMITS.descriptionMax}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="A place for builders, tinkerers, and the terminally curious."
                    rows={5}
                    value={description}
                  />
                </Field>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    Pick an accent
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Marks posts from this community across every feed.
                  </p>
                </div>
                <CommunityAccentPicker
                  onChange={setAccentColor}
                  value={accentColor}
                />
              </div>
            ) : null}

            {step === 4 ? (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    Add imagery
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Optional. JPG, PNG, or GIF under 10MB.
                  </p>
                </div>

                {/* Same hero arrangement as the settings profile editor: the
                    header spans the top and the mark overlaps its lower-left by
                    half. Both inputs own their file picking, cropping and GIF
                    centering. */}
                <div className="sidebar-subcard overflow-hidden rounded-2xl p-0">
                  <BannerInput
                    className="h-32 rounded-none border-0 sm:h-36"
                    canRemove={Boolean(bannerMediaId || bannerPreview)}
                    isRemoved={false}
                    isUploading={uploadingSlot === "banner"}
                    onBannerCropped={handleBannerCropped}
                    onGifSelected={handleBannerGif}
                    onRemove={() => clearFile("banner")}
                    progress={uploadProgress}
                    src={bannerPreview ?? ""}
                    stage={uploadStage}
                    user={user ?? { id: "new" }}
                  />

                  <div className="px-4 pt-0 pb-4">
                    <div className="-mt-12 flex items-end gap-3">
                      <AvatarInput
                        canDelete={Boolean(avatarMediaId || avatarPreview)}
                        className="size-24 ring-4 ring-[hsl(var(--background-alt))]"
                        isDeleted={false}
                        isUploading={uploadingSlot === "avatar"}
                        onDelete={() => clearFile("avatar")}
                        onGifSelected={handleAvatarGif}
                        onImageCropped={handleAvatarCropped}
                        progress={uploadProgress}
                        shape="squircle"
                        src={avatarPreview ?? avatarPlaceholder.src}
                        stage={uploadStage}
                        user={user ?? { id: "new" }}
                        variant="bare"
                      />
                      <p className="text-muted-foreground min-w-0 flex-1 pb-1 text-xs">
                        {uploadingSlot
                          ? `${pipelineStageLabel(uploadStage, uploadProgress, uploadingSlot)} ${uploadProgress}%`
                          : "Tap the banner or icon to upload, crop, and centre."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Live preview, pinned in its own inset column on the right. */}
          <aside className="border-border/60 bg-[hsl(var(--background-alt))] px-4 py-4 md:min-h-0 md:overflow-y-auto md:border-l">
            <CreateCommunityPreview
              accentColor={accentColor}
              avatarPreview={avatarPreview}
              bannerPreview={bannerPreview}
              description={description}
              mature={mature}
              name={name}
              slug={effectiveSlug}
              topics={topics}
            />
          </aside>
        </div>

        {/* Compact footer on the app's 3D surfaces: back is the neutral raised
            button (btn-3d-gray) and forward is the orange one (btn-3d via the
            premium variant). `rounded-lg!` is important because btn-3d-gray's
            pill radius lives in the same cascade layer as the utility and would
            otherwise win on source order; rounded-lg matches the community
            controls' squircle edge. text-sm! beats btn-3d's 18px display size. */}
        <footer className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2.5">
          <Button
            className="btn-3d-gray h-9 rounded-lg! px-4 text-sm!"
            disabled={step === 0 || isSubmitting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            type="button"
            variant="ghost"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          {isLastStep ? (
            <Button
              className="h-9 rounded-lg px-5 text-sm!"
              disabled={isSubmitting || !stepValid}
              onClick={handleSubmit}
              type="button"
              variant="premium"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {isUploadingMedia ? "Uploading…" : "Create community"}
            </Button>
          ) : (
            <Button
              className="h-9 rounded-lg px-5 text-sm!"
              disabled={!stepValid}
              onClick={() => setStep((s) => s + 1)}
              type="button"
              variant="premium"
            >
              Next
              <ArrowRight className="size-4" />
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
