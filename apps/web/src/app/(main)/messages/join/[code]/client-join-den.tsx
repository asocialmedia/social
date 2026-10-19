"use client";

import { Button } from "@asm/ui/shadui/button";
import {
  AlertCircle,
  Ghost,
  Link2Off,
  Loader2,
  Lock,
  ShieldAlert,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  MessagesApiError,
  createConversation,
  fetchDenInviteAvatar,
  fetchDenInvitePreview,
  joinDen,
} from "@/lib/messages/client";
import type { DenInvitePreviewResponse } from "@/lib/messages/client";
import {
  DEN_BAN_JOIN_DESCRIPTION,
  DEN_BAN_JOIN_DISMISS,
  DEN_BAN_JOIN_TITLE,
} from "@/lib/messages/den-ban-copy";
import {
  denAskOwner,
  denJoinActionLabel,
  denJoinDescription,
  denJoinDismiss,
  denJoinFailure,
  denJoinOutcome,
  denJoinTitle,
} from "@/lib/messages/den-invite";
import type {
  DenExpiredInvite,
  DenJoinFailure,
} from "@/lib/messages/den-invite";
import { denMemberCountLabel } from "@/lib/messages/den-label";

// The screen at the end of a den invite link.
//
// Read-only until the reader presses one button, and then it is a single POST
// followed by a navigation. Everything the reader could get wrong — a code that
// was rotated out, a link they already used, an account with no Messages key, a
// den that has already hit its ceiling — has a state here that says so in words
// rather than surfacing an error, because this is the door somebody walks in on
// from a chat app and none of those four is a failure of theirs. The full state
// is decided from the preview's own member count, which is also what lets the
// join route answer it without telling a code-guesser anything it could not
// already read; see `den-invite.ts`.
//
// The expired state is the one that needed a screen of its own. It used to be
// folded into "invalid", which is a dead end with no way out of it: the reader had
// been invited, the code had been rotated away underneath them, and the screen could
// neither say so nor name anybody to ask. The preview now carries the den and its
// owner for exactly that case, so this screen can offer the one action that helps.
//
// The states are decided in `den-invite.ts` (pure, unit-tested) and this component
// only draws them.

type ScreenState =
  | { kind: "loading" }
  | {
      kind: "ready";
      avatarUrl: string | null;
      preview: DenInvitePreviewResponse | null;
    }
  | { kind: "failed"; reason: DenJoinFailure };

