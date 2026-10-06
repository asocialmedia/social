"use client";

import {
  DEN_LIMITS,
  normalizeDenName,
  validateDenDescription,
  validateDenName,
} from "@asm/db/messages/dens";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@asm/ui/shadui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@asm/ui/shadui/dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Copy,
  Crown,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { DenAvatarCollage } from "@/components/messages/den-avatar-collage";
import { DenBanDialog } from "@/components/messages/den-ban-dialog";
import { DenBannedSection } from "@/components/messages/den-banned-section";
import { DenConfirmDialog } from "@/components/messages/den-confirm-dialog";
import {
  MemberPicker,
  MemberPickerSearch,
} from "@/components/messages/member-picker";
import { useMessagesIdentity } from "@/components/messages/message-identity-provider";
import { toast } from "@/lib/gooey-toast";
import { forgetSelfLeave, noteSelfLeave } from "@/lib/messages/access-ended";
import {
  addDenMembers,
  banDenMember,
  dissolveDen,
  ensureConversationKeys,
  fetchConversationDetail,
  fetchDen,
  fetchDenBans,
  fetchDenMembers,
  leaveDen,
  MessagesApiError,
  removeDenMember,
  rotateDenInvite,
  setDenMemberRole,
  transferDenOwnership,
  unbanDenMember,
  updateDenDetails,
} from "@/lib/messages/client";
import type { DenBannedMember, DenMember } from "@/lib/messages/client";
import { denBanAddRefusal } from "@/lib/messages/den-ban-copy";
import { denAddRoom, denIsFull } from "@/lib/messages/den-capacity";
import { denInviteUrl } from "@/lib/messages/den-invite";
import { denMemberCountLabel } from "@/lib/messages/den-label";
import {
  denAffordances,
  denRoleActionLabel,
  denRoleLabel,
  denRowActions,
  denRowMenuLabel,
  denViewerRoleLine,
} from "@/lib/messages/den-permissions";
import type { DenRoleActionKind } from "@/lib/messages/den-permissions";
import type { MessagePickerRecipient } from "@/lib/messages/use-message-user-search";
import { cn } from "@/lib/utils";

// The den's management surface, rendered inside the conversation details pane.
//
// It reads two things the pane does not otherwise hold: the den detail (name,
// description, invite code, the caller's role) and the roster. Everything it
// draws is gated on `denAffordances`, which is built from the SAME role helpers
// the server authorizes with — so the panel's idea of a manager cannot drift from
// `requireDenManager`. The server still re-checks every mutation; this only
// decides what a person is shown, which is a promise the UI makes and the server
// keeps.
//
// Add members, remove, promote and demote all go through the shared picker. The
// four paths that need agreement (remove a member, leave, transfer the den,
// delete the den) each get their own confirmation, because they are not the same
// loss: removing somebody costs them access and nothing else, leaving costs the
// reader access, handing the den over costs the reader their authority, and
// deleting the den costs everybody the messages.
//
// One thing worth stating because it is easy to get wrong: adding a member writes
// no key. A newcomer holds no root, so `ensureConversationKeys` must mint the next
// epoch for the whole roster — that is the `onAdd` path below, and it is the same
// call the composer makes on its first send. Skipping it would admit somebody who
// can see a den's name and read none of it.

const DEN_QUERY_PREFIX = ["message-den"];

interface DenPanelProps {
  conversationId: string;
  // Called after the reader is no longer a member (leave, or a den that
  // dissolved), because the thread above has to drop the conversation rather than
  // keep rendering a room that is gone.
  onLeft?: (outcome: { dissolved: boolean }) => void;
}

// Which den action is waiting to be confirmed, or null when none is.
//
// Every one of these ends a person being somewhere they were not, so each has its own
// confirmation rather than a shared "are you sure". `unban-member` has its own arm
// because its member is a banned row rather than a roster row - and because unban is
// the one case here that is a grant: the button sits in a collapsed list with one row
// per person and no other identifying context, so a mis-press hands a stranger the door
// back.
type DenConfirmState =
  | { kind: "delete-den" | "leave-den" }
  | { kind: "remove-member" | "transfer-ownership"; member: DenMember }
  | { kind: "unban-member"; member: DenBannedMember }
  | null;
