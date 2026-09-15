"use client";

import { createCommunitySchema } from "@asm/auth/validation";
import {
  COMMUNITY_LIMITS,
  getCommunityTopic,
  slugifyCommunityName,
} from "@asm/db/communities";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { Textarea } from "@asm/ui/shadui/textarea";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Lock } from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { useCreateCommunityMutation } from "@/communities/mutations";
import { communityAccentStyle } from "@/lib/communities/accent";
import { useToast } from "@/lib/gooey-toast";
import { uploadMediaFile } from "@/lib/media/media-upload-client";
import { cn } from "@/lib/utils";

import CommunityAccentPicker from "./community-accent-picker";
import CommunityAvatar from "./community-avatar";
import CommunityTopicPicker from "./community-topic-picker";

type CommunityType = "PUBLIC" | "RESTRICTED" | "PRIVATE";

const STEPS = ["Topics", "Access", "Identity", "Accent", "Imagery"] as const;

const TYPE_META: {
  description: string;
  label: string;
  value: CommunityType;
}[] = [
  {
    description: "Anyone can view, post, and comment to this community",
    label: "Public",
    value: "PUBLIC",
  },
  {
    description: "Anyone can view, but only approved users can contribute",
    label: "Restricted",
    value: "RESTRICTED",
  },
  {
    description: "Only approved users can view and contribute",
    label: "Private",
    value: "PRIVATE",
  },
];

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

  const [step, setStep] = useState(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [type, setType] = useState<CommunityType>("PUBLIC");
  const [mature, setMature] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [accentColor, setAccentColor] = useState("slate");

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

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
    setAvatarFile(null);
    setBannerFile(null);
    setAvatarPreview(null);
    setBannerPreview(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && createMutation.isPending) {
        return;
      }
      if (!next) {
        reset();
      }
      onOpenChange(next);
    },
    [createMutation.isPending, onOpenChange, reset]
  );

  const stepValid = useMemo(() => {
    if (step === 0) {
      return topics.length > 0;
    }
    if (step === 2) {
      const parsed = createCommunitySchema.safeParse({
        accentColor,
        description,
        mature,
        name,
        slug: effectiveSlug,
        topics: topics.length > 0 ? topics : ["art"],
        type,
      });
      return parsed.success;
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

  const pickFile = useCallback((kind: "avatar" | "banner") => {
    const ref = kind === "avatar" ? avatarInputRef : bannerInputRef;
    ref.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    (kind: "avatar" | "banner", file: File | undefined) => {
      if (!file) {
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({
          description: "That image is over 10MB, try a smaller one",
          title: "File Too Big",
          variant: "destructive",
        });
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      if (kind === "avatar") {
        setAvatarFile(file);
        setAvatarPreview(objectUrl);
      } else {
        setBannerFile(file);
        setBannerPreview(objectUrl);
      }
    },
    [toast]
  );

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
      // Media uploads run before creation; the returned ids are linked to the
      // new community right after it exists.
      let avatarMediaId: string | null = null;
      let bannerMediaId: string | null = null;
      if (avatarFile || bannerFile) {
        setIsUploadingMedia(true);
      }
      if (avatarFile) {
        const uploaded = await uploadMediaFile(avatarFile, {
          purpose: "avatar",
        });
        avatarMediaId = uploaded.mediaId;
      }
      if (bannerFile) {
        const uploaded = await uploadMediaFile(bannerFile, {
          purpose: "banner",
        });
        bannerMediaId = uploaded.mediaId;
      }
      setIsUploadingMedia(false);

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

      handleOpenChange(false);
    } catch (error) {
      setIsUploadingMedia(false);
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
    avatarFile,
    bannerFile,
    createMutation,
    description,
    effectiveSlug,
    handleOpenChange,
    mature,
    name,
    toast,
    topics,
    type,
    user,
  ]);

  const isSubmitting = createMutation.isPending || isUploadingMedia;

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-border/60 shrink-0 border-b px-5 pt-5 pb-4">
          <DialogTitle>Create a community</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="hide-native-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-foreground text-sm font-medium">
                What is your community about?
              </p>
              <p className="text-muted-foreground -mt-1 text-xs">
                Pick up to {COMMUNITY_LIMITS.topicMax} topics so people can
                discover it.
              </p>
              <CommunityTopicPicker onChange={setTopics} selected={topics} />
            </div>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-foreground text-sm font-medium">
                  What kind of community is this?
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Decide who can view and contribute. Only public communities
                  show up in search. Once set, changing it needs a request.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {TYPE_META.map((option) => (
                  <button
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                      type === option.value
                        ? "border-primary/60 bg-primary/10"
                        : "border-border/60 hover:bg-muted/50"
                    )}
                    key={option.value}
                    onClick={() => setType(option.value)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                        type === option.value
                          ? "border-primary"
                          : "border-border"
                      )}
                    >
                      {type === option.value ? (
                        <span className="bg-primary size-2 rounded-full" />
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span className="text-foreground block text-sm font-medium">
                        {option.label}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {option.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <button
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  mature
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/60 hover:bg-muted/50"
                )}
                onClick={() => setMature((prev) => !prev)}
                type="button"
              >
                <Lock className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block text-sm font-medium">
                    Mature (18+)
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    Users must be over 18 to view and contribute
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    mature ? "bg-primary" : "bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-4 rounded-full bg-white transition-transform",
                      mature ? "translate-x-4" : "translate-x-0.5"
                    )}
                  />
                </span>
              </button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-4">
              <p className="text-foreground text-sm font-medium">
                Tell us about your community
              </p>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-foreground text-sm font-medium"
                  htmlFor="community-name"
                >
                  Community name
                </label>
                <Input
                  id="community-name"
                  maxLength={COMMUNITY_LIMITS.nameMax}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Hackers"
                  value={name}
                />
                <span className="text-muted-foreground self-end text-xs">
                  {name.length}/{COMMUNITY_LIMITS.nameMax}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-foreground text-sm font-medium"
                  htmlFor="community-slug"
                >
                  Community address
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">a/</span>
                  <Input
                    id="community-slug"
                    maxLength={COMMUNITY_LIMITS.slugMax}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value.toLowerCase());
                    }}
                    placeholder={slugifyCommunityName(name) || "hackers"}
                    value={effectiveSlug}
                  />
                </div>
                <span className="text-muted-foreground text-xs">
                  Lowercase letters, numbers, and underscores. Cannot be changed
                  later.
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  className="text-foreground text-sm font-medium"
                  htmlFor="community-description"
                >
                  Description
                </label>
                <Textarea
                  id="community-description"
                  maxLength={COMMUNITY_LIMITS.descriptionMax}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A place for builders, tinkerers, and the terminally curious."
                  rows={4}
                  value={description}
                />
                <span className="text-muted-foreground self-end text-xs">
                  {description.length}/{COMMUNITY_LIMITS.descriptionMax}
                </span>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-3">
              <p className="text-foreground text-sm font-medium">
                Pick an accent
              </p>
              <p className="text-muted-foreground -mt-1 text-xs">
                The accent marks posts from this community across every feed.
              </p>
              <CommunityAccentPicker
                onChange={setAccentColor}
                value={accentColor}
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-4">
              <p className="text-foreground text-sm font-medium">
                Add imagery (optional)
              </p>
              <div className="flex items-center gap-4">
                <button
                  className="relative shrink-0"
                  onClick={() => pickFile("avatar")}
                  type="button"
                >
                  <CommunityAvatar
                    accentColor={accentColor}
                    avatarUrl={avatarPreview}
                    className="size-20"
                    name={name || "New community"}
                    slug={effectiveSlug || "new"}
                  />
                  <span className="bg-foreground/70 text-background absolute right-0 bottom-0 flex size-6 items-center justify-center rounded-full">
                    <ImagePlus className="size-3.5" />
                  </span>
                </button>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Community icon</p>
                  <p className="text-muted-foreground text-xs">
                    Square image, at least 256px. JPG, PNG, or GIF.
                  </p>
                </div>
              </div>

              <button
                className="border-border/60 hover:bg-muted/40 relative block h-28 w-full overflow-hidden rounded-xl border transition-colors"
                onClick={() => pickFile("banner")}
                type="button"
              >
                {bannerPreview ? (
                  <Image
                    alt="Community banner preview"
                    className="object-cover"
                    fill
                    sizes="480px"
                    src={bannerPreview}
                    unoptimized
                  />
                ) : (
                  <span className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
                    <ImagePlus className="size-4" />
                    Add a banner
                  </span>
                )}
              </button>
            </div>
          ) : null}

          {/* Live preview: shows the a/slug identity, the accent and the dummy
              weekly stats so the creator sees the shape before publishing. */}
          <div className="border-border/60 bg-muted/20 mt-5 rounded-2xl border p-3.5">
            <div
              className="flex items-center gap-3"
              style={communityAccentStyle(accentColor)}
            >
              <CommunityAvatar
                accentColor={accentColor}
                avatarUrl={avatarPreview}
                className="size-11"
                name={name || "New community"}
                slug={effectiveSlug || "new"}
              />
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm font-semibold">
                  {name || "Your community"}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  a/{effectiveSlug || "address"}
                </p>
              </div>
            </div>
            <p className="text-muted-foreground mt-2.5 text-xs">
              {topics.length > 0
                ? topics.map((t) => getCommunityTopic(t)?.label).join(" · ")
                : "No topics yet"}
            </p>
            <p className="text-muted-foreground mt-1 text-xs tabular-nums">
              1 weekly visitor · 1 weekly contributor
            </p>
          </div>
        </div>

        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => handleFileSelected("avatar", e.target.files?.[0])}
          ref={avatarInputRef}
          type="file"
        />
        <input
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => handleFileSelected("banner", e.target.files?.[0])}
          ref={bannerInputRef}
          type="file"
        />

        <div className="border-border/60 flex shrink-0 items-center justify-between gap-2 border-t px-5 py-4">
          <Button
            disabled={step === 0 || isSubmitting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            type="button"
            variant="ghost"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              disabled={!stepValid}
              onClick={() => setStep((s) => s + 1)}
              type="button"
            >
              Next
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              disabled={isSubmitting || !stepValid}
              onClick={handleSubmit}
              type="button"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {isUploadingMedia ? "Uploading…" : "Create community"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