export default function ClientJoinDen({ code }: { code: string }) {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [joining, setJoining] = useState(false);
  const [asking, setAsking] = useState(false);

  // The preview read. A 404 is not an error state to render raw: the route answers
  // it for a code that never existed and for one whose den has been dissolved, and
  // those are the same thing to the person holding the link.
  //
  // The avatar is a second read rather than a field on this one, because the bytes
  // have to be fetched through a route that checks the code is still live. The
  // picture is worth a round trip and never worth a failure: a 404 here means the
  // den has no image, the code is not one this screen may draw a picture for, or
  // the object is not servable yet, and all three end in the same placeholder. So
  // the catch is swallowed here and the screen degrades, which is the same contract
  // the rest of this surface keeps.
  //
  // An async function inside the effect rather than a `.then` chain: the try/catch
  // is real, and cancellation is one guard at each exit rather than a flag read
  // twice.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const preview = await fetchDenInvitePreview(code);
        if (cancelled) {
          return;
        }
        setState({ avatarUrl: null, kind: "ready", preview });
        // Only the LIVE shape carries an image, so the retired one is answered from
        // the preview alone and never spends a request on a picture it may not have.
        if (preview.expired || !preview.den.avatarMediaId) {
          return;
        }
        const avatarUrl = await fetchDenInviteAvatar(code);
        if (cancelled) {
          return;
        }
        setState({ avatarUrl, kind: "ready", preview });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          kind: "failed",
          reason: denJoinFailure(
            error instanceof MessagesApiError ? error.status : null
          ),
        });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  const handleJoin = useCallback(async () => {
    setJoining(true);
    try {
      const { conversationId } = await joinDen(code);
      // `alreadyMember` needs no handling here: the POST succeeds either way and
      // answers with the same conversation, so opening it is the whole outcome.
      // Announcing "you were already in" would be a toast for something the
      // reader asked for.
      router.replace(`/messages?c=${encodeURIComponent(conversationId)}`);
    } catch (error) {
      const reason = denJoinFailure(
        error instanceof MessagesApiError ? error.status : null
      );
      setState({ kind: "failed", reason });
      setJoining(false);
    }
  }, [code, router]);

  // Somebody already inside this den opens it directly rather than pressing a join
  // button, and that is not a shortcut. The code may have been rotated since the
  // preview, and the join service deliberately refuses a retired code - so the POST
  // would be a 404 for a code this reader legitimately used, and the screen would
  // tell somebody standing in the room that they could not find it. The preview has
  // already established membership, so the conversation id is all the button needs.
  const handleOpen = useCallback(
    (conversationId: string) => {
      router.replace(`/messages?c=${encodeURIComponent(conversationId)}`);
    },
    [router]
  );

  // "Ask for a new invite": open a DM with the den's owner and hand over to the
  // messages page. `denAskOwner` owns the order (open, then navigate) and the
  // refusal, so the reasoning about why the message is opened from HERE lives beside
  // the decision rather than in a component.
  const handleAskOwner = useCallback(
    async (ownerId: string) => {
      setAsking(true);
      const opened = await denAskOwner({
        navigate: (path) => {
          router.push(path);
        },
        openDirectMessage: createConversation,
        ownerId,
      });
      if (opened) {
        return;
      }
      // A refusal is answered here, where an honest answer exists: the unknown
      // screen says this link does not resolve and offers a way out, rather than a
      // button that walks somebody to an error about a person they have never spoken
      // to. And it is not announced as a failure - the reader pressed a button that
      // does not work, which is a dead end, not a fault of theirs.
      setAsking(false);
      setState({ avatarUrl: null, kind: "ready", preview: null });
    },
    [router]
  );

  const handleNevermind = useCallback(() => {
    // A dismissal, so it never acquires error semantics: the reader pressed a button
    // to leave, not a control that failed.
    denJoinDismiss({
      back: () => {
        router.back();
      },
      historyLength: window.history.length,
      replace: (href) => {
        router.replace(href);
      },
    });
  }, [router]);

  if (state.kind === "loading") {
    return (
      <Screen>
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <h1 className="text-base font-semibold">Checking this link…</h1>
        {/* An `<output>` rather than a `role="status"` paragraph: it is the
            element for a result, it is implicitly a polite live region, and it
            costs no ARIA to say what it is. The load resolving IS the announcement,
            and it must not interrupt whatever the reader was doing on the page they
            came from. */}
        <output className="sr-only">Checking this invite link.</output>
      </Screen>
    );
  }

  if (state.kind === "failed") {
    return (
      <DenJoinFailureScreen
        onNevermind={handleNevermind}
        reason={state.reason}
      />
    );
  }

  // The pure decision, from the preview. A null preview is the invalid state, so
  // the screen never has to invent a second way to be told the code is dead.
  const outcome = denJoinOutcome({ preview: state.preview });
  const action = denJoinActionLabel(outcome, joining);

  // A banned reader is shown the same screen a refused press would produce, so the two
  // paths - caught by the preview, caught by the route - cannot reach a reader with
  // two different explanations of the same denial.
  if (outcome.kind === "banned") {
    return (
      <DenJoinFailureScreen onNevermind={handleNevermind} reason="banned" />
    );
  }
  if (outcome.kind === "expired") {
    return (
      <DenExpiredScreen
        asking={asking}
        den={outcome.den}
        onAskOwner={handleAskOwner}
        onNevermind={handleNevermind}
      />
    );
  }

  return (
    <Screen>
      <JoinScreenIcon
        avatarUrl={state.avatarUrl}
        fallback={
          outcome.kind === "full" ? (
            <Users aria-hidden className="text-muted-foreground size-6" />
          ) : (
            <Link2Off aria-hidden className="text-muted-foreground size-6" />
          )
        }
      />
      <h1 className="text-lg font-semibold tracking-tight">
        {denJoinTitle(outcome)}
      </h1>
      <p className="text-muted-foreground text-sm">
        {denJoinDescription(outcome)}
      </p>
      {/* The member count belongs to a den that resolved. An invalid code carries
          no den at all, so there is nothing to count, and printing one would be
          inventing a fact the client never read. */}
      {outcome.kind === "invalid" ? null : (
        <p className="text-muted-foreground text-xs">
          {denMemberCountLabel(outcome.den.memberCount)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {action ? (
          <Button
            className="rounded-lg text-sm"
            disabled={joining}
            onClick={() => {
              if (outcome.kind === "already-member") {
                handleOpen(outcome.den.id);
                return;
              }
              void handleJoin();
            }}
            type="button"
            variant="premium"
          >
            {joining ? <Loader2 className="size-4 animate-spin" /> : null}
            {action}
          </Button>
        ) : null}
        {/* A full den has nothing to press and nowhere to go, so the only way on
            is back to the reader's own messages. The state is decided from the
            preview's member count rather than from the press, because the join route
            answers a full den with the same 404 as a dead code - see `den-invite.ts`
            for why that identity is the point. */}
        {outcome.kind === "full" ? (
          <span className="text-muted-foreground text-xs">
            Ask whoever invited you to make room.
          </span>
        ) : null}
        {/* The unknown state is the same dead end as the expired one from the
            reader's side - this link is not taking them anywhere - so it gets the
            same single dismissal. An invalid code has no den to name, so there is
            nowhere better to send them and nothing more useful to say. */}
        {outcome.kind === "invalid" ? (
          <Button
            className="rounded-lg text-sm"
            onClick={handleNevermind}
            type="button"
            variant="ghost"
          >
            Nevermind
          </Button>
        ) : (
          <Button asChild className="rounded-lg text-sm" variant="ghost">
            <Link href="/messages">Go to messages</Link>
          </Button>
        )}
      </div>
    </Screen>
  );
}

// A code somebody was given, then had rotated out from under them.
//
// The title and both button labels are verbatim from the product owner. What is NOT
// here is any wording of our own about whose fault the dead code is, and no roster,
// description or avatar: the preview returns four facts and this screen prints the
// two a person can act on.
//
// Exported for the render test, for the same reason `DenJoinFailureScreen` is: which
// state a preview maps to is decided and tested in `den-invite.ts`, while what a
// state SAYS to somebody is decided here, and a screen whose copy is wrong is wrong
// however correctly it was reached.

// The chip at the top of the join screen: the den's own picture when the live code
// carried one, and the caller's icon when it did not.
//
// `unoptimized`, and that is load-bearing rather than a shortcut. The URL is a
// presigned object-storage address on whatever host `ASMOB_ENDPOINT` names, which
// the image optimizer is not configured to fetch, so optimizing it would turn a
// working picture into a 400 and land on the fallback anyway - after a request the
// reader can see failing.
//
// `alt=""` because the heading immediately below names the den in words. The image
// confirms a picture, and the name is the fact; announcing both would read the same
// information twice.
//
// The failed-load state is not paranoia: the URL expires in an hour, and a screen
// left open across that boundary would otherwise draw a broken image.
function JoinScreenIcon({
  avatarUrl,
  fallback,
}: {
  avatarUrl: string | null;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const showPicture = Boolean(avatarUrl) && !failed;
  return (
    <span className="chip-3d flex size-14 items-center justify-center overflow-hidden rounded-2xl">
      {showPicture && avatarUrl ? (
        <Image
          alt=""
          className="size-full object-cover"
          height={56}
          onError={() => {
            setFailed(true);
          }}
          src={avatarUrl}
          unoptimized
          width={56}
        />
      ) : (
        fallback
      )}
    </span>
  );
}

export function DenExpiredScreen({
  asking,
  den,
  onAskOwner,
  onNevermind,
}: {
  asking: boolean;
  den: DenExpiredInvite;
  onAskOwner: (ownerId: string) => void;
  onNevermind: () => void;
}) {
  // Destructured so the narrowing survives into the onClick closure below, which a
  // property read on the parameter would not.
  const { memberCount, ownerId } = den;
  // Degrade rather than offer a button that goes nowhere. `ownerId` is null when the
  // den's owner account has been deleted, which is the one case where "ask the owner"
  // has nobody to ask. The unknown screen is the honest answer there: it says this
  // link does not resolve and offers a way out, where a dead-looking button would
  // claim the den was hiding AND that help was on its way.
  if (!ownerId) {
    return <DenJoinFailureScreen onNevermind={onNevermind} reason="invalid" />;
  }
  return (
    <Screen>
      <span className="chip-3d flex size-14 items-center justify-center rounded-2xl">
        <Ghost aria-hidden className="text-muted-foreground size-6" />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">
        {denJoinTitle({ den, kind: "expired" })}
      </h1>
      <p className="text-muted-foreground text-sm">
        {denJoinDescription({ den, kind: "expired" })}
      </p>
      <p className="text-muted-foreground text-xs">
        {denMemberCountLabel(memberCount)}
      </p>
      {/* Two real buttons rather than a link and a button: the primary has work to do
          before it navigates, and a link cannot. The secondary is `ghost`, the same
          register `den-confirm-dialog.tsx` gives its cancel control. Both carry
          `type="button"`, so neither can submit anything, and neither sits inside a
          form. `denJoinTitle`/`denJoinDescription` are asked for an `expired`
          outcome rather than having their own strings here, so the words on this
          screen cannot drift from the ones the pure module is tested against. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button
          className="rounded-lg text-sm"
          disabled={asking}
          onClick={() => {
            onAskOwner(ownerId);
          }}
          type="button"
          variant="premium"
        >
          {asking ? <Loader2 className="size-4 animate-spin" /> : null}
          {asking ? "Opening…" : "Ask for a new invite"}
        </Button>
        <Button
          className="rounded-lg text-sm"
          onClick={onNevermind}
          type="button"
          variant="ghost"
        >
          Nevermind
        </Button>
      </div>
    </Screen>
  );
}

// Every refused state gets its own words, because none of them is "something went
// wrong". The one that is actionable carries a link to the screen that fixes it,
// and the rest are honest dead ends.
//
// There is no longer a state for "somebody in this den has blocked you". Blocks
// are DM-only, so a den admits regardless of them and the join route cannot
// answer 403; the `unavailable` branch below is where an unexpected status lands.
//
// Exported for the render test: which state a status maps to is decided by
// `denJoinFailure` and tested there, but the WORDS are decided here, and a refusal
// whose copy is wrong is still a wrong refusal.
export function DenJoinFailureScreen({
  onNevermind,
  reason,
}: {
  onNevermind: () => void;
  reason: DenJoinFailure;
}) {
  // The ban, and it is a full screen rather than a line because there is nothing the
  // reader can do here at all. The preview normally catches it before this screen is
  // reached; arriving means a ban landed between the preview and the press.
  if (reason === "banned") {
    return (
      <Screen>
        <span className="chip-3d flex size-14 items-center justify-center rounded-2xl">
          <ShieldAlert aria-hidden className="text-muted-foreground size-6" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">
          {DEN_BAN_JOIN_TITLE}
        </h1>
        <p className="text-muted-foreground text-sm">
          {DEN_BAN_JOIN_DESCRIPTION}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button asChild className="rounded-lg text-sm" variant="premium">
            <Link href="/messages">{DEN_BAN_JOIN_DISMISS}</Link>
          </Button>
        </div>
      </Screen>
    );
  }
  if (reason === "needs-messages") {
    return (
      <Screen>
        <span className="chip-3d flex size-14 items-center justify-center rounded-2xl">
          <Lock aria-hidden className="text-muted-foreground size-6" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">
          Turn on Messages first
        </h1>
        <p className="text-muted-foreground text-sm">
          Joining a den needs a Messages key so you can read it. Opening
          Messages sets one up automatically — it takes a moment, once.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button asChild className="rounded-lg text-sm" variant="premium">
            <Link href="/messages">Enable Messages</Link>
          </Button>
        </div>
      </Screen>
    );
  }
  if (reason === "rate-limited") {
    return (
      <Screen>
        <span className="chip-3d flex size-14 items-center justify-center rounded-2xl">
          <AlertCircle aria-hidden className="text-muted-foreground size-6" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">
          Too many joins just now
        </h1>
        <p className="text-muted-foreground text-sm">
          You are joining dens too quickly. Wait a moment and try this link
          again.
        </p>
      </Screen>
    );
  }
  // `invalid` and `unavailable` share a shape but not a cause: a code that never
  // resolved and a broken network are different things, and telling somebody "we
  // couldn't find that den" for a failed request would be a lie they would act on.
  const invalid = reason === "invalid";
  return (
    <Screen>
      <span className="chip-3d flex size-14 items-center justify-center rounded-2xl">
        <Link2Off aria-hidden className="text-muted-foreground size-6" />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">
        {invalid
          ? denJoinTitle({ kind: "invalid", reason: "unknown-code" })
          : "Couldn't check this link"}
      </h1>
      <p className="text-muted-foreground text-sm">
        {invalid
          ? denJoinDescription({ kind: "invalid", reason: "unknown-code" })
          : "That didn't come back from the server. Try again in a moment."}
      </p>
      {/* One button. A dismissal carries no error semantics - no alert role, no live
          region, nothing assertive - so a screen reader announces it as a button
          rather than as something having gone wrong. It is the same dismissal the
          expired screen offers, because from the reader's side the two states are
          the same thing: this link is not going to take them anywhere. */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        {invalid ? (
          <Button
            className="rounded-lg text-sm"
            onClick={onNevermind}
            type="button"
            variant="ghost"
          >
            Nevermind
          </Button>
        ) : (
          <Button asChild className="rounded-lg text-sm" variant="ghost">
            <Link href="/messages">Go to messages</Link>
          </Button>
        )}
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-border/60 flex min-w-0 flex-1 flex-col bg-[hsl(var(--background-alt))] sm:border-x">
      <div className="flex flex-1 items-center justify-center p-6">
        {/* `panel-3d` with no background utility beside it: the recipe is in
            `@layer components`, so a `bg-*` here would outrank it and the lift
            would silently do nothing. */}
        <div className="panel-3d flex w-full max-w-sm flex-col items-center gap-2 rounded-2xl p-6 text-center">
          {children}
        </div>
      </div>
    </div>
  );
}