export function DenPanel({ conversationId, onLeft }: DenPanelProps) {
  const { user } = useSession();
  const { privateKey } = useMessagesIdentity();
  const queryClient = useQueryClient();
  // The whole identity, not `user?.id`: the React Compiler reads the wider
  // dependency as the honest one, and narrowing it by hand is the pattern it
  // warns about.
  const userId = user?.id ?? "";

  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<MessagePickerRecipient[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<DenConfirmState>(null);
  // The ban is its own dialog rather than another `confirm` case, because it is the one
  // den action with a field in it. Lifting a ban is a `confirm` case instead - it has
  // no field, and it sits beside Remove where the reader already looks.
  const [banDialog, setBanDialog] = useState<{ member: DenMember } | null>(
    null
  );
  const [unbanningId, setUnbanningId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  const detail = useQuery({
    queryFn: () => fetchDen(conversationId),
    queryKey: [...DEN_QUERY_PREFIX, conversationId, "detail"],
  });
  const roster = useQuery({
    queryFn: () => fetchDenMembers(conversationId, DEN_LIMITS.membersMax),
    queryKey: [...DEN_QUERY_PREFIX, conversationId, "members"],
  });
  // Gated on the detail row rather than fired unconditionally. The route is
  // manager-only, so a plain member's panel would log a 403 for a section it is not
  // going to draw - and a list nobody may read should not be requested on their behalf
  // just because the panel happens to render for them.
  const bans = useQuery({
    enabled: detail.data?.canManage === true,
    queryFn: () => fetchDenBans(conversationId),
    queryKey: [...DEN_QUERY_PREFIX, conversationId, "bans"],
  });

  const viewer = useMemo(
    () => ({
      canManage: detail.data?.canManage ?? false,
      role: detail.data?.membership.role ?? null,
    }),
    [detail.data]
  );
  // The den-wide half, computed once; each roster row then asks for its own
  // target answer. `denAffordances` takes an optional target precisely so the
  // den-wide controls do not have to be re-derived per row.
  const denWide = denAffordances({ viewer });

  // What a mutation still has to refresh once the den's own scope is closed to
  // this viewer. Split out from `refresh` because the two are not the same set
  // after a leave: the transcript still has to learn the line that records it,
  // and the conversation payload is a read gate that admits a departed member on
  // purpose.
  const refreshReadable = useCallback(() => {
    // The thread owns the conversation detail, and a rename or a membership
    // change is exactly what its staleness guard is watching for, so the cached
    // conversation has to move too or the header keeps the old name.
    void queryClient.invalidateQueries({
      queryKey: ["message-conversation", conversationId],
    });
    // And the membership log the transcript draws from. The stream announcement
    // also invalidates this, but the announcement is best-effort: if this tab's
    // stream is down, the person who just promoted or removed somebody would see
    // the roster move and the transcript's log line not, which is the one
    // contradiction that reads as a bug.
    void queryClient.invalidateQueries({
      queryKey: ["den-events", conversationId],
    });
  }, [conversationId, queryClient]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [...DEN_QUERY_PREFIX, conversationId],
    });
    refreshReadable();
  }, [conversationId, queryClient, refreshReadable]);

  const copyInvite = useCallback(async () => {
    const code = detail.data?.den.inviteCode;
    if (!code) {
      return;
    }
    const link = denInviteUrl(window.location.origin, code);
    try {
      await navigator.clipboard.writeText(link);
      toast({ description: link, title: "Invite link copied" });
    } catch {
      toast({
        description: link,
        title: "Copy this link",
        variant: "destructive",
      });
    }
  }, [detail.data]);

  const rotateInvite = useCallback(async () => {
    setBusy(true);
    try {
      await rotateDenInvite(conversationId);
      refresh();
      toast({
        description: "The old link no longer works.",
        title: "New invite link",
      });
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't rotate that link",
        title: "Couldn't rotate the link",
        variant: "destructive",
      });
    }
    setBusy(false);
  }, [conversationId, refresh]);

  // Mint the next epoch so the newcomers hold the current root. This is the one
  // place a membership mutation needs crypto, and it is the same call the
  // composer makes, so there is no second fan-out path to keep in step.
  const healAfterRosterChange = useCallback(async () => {
    // `userId` rather than `user?.id`: the value is read once at the top, so the
    // callback depends on the id it actually uses instead of on the whole session
    // object, and a session refetch that hands back an equivalent user does not
    // invalidate the rotation.
    if (!userId || !privateKey) {
      return;
    }
    try {
      const current = await fetchConversationDetail(conversationId);
      await ensureConversationKeys(current.conversation, privateKey, userId, {
        refreshConversation: async () => {
          const fresh = await fetchConversationDetail(conversationId);
          return fresh.conversation;
        },
      });
    } catch {
      // Non-fatal by design. The roster change already landed and is true; the
      // next send heals the gap exactly as it would for any other interrupted
      // fan-out, and failing here would only tell the reader the add did not
      // happen when it did.
    }
  }, [conversationId, privateKey, userId]);

  const addMembers = useMutation({
    mutationFn: async (memberIds: string[]) =>
      await addDenMembers(conversationId, memberIds),
    onError: (error) => {
      // No block branch, because there is no block refusal to give its own words
      // to: a den admits regardless of who blocks whom, so the only 403 left here
      // is the genuine FORBIDDEN, and the server already wrote a sentence for it.
      // The generic toast below shows that message verbatim.
      //
      // A ban is the exception: it gets its own sentence, because the reader's
      // question is not "why did that fail" but "why is this one person in the way",
      // and the picker normally answers that before they press anything. Reaching here
      // means the ban landed between the picker's read and this submit.
      if (error instanceof MessagesApiError && error.code === "BANNED") {
        toast({
          description: denBanAddRefusal(1),
          title: "Couldn't add members",
          variant: "destructive",
        });
        return;
      }
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't add them",
        title: "Couldn't add members",
        variant: "destructive",
      });
    },
    onSuccess: async () => {
      setSelected([]);
      setAdding(false);
      refresh();
      await healAfterRosterChange();
    },
  });

  // Banning somebody who is still inside also removes them, which rotates the root
  // key so nobody who stays keeps an epoch the banned member can read. The same
  // discipline `removeMember` follows, and for the same reason: the roster moved, so
  // the fan-out has to be redone before the next send.
  const banMember = useCallback(
    async (member: DenMember | DenBannedMember, reason: string) => {
      setBusy(true);
      try {
        await banDenMember(conversationId, member.id, reason || null);
        setBanDialog(null);
        refresh();
        await healAfterRosterChange();
        const name = member.displayName ?? member.username ?? "They";
        toast({
          description: `${name} can't rejoin with an invite link or be added back until somebody unbans them.`,
          title: `${name} was banned`,
        });
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't ban them",
          title: "Couldn't ban member",
          variant: "destructive",
        });
      }
      setBusy(false);
    },
    [conversationId, healAfterRosterChange, refresh]
  );

  // No key rotation here, and that asymmetry is the point: an unban changes who is
  // PERMITTED, not who is inside. Nobody's membership row moves, so the current epoch
  // is still exactly right for everyone who remains.
  const unbanMember = useCallback(
    async (member: DenBannedMember) => {
      setUnbanningId(member.id);
      try {
        await unbanDenMember(conversationId, member.id);
        // Only on success. A failed lift leaves the dialog open over the row it names,
        // which is where a retry belongs - closing it would report the refusal as a
        // success with no trace.
        setConfirm(null);
        refresh();
        const name = member.displayName ?? member.username ?? "They";
        toast({
          description: "They can rejoin with an invite or be added again.",
          title: `${name} was unbanned`,
        });
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't unban them",
          title: "Couldn't unban",
          variant: "destructive",
        });
      }
      setUnbanningId(null);
    },
    [conversationId, refresh]
  );

  const setRole = useMutation({
    mutationFn: async (input: { role: "ADMIN" | "MEMBER"; userId: string }) => {
      await setDenMemberRole(conversationId, input.userId, input.role);
    },
    onError: (error) => {
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't change that role",
        title: "Role not changed",
        variant: "destructive",
      });
    },
    onSuccess: refresh,
  });

  const removeMember = useCallback(
    async (member: DenMember) => {
      setBusy(true);
      try {
        await removeDenMember(conversationId, member.id);
        setConfirm(null);
        refresh();
        // A removal is exactly the event that contaminates the current epoch for
        // everybody who stays, so the rotation is not optional bookkeeping here.
        await healAfterRosterChange();
        toast({
          description: `${member.displayName} was removed.`,
          title: "Member removed",
        });
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't remove them",
          title: "Couldn't remove member",
          variant: "destructive",
        });
      }
      setBusy(false);
    },
    [conversationId, healAfterRosterChange, refresh]
  );

  // Hands the den to somebody else. Deliberately NOT followed by
  // `healAfterRosterChange`: no membership row is created or destroyed, so every
  // member still holds the root for the current epoch and rotating would be pure
  // cost. What did change is who can dissolve the den, which `refresh` reflects.
  const handOver = useCallback(
    async (member: DenMember) => {
      setBusy(true);
      try {
        await transferDenOwnership(conversationId, member.id);
        setConfirm(null);
        refresh();
        toast({
          description: `${member.displayName} owns this den now. You're an Elder.`,
          title: "Den handed over",
        });
      } catch (error) {
        toast({
          description:
            error instanceof Error ? error.message : "Couldn't hand it over",
          title: "Den not handed over",
          variant: "destructive",
        });
      }
      setBusy(false);
    },
    [conversationId, refresh]
  );

  // The conversation list is a separate cache entry from this panel's own reads,
  // and it is the only surface that still lists a den the reader just left. Its
  // own poll would get there within thirty seconds; this gets there now, while
  // the toast is still on screen explaining what happened.
  const forgetConversation = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["message-conversations"] });
    void queryClient.invalidateQueries({
      queryKey: ["message-conversation", conversationId],
    });
  }, [conversationId, queryClient]);

  const leave = useCallback(async () => {
    setBusy(true);
    // Marked before the request, because the stream frame that ends this tab's
    // access can arrive while the response is still in flight. The thread reads
    // this to show the centered leave dialog instead of the removal toast.
    noteSelfLeave(conversationId);
    try {
      await leaveDen(conversationId);
      setConfirm(null);
      // Deliberately not the full `refresh`. The leave already closed this
      // account's access to the den, so re-reading the den detail and the roster
      // asks the server for two things it now answers 403 - the details sheet is
      // closing and every control in it is already refused, so there is nothing
      // to learn. What does still move is the transcript, which needs the line
      // recording the departure.
      refreshReadable();
      forgetConversation();
      // The den stays in the rail as read-only, so this is not a "navigate away"
      // moment the way it used to be. The details sheet still closes, because
      // every control in it is now refused.
      //
      // No success toast: the thread opens the centered leave dialog when the
      // stream delivers the membership-ended frame, and a second bottom toast
      // saying the same thing is exactly the duplication this replaced.
      onLeft?.({ dissolved: false });
    } catch (error) {
      // The leave failed, so nothing was ended. Clearing the marker keeps it from
      // silencing a genuine removal notice later in this tab.
      forgetSelfLeave(conversationId);
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't leave that den",
        title: "Couldn't leave",
        variant: "destructive",
      });
    }
    setBusy(false);
  }, [conversationId, forgetConversation, onLeft, refreshReadable]);

  const destroy = useCallback(async () => {
    setBusy(true);
    try {
      await dissolveDen(conversationId);
      setConfirm(null);
      forgetConversation();
      onLeft?.({ dissolved: true });
      toast({ description: "The den is gone.", title: "Den deleted" });
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't delete that den",
        title: "Couldn't delete the den",
        variant: "destructive",
      });
    }
    setBusy(false);
  }, [conversationId, forgetConversation, onLeft]);

  const rename = useCallback(async () => {
    const invalid = validateDenName(nameDraft);
    if (invalid) {
      toast({
        description: invalid,
        title: "Name not changed",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      // Both fields, because they are edited together in one form. The route
      // reads an absent key as "leave this alone" and an explicit null as "clear",
      // so an untouched description is sent as its own text rather than omitted --
      // this is a last-write-wins form, and pretending otherwise would be a lie
      // about what it does.
      await updateDenDetails(conversationId, {
        description: descriptionDraft.trim(),
        name: normalizeDenName(nameDraft),
      });
      setEditing(false);
      refresh();
    } catch (error) {
      toast({
        description:
          error instanceof Error ? error.message : "Couldn't rename that den",
        title: "Name not changed",
        variant: "destructive",
      });
    }
    setBusy(false);
  }, [conversationId, descriptionDraft, nameDraft, refresh]);

  if (detail.isLoading || roster.isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        <span className="sr-only">Loading den details</span>
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-muted-foreground text-xs">
          This den&apos;s details couldn&apos;t load.{" "}
          <button
            className="text-primary font-medium hover:underline"
            onClick={() => {
              void detail.refetch();
            }}
            type="button"
          >
            Try again
          </button>
        </p>
      </div>
    );
  }

  const { den } = detail.data;
  const members = roster.data ?? [];
  const { inviteCode } = den;
  const myUserId = userId;
  const draftNameError = validateDenName(nameDraft);
  const draftDescriptionError = validateDenDescription(descriptionDraft);
  // The detail route's count rather than the roster page's length: the page is
  // capped, so a den at exactly the ceiling and a den with unread members beyond
  // the first page are different states and only one of them is full.
  const rosterFull = denIsFull(den.memberCount);
  // Null for a plain member, so the subtitle stops after the count rather than
  // telling somebody what they already are.
  const viewerRoleLine = denViewerRoleLine(viewer.role);

  return (
    <div className="flex flex-col gap-3">
      {/* The den's identity, as a raised in-page card. The avatar is the same
          stack the list row draws, so the two cannot disagree about who is in
          this den. */}
      <div className="surface-3d rounded-2xl px-3.5 py-3">
        <div className="flex items-center gap-3">
          <DenAvatarCollage
            avatarMediaId={den.avatarMediaId}
            members={members}
            myUserId={myUserId}
            size={44}
          />
          <div className="min-w-0 flex-1">
            {editing ? (
              // Name and description in one form, because the PATCH carries them
              // together and a reader changing one almost always wants to look at
              // the other while they are there.
              <div className="flex flex-col gap-1.5">
                <input
                  aria-label="Den name"
                  className="premium-input w-full rounded-lg text-sm"
                  maxLength={DEN_LIMITS.nameMax}
                  onChange={(event) => setNameDraft(event.target.value)}
                  placeholder="Name this den"
                  value={nameDraft}
                />
                <textarea
                  aria-label="Den description"
                  className="premium-input w-full resize-none rounded-lg text-xs"
                  maxLength={DEN_LIMITS.descriptionMax}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  placeholder="What this den is for."
                  rows={2}
                  value={descriptionDraft}
                />
                <div className="flex items-center gap-2">
                  <button
                    className="text-primary shrink-0 text-xs font-medium"
                    disabled={
                      busy ||
                      draftNameError !== null ||
                      draftDescriptionError !== null
                    }
                    onClick={() => {
                      void rename();
                    }}
                    type="button"
                  >
                    Save
                  </button>
                  <button
                    className="text-muted-foreground shrink-0 text-xs font-medium"
                    onClick={() => setEditing(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                  {draftNameError || draftDescriptionError ? (
                    <span className="text-destructive text-xs">
                      {draftNameError ?? draftDescriptionError}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-sm font-semibold">
                  {den.name ?? "Unnamed den"}
                </span>
                {denWide.canRename ? (
                  <button
                    aria-label="Rename den"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => {
                      setDescriptionDraft(den.description ?? "");
                      setNameDraft(den.name ?? "");
                      setEditing(true);
                    }}
                    type="button"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                ) : null}
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              {denMemberCountLabel(den.memberCount)}
              {viewerRoleLine ? ` · ${viewerRoleLine}` : ""}
            </p>
          </div>
        </div>
        {den.description ? (
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            {den.description}
          </p>
        ) : null}
      </div>

      {/* Invite controls. The code is the door, and the server withholds it from
          anybody who is not a manager, so this block is only drawn when the panel
          actually holds one — a plain member is not shown a control that could
          only ever be disabled. */}
      {inviteCode && denWide.canCopyInvite ? (
        <div className="surface-3d rounded-2xl px-3.5 py-3">
          <p className="text-sm font-medium">Invite link</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Anyone with this link can join, whether or not they follow anybody
            in here. Banned accounts are still refused.
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              className="btn-3d-gray flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg! text-xs"
              onClick={() => {
                void copyInvite();
              }}
              type="button"
            >
              <Copy className="size-3.5" />
              Copy link
            </button>
            <button
              aria-label="Rotate invite link"
              className="btn-3d-gray flex h-8 items-center justify-center gap-1.5 rounded-lg! px-2.5 text-xs"
              disabled={busy}
              onClick={() => {
                void rotateInvite();
              }}
              title="Retire this link and mint a new one"
              type="button"
            >
              <RefreshCw className="size-3.5" />
              Rotate
            </button>
          </div>
        </div>
      ) : null}

      {/* The roster. Each row is a list item so the roles read as a list of
          people rather than a wall of buttons; the actions are a menu because an
          owner's row offers several legal moves at once and three buttons per row
          turns a roster of a hundred into a wall of chrome. */}
      <div className="surface-3d rounded-2xl px-3.5 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Members</p>
          {/* The detail route's count, not the roster page's length: the page is
              capped, and a count that could silently be short would make the
              "this den is full" line below disagree with the number above it. */}
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {den.memberCount}
          </span>
          {denWide.canAddMembers && !rosterFull ? (
            <button
              aria-label="Add members"
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => {
                setAdding(true);
                setSelected([]);
              }}
              type="button"
            >
              <UserPlus className="size-4" />
            </button>
          ) : null}
        </div>

        <ul className="divide-border/60 mt-1.5 divide-y">
          {members.map((member) => {
            const isSelf = member.id === myUserId;
            const affordances = denAffordances({
              target: { isSelf, role: member.role },
              viewer,
            });
            const actions = denRowActions({
              affordances,
              target: { isSelf, role: member.role },
            });
            return (
              <li className="flex items-center gap-2.5 py-2" key={member.id}>
                <UserAvatar avatarUrl={member.avatarUrl} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {isSelf
                      ? `${member.displayName} (you)`
                      : member.displayName}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    @{member.username}
                  </span>
                </span>
                <RoleChip role={member.role} />
                {actions.length > 0 ? (
                  <MemberActionMenu
                    actions={actions}
                    busy={busy}
                    member={member}
                    onBan={() => {
                      setBanDialog({ member });
                    }}
                    onRemove={() =>
                      setConfirm({ kind: "remove-member", member })
                    }
                    onRole={(nextRole) =>
                      setRole.mutate({ role: nextRole, userId: member.id })
                    }
                    onTransfer={() =>
                      setConfirm({ kind: "transfer-ownership", member })
                    }
                  />
                ) : null}
              </li>
            );
          })}
        </ul>

        {/* The banned list, as the last thing in the Members card and manager only.
            Collapsed to one row until it is opened, because it is almost always
            empty and it is a tool rather than a part of the roster. */}
        {denWide.canBanMembers ? (
          <DenBannedSection
            bans={bans.data ?? []}
            // A refused read is not an empty list. Reachable rather than theoretical:
            // `refresh()` invalidates the whole den prefix, so every mutation in the
            // panel spends a ban-list read against its budget.
            error={bans.isError ? "Couldn't load the banned list." : null}
            busyUserId={unbanningId}
            onUnban={(member) => {
              setConfirm({ kind: "unban-member", member });
            }}
          />
        ) : null}

        {rosterFull && denWide.canAddMembers ? (
          <p className="text-muted-foreground mt-2 text-xs">
            This den is full at {DEN_LIMITS.membersMax} members. Remove somebody
            before adding anyone.
          </p>
        ) : null}
      </div>

      {/* Leave and delete, separated because they are not the same loss and only
          the owner ever sees the second. */}
      {denWide.canLeave ? (
        <div className="surface-3d divide-border/60 divide-y overflow-hidden rounded-2xl">
          <DestructiveRow
            disabled={busy}
            icon={<UserMinus className="size-4" />}
            label="Leave den"
            onClick={() => setConfirm({ kind: "leave-den" })}
            sublabel={
              viewer.role === "OWNER"
                ? "Ownership passes to the longest-standing member"
                : "You stop getting messages from this den"
            }
          />
          {denWide.canDeleteDen ? (
            <DestructiveRow
              disabled={busy}
              icon={<Trash2 className="size-4" />}
              label="Delete den"
              onClick={() => setConfirm({ kind: "delete-den" })}
              sublabel="Deletes it for everyone, permanently"
            />
          ) : null}
        </div>
      ) : null}

      {/* Add members. The shared picker, in a dialog, because the roster is
          already on screen and the picker would otherwise push it off. */}
      <Dialog
        onOpenChange={(next) => {
          if (!next) {
            setAdding(false);
            setSelected([]);
          }
        }}
        open={adding}
      >
        <DialogContent className="w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add members</DialogTitle>
            <DialogDescription>
              Anyone here who will not accept a direct add is greyed out, as is
              anyone banned from this den. Everyone else you can always reach
              with the invite link.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <MemberPickerSearch
              onChange={setQuery}
              placeholder="Search for anyone…"
              value={query}
            />
            <MemberPicker
              // Shown and greyed rather than hidden, and that is the point: a manager
              // who types somebody's name and finds nothing has no way to tell a ban
              // from a typo. The row says so, and says what to do about it.
              //
              // This prop was accepted by `MemberPicker` and had no call site, so the
              // dead-row handling in there ran for nobody and a banned person was
              // selectable - the refusal then arriving only on submit, from a route
              // that checks this itself. Hence the dialog's own promise that banned
              // candidates are greyed out was not true.
              bannedIds={bans.data?.map((ban) => ban.id)}
              excludeIds={[
                myUserId,
                ...members.map((member) => member.id),
                ...selected.map((member) => member.id),
              ]}
              // The room that is actually left in THIS den, which is why the
              // picker stops here rather than at the protocol ceiling.
              maxSelected={denAddRoom(members.length)}
              onToggle={(member) =>
                setSelected((current) =>
                  current.some((entry) => entry.id === member.id)
                    ? current.filter((entry) => entry.id !== member.id)
                    : [...current, member]
                )
              }
              query={query}
              selectedIds={selected.map((member) => member.id)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              className="text-muted-foreground px-3 py-1.5 text-sm font-medium"
              onClick={() => {
                setAdding(false);
                setSelected([]);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="btn-3d h-9 rounded-lg px-4 text-sm"
              disabled={selected.length === 0 || addMembers.isPending}
              onClick={() => {
                addMembers.mutate(selected.map((member) => member.id));
              }}
              type="button"
            >
              {addMembers.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {addMembers.isPending
                ? "Adding…"
                : `Add ${selected.length || ""}`.trim()}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Not mounted at all when nobody is being banned, so the dialog cannot be handed
          a member that is not there and cannot render a title built from nothing. The
          dialog needs no `open={false}` path for the same reason: there is no state to
          animate away from, because there is no component. */}
      {banDialog ? (
        <DenBanDialog
          ban={banDialog.member}
          busy={busy}
          onConfirm={(reason) => {
            void banMember(banDialog.member, reason);
          }}
          onOpenChange={(next) => {
            if (!next && !busy) {
              setBanDialog(null);
            }
          }}
          open
        />
      ) : null}

      <DenConfirmDialog
        // Either request in flight closes the dialog's buttons, so a slow lift cannot
        // be fired twice by an impatient second press.
        busy={busy || unbanningId !== null}
        kind={confirm?.kind ?? "leave-den"}
        memberName={denConfirmMemberName(confirm)}
        onConfirm={() => {
          if (confirm?.kind === "remove-member") {
            void removeMember(confirm.member);
            return;
          }
          if (confirm?.kind === "transfer-ownership") {
            void handOver(confirm.member);
            return;
          }
          if (confirm?.kind === "unban-member") {
            void unbanMember(confirm.member);
            return;
          }
          if (confirm?.kind === "delete-den") {
            void destroy();
            return;
          }
          void leave();
        }}
        onOpenChange={(next) => {
          if (!next && !busy && unbanningId === null) {
            setConfirm(null);
          }
        }}
        open={confirm !== null}
      />
    </div>
  );
}

// A chip only for the roles that are something. A plain Member draws nothing at
// all: the default state is not an achievement, and a chip on every row of a
// hundred-member roster turns "you are an Elder" into one chip among a hundred.
// So the default is silence and the two roles that grant something carry a mark -
// the crown for the one who is in charge, the app's accent for one who can add
// and remove.
//
// Exported for the test rather than kept private, because "renders nothing" is
// only an interesting claim if something can actually ask.
export function RoleChip({ role }: { role: DenMember["role"] }) {
  if (role === "MEMBER") {
    return null;
  }
  return (
    <span
      className={cn(
        "chip-3d shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        role === "OWNER" && "text-[#ff9500]",
        role === "ADMIN" && "text-primary"
      )}
    >
      {role === "OWNER" ? (
        <Crown aria-hidden className="mr-1 inline size-2.5 align-[-1px]" />
      ) : null}
      {denRoleLabel(role)}
    </span>
  );
}

// One roster row's legal actions, as a menu. A menu rather than a button because an
// owner's row can carry up to three moves at once, and rendering them as three
// buttons on every row of a hundred-member roster would drown the list of people
// in chrome.
//
// Every entry here is one the affordances already allowed, so there is never a
// disabled item to render: a greyed-out "Promote" beside a live "Remove" would be
// offering something the route refuses. The trigger names the single action when
// there is one, and the subject when there are several, for the reason
// `denRowMenuLabel` gives. Exported with `RoleChip` because the accessible name is
// the only part of this component that renders without an open menu.
// The name a den confirmation is addressed to, or null when the case has no person in
// it. Three of the four kinds name somebody and one does not, and at the call site that
// is a nested ternary inside JSX - so it gets a name instead.
function denConfirmMemberName(state: DenConfirmState): string | null {
  // Tested on the presence of a member rather than on the kind. "delete-den" and
  // "leave-den" share one arm whose `kind` is a union of both, so excluding the two
  // literals does not narrow that arm away - the shape does.
  if (state === null || !("member" in state)) {
    return null;
  }
  return state.member.displayName;
}

export function MemberActionMenu({
  actions,
  busy,
  member,
  onBan,
  onRemove,
  onRole,
  onTransfer,
}: {
  actions: DenRoleActionKind[];
  busy: boolean;
  member: DenMember;
  onBan: () => void;
  onRemove: () => void;
  onRole: (role: "ADMIN" | "MEMBER") => void;
  onTransfer: () => void;
}) {
  // One label per action, so the menu can never render a row whose text does not
  // match what it does.
  const label = denRowMenuLabel({
    actions,
    memberName: member.displayName,
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="text-muted-foreground hover:text-foreground shrink-0"
        disabled={busy}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.includes("promote") ? (
          <DropdownMenuItem onSelect={() => onRole("ADMIN")}>
            <Shield className="size-4" />
            {denRoleActionLabel({
              action: "promote",
              memberName: member.displayName,
            })}
          </DropdownMenuItem>
        ) : null}
        {actions.includes("transfer") ? (
          <DropdownMenuItem onSelect={onTransfer}>
            <Crown className="size-4" />
            {denRoleActionLabel({
              action: "transfer",
              memberName: member.displayName,
            })}
          </DropdownMenuItem>
        ) : null}
        {actions.includes("demote") ? (
          <DropdownMenuItem onSelect={() => onRole("MEMBER")}>
            <Shield className="size-4" />
            {denRoleActionLabel({
              action: "demote",
              memberName: member.displayName,
            })}
          </DropdownMenuItem>
        ) : null}
        {actions.includes("remove") ? (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={onRemove}
          >
            <UserMinus className="size-4" />
            {denRoleActionLabel({
              action: "remove",
              memberName: member.displayName,
            })}
          </DropdownMenuItem>
        ) : null}
        {/* Ban last, and next to remove rather than after it, for the reason
            `denRowActions` gives: the two are different decisions about the same person
            rather than two strengths of one, and a reader who has to remember which of
            two adjacent destructive entries is the reversible one will eventually get
            it wrong in the direction that locks somebody out. */}
        {actions.includes("ban") ? (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={onBan}
          >
            <Ban className="size-4" />
            {denRoleActionLabel({
              action: "ban",
              memberName: member.displayName,
            })}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DestructiveRow({
  disabled,
  icon,
  label,
  onClick,
  sublabel,
}: {
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  sublabel: string;
}) {
  return (
    <button
      className="pill-3d-hover flex w-full items-center gap-3 px-3.5 py-3 text-left disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="chip-3d text-destructive flex size-8 shrink-0 items-center justify-center rounded-xl">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-destructive block text-sm font-medium">
          {label}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {sublabel}
        </span>
      </span>
    </button>
  );
}
