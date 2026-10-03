"use client";

import {
  DEN_LIMITS,
  normalizeDenName,
  validateDenDescription,
  validateDenName,
} from "@asm/db/messages/dens";
import { Button } from "@asm/ui/shadui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import { Input } from "@asm/ui/shadui/input";
import { Textarea } from "@asm/ui/shadui/textarea";
import { Loader2, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import {
  MemberPicker,
  MemberPickerSearch,
} from "@/components/messages/member-picker";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { AvatarInput } from "@/components/profile/profile-media-inputs";
import { croppedImageFile } from "@/lib/media/cropped-image-file";
import type { UploadStage } from "@/lib/media/media-upload-client";
import { createDen, ensureConversationKeys } from "@/lib/messages/client";
import { uploadDenAvatar } from "@/lib/messages/den-avatar-upload";
import {
  denCreateNeedsOthers,
  denCreateRoom,
} from "@/lib/messages/den-capacity";
import type { MessagePickerRecipient } from "@/lib/messages/use-message-user-search";
import { cn } from "@/lib/utils";

// The create-a-den sheet.
//
// Built from the community create wizard's shell (compact header, one scroll
// column, pinned footer) because that is the app's one "collect a few fields and
// commit" shape, and from the share sheet's picker because that is the app's one
// "choose people" shape. Neither was extended: the wizard is
// step-based and five steps of topics and accents is not a den, and the share
// picker commits to a send on tap.
//
// Two rules the UI owns, both because the server would otherwise refuse:
//   - two people minimum. A den of one is a DM with extra steps, and the DM path
//     already handles a pair with a pairKey, so the button stays disabled until
//     somebody else is picked.
//   - the roster ceiling. DEN_LIMITS.membersMax is a protocol limit (the fan-out
//     of one root-key wrap per member), not a taste decision, so the picker stops
//     at it rather than letting the server say so.
//
// Everything else is the server's call, and when it refuses, its own words are
// what the dialog shows: `denErrorResponse` writes every refusal for a human, so
// a second phrasing here would only be a second thing to get wrong.

export interface CreateDenDialogProps {
  // Fired with the new conversation id once the root key has been fanned out, so
  // the conversation list can refresh from the same call that navigates.
  onCreated?: (conversationId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function CreateDenDialog({
  onCreated,
  onOpenChange,
  open,
}: CreateDenDialogProps) {
  const { user } = useSession();
  const { privateKey, status } = useMessagesIdentity();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<MessagePickerRecipient[]>([]);
  const [query, setQuery] = useState("");
  const [avatarMediaId, setAvatarMediaId] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const [creating, setCreating] = useState(false);
  // Named for what it holds: the refusal a create or an upload came back with.
  const [createError, setCreateError] = useState<string | null>(null);

  // Validated by the SAME helpers the create route runs, imported from the same
  // module, so the dialog cannot disagree with the server about what a legal
  // name is. Shown only once a field has been left, which keeps an empty form
  // quiet instead of scolding on open.
  const [touched, setTouched] = useState({ description: false, name: false });
  const nameError = validateDenName(name);
  const descriptionError = validateDenDescription(description);

  // Both ceilings come from the shared helper rather than being written out here,
  // so this dialog and the details panel cannot each arrive at their own idea of
  // the room left over - and neither can disagree with the service that
  // re-checks the cap.
  const room = denCreateRoom();
  const enoughPeople = selected.length >= denCreateNeedsOthers();
  const canCreate =
    status === "ready" &&
    Boolean(privateKey) &&
    !creating &&
    !uploading &&
    enoughPeople &&
    nameError === null &&
    descriptionError === null;

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setSelected([]);
    setQuery("");
    setAvatarMediaId(null);
    setAvatarPreview(null);
    setUploadStage(null);
    setTouched({ description: false, name: false });
    setCreateError(null);
  }, []);

  const toggle = useCallback(
    (member: MessagePickerRecipient) => {
      setSelected((current) => {
        if (current.some((entry) => entry.id === member.id)) {
          return current.filter((entry) => entry.id !== member.id);
        }
        return current.length < room ? [...current, member] : current;
      });
    },
    [room]
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Closing mid-create would dismiss the dialog out from under a request that
      // is about to navigate, and mid-upload would abandon a media row the
      // pipeline is still writing.
      if (!next && (creating || uploading)) {
        return;
      }
      onOpenChange(next);
      if (!next) {
        reset();
      }
    },
    [creating, onOpenChange, reset, uploading]
  );

  const runAvatarUpload = useCallback(async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setCreateError("That image is over 10MB, try a smaller one");
      return;
    }
    // Show the local bytes immediately, then swap to the proxy URL once the
    // pipeline hands back an id.
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
    setUploading(true);
    setUploadStage(null);
    const result = await uploadDenAvatar(file, setUploadStage);
    if ("error" in result) {
      // Roll the preview back, so the dialog is never showing bytes that
      // correspond to no stored upload.
      setAvatarMediaId(null);
      setAvatarPreview(null);
      setCreateError(result.error);
    } else {
      setAvatarMediaId(result.mediaId);
      setAvatarPreview(`/api/media/${result.mediaId}`);
    }
    URL.revokeObjectURL(objectUrl);
    setUploading(false);
    setUploadStage(null);
  }, []);

  const handleAvatarCropped = useCallback(
    (blob: Blob | null) => {
      if (blob) {
        void runAvatarUpload(croppedImageFile(blob, "den-avatar"));
      }
    },
    [runAvatarUpload]
  );

  const handleAvatarGif = useCallback(
    (file: File | null) => {
      if (file) {
        void runAvatarUpload(file);
      }
    },
    [runAvatarUpload]
  );

  const handleCreate = useCallback(async () => {
    if (!user || !privateKey) {
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const { conversation } = await createDen({
        ...(avatarMediaId === null ? {} : { avatarMediaId }),
        // Absent rather than empty. The route reads an explicit null as "clear
        // this", and there is nothing to clear on a row that does not exist yet;
        // an absent description is simply "no description".
        ...(description.trim().length > 0
          ? { description: description.trim() }
          : {}),
        memberIds: selected.map((member) => member.id),
        // Normalized before it leaves, so the stored name is what the dialog
        // showed and what the list row will read back.
        name: normalizeDenName(name),
      });

      // Fan the root key out to every member before anybody can send. A den with
      // no key is a den nobody can read, and the first send is the only other
      // moment this client knows to mint one — so it is minted here, while the
      // roster is still exactly who the server just admitted.
      //
      // A null answer means the epoch could not be resolved (another member won
      // the race for it, or this device could not be wrapped for). That is not a
      // reason to refuse the den: it is a reason to open it, where the send path
      // heals it. Refusing here would lose the roster the server just accepted.
      await ensureConversationKeys(conversation, privateKey, user.id);

      onCreated?.(conversation.id);
      onOpenChange(false);
      reset();
      router.push(`/messages?c=${encodeURIComponent(conversation.id)}`);
    } catch (error) {
      // The server already writes these for a human, so they are shown as they
      // came: "Add at least one other person", "You can only add people you
      // follow", "A den can have at most <membersMax> members" - and that last
      // one is built from DEN_LIMITS on the server, so it moves if the ceiling
      // moves. Re-phrasing any of them here would be a second copy that can only
      // be less accurate than the first.
      setCreateError(
        error instanceof Error ? error.message : "Couldn't create that den"
      );
      setCreating(false);
    }
  }, [
    avatarMediaId,
    description,
    onCreated,
    onOpenChange,
    privateKey,
    reset,
    router,
    selected,
    user,
    name,
  ]);

  // The roster line, so the reader can see what the button is waiting for.
  const rosterHint = useMemo(() => {
    const others = selected.length;
    if (others === 0) {
      return "Add at least 1 other person";
    }
    return `${others} ${others === 1 ? "other" : "others"} · ${others + 1} in the den`;
  }, [selected.length]);

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {/* The community wizard's shell: a gutter on phones (DialogContent's base
          is `w-full`, flush to both edges), rounded from the smallest width, and
          the stock close hidden in favour of the app's 3D one in the header. */}
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg [&>button:last-child]:hidden">
        <header className="border-border/60 flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
          <DialogTitle className="text-base leading-tight font-bold tracking-tight">
            New den
          </DialogTitle>
          <DialogClose
            aria-label="Close"
            className="icon-btn-3d ml-auto flex size-7 shrink-0 items-center justify-center rounded-full border-0"
          >
            <X className="size-4" />
          </DialogClose>
          <DialogDescription className="sr-only">
            A den is a group conversation for a group of people. You can share
            an invite link once it exists.
          </DialogDescription>
        </header>

        <div className="hide-native-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          {/* Name and description, in the wizard's Field shape. */}
          <label className="flex flex-col gap-1.5">
            <span className="text-foreground text-sm font-medium">Name</span>
            <Input
              maxLength={DEN_LIMITS.nameMax}
              onBlur={() => setTouched((state) => ({ ...state, name: true }))}
              onChange={(event) => setName(event.target.value)}
              placeholder="Study group"
              value={name}
            />
            <span
              className={cn(
                "text-xs",
                touched.name && nameError
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {touched.name && nameError
                ? nameError
                : `${name.length}/${DEN_LIMITS.nameMax}`}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-foreground text-sm font-medium">
              Description{" "}
              <span className="text-muted-foreground">(optional)</span>
            </span>
            <Textarea
              className="resize-none"
              maxLength={DEN_LIMITS.descriptionMax}
              onBlur={() =>
                setTouched((state) => ({ ...state, description: true }))
              }
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this den is for."
              rows={3}
              value={description}
            />
            <span
              className={cn(
                "text-xs",
                touched.description && descriptionError
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {touched.description && descriptionError
                ? descriptionError
                : `${description.length}/${DEN_LIMITS.descriptionMax}`}
            </span>
          </label>

          {/* The avatar. AvatarInput owns its own file picking, cropping and GIF
              centring, exactly as it does in the community wizard and the profile
              editor, so this dialog holds only the media id. */}
          <div className="flex items-center gap-3">
            <AvatarInput
              canDelete={Boolean(avatarMediaId)}
              className="size-16"
              isDeleted={false}
              isUploading={uploading}
              onDelete={() => {
                setAvatarMediaId(null);
                setAvatarPreview(null);
              }}
              onGifSelected={handleAvatarGif}
              onImageCropped={handleAvatarCropped}
              progress={0}
              shape="squircle"
              src={avatarPreview ?? ""}
              stage={uploadStage}
              user={user ?? { id: "new" }}
              variant="bare"
            />
            <div className="min-w-0">
              <p className="text-foreground text-sm font-medium">Picture</p>
              <p className="text-muted-foreground text-xs">
                Optional. Without one the den shows its members.
              </p>
            </div>
          </div>

          {/* The roster. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Users className="text-muted-foreground h-4 w-4 shrink-0" />
              <span className="text-foreground text-sm font-medium">
                Members
              </span>
              <span className="text-muted-foreground ml-auto text-xs">
                {rosterHint}
              </span>
            </div>

            <MemberPickerSearch
              onChange={setQuery}
              placeholder="Search for anyone…"
              value={query}
            />

            <MemberPicker
              excludeIds={selected.map((member) => member.id)}
              maxSelected={room}
              onToggle={toggle}
              query={query}
              selectedIds={selected.map((member) => member.id)}
            />

            {/* The chosen roster, each chip a removal. A chip that only removes
                (rather than toggling) is the honest control here: what it sits
                next to is already "in", so there is nothing to add back to. */}
            {selected.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {selected.map((member) => (
                  <li key={member.id}>
                    <button
                      className="chip-3d hover:bg-muted flex items-center gap-1.5 rounded-full py-0.5 pr-1.5 pl-2 text-xs"
                      onClick={() => toggle(member)}
                      type="button"
                    >
                      {member.displayName}
                      <X aria-hidden className="h-3 w-3" />
                      <span className="sr-only">— remove from this den</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* The server's own refusal, verbatim. `role="alert"` because this is
              the direct answer to the button just pressed, and assertive is the
              correct interruption for that. Deliberately NOT the polite
              membership-ended pattern: that reports something that happened
              elsewhere, this reports a refusal of what the reader just asked for. */}
          {createError ? (
            <p className="text-destructive text-xs" role="alert">
              {createError}
            </p>
          ) : null}
        </div>

        <footer className="border-border/60 flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">
          <Button
            className="btn-3d-gray h-9 rounded-lg! px-4 text-sm!"
            disabled={creating || uploading}
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            className="h-9 rounded-lg px-5 text-sm!"
            disabled={!canCreate}
            onClick={() => {
              void handleCreate();
            }}
            type="button"
            variant="premium"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : null}
            {creating ? "Creating…" : "Create den"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
