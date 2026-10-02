"use client";

import { Button } from "@asm/ui/shadui/button";
import { AlertCircle, Link2Off, Loader2, Lock, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  MessagesApiError,
  fetchDenInvitePreview,
  joinDen,
} from "@/lib/messages/client";
import type { DenInvitePreviewResponse } from "@/lib/messages/client";
import {
  denJoinActionLabel,
  denJoinDescription,
  denJoinFailure,
  denJoinOutcome,
  denJoinTitle,
} from "@/lib/messages/den-invite";
import type { DenJoinFailure } from "@/lib/messages/den-invite";
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
// The three states are decided in `den-invite.ts` (pure, unit-tested) and this
// component only draws them.

type ScreenState =
  | { kind: "loading" }
  | { kind: "ready"; preview: DenInvitePreviewResponse | null }
  | { kind: "failed"; reason: DenJoinFailure };

export default function ClientJoinDen({ code }: { code: string }) {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [joining, setJoining] = useState(false);

  // The preview read. A 404 is not an error state to render raw: the route answers
  // it for a code that never existed and for one that was rotated, and those are
  // the same thing to the person holding the link.
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
        setState({ kind: "ready", preview });
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
    return <DenJoinFailureScreen reason={state.reason} />;
  }

  // The pure decision, from the preview. A null preview is the invalid state, so
  // the screen never has to invent a second way to be told the code is dead.
  const outcome = denJoinOutcome({ preview: state.preview });
  const action = denJoinActionLabel(outcome, joining);

  return (
    <Screen>
      <span className="chip-3d flex size-14 items-center justify-center rounded-2xl">
        {outcome.kind === "full" ? (
          <Users aria-hidden className="text-muted-foreground size-6" />
        ) : (
          <Link2Off aria-hidden className="text-muted-foreground size-6" />
        )}
      </span>
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
            is back to the reader's own messages. A 404 is the same shape: the
            route answers a retired code and a den that filled up identically,
            and the screen says the union of both. */}
        {outcome.kind === "full" ? (
          <span className="text-muted-foreground text-xs">
            Ask whoever invited you to make room.
          </span>
        ) : null}
        <Button asChild className="rounded-lg text-sm" variant="ghost">
          <Link href="/messages">Go to messages</Link>
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
// `denJoinFailure` and tested there, but the WORDS are decided here, and a
// refusal whose copy is wrong is still a wrong refusal - a "this link is not
// valid" screen for a real link sends the reader to ask for a new code that
// cannot help.
export function DenJoinFailureScreen({ reason }: { reason: DenJoinFailure }) {
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
  // `invalid` and `unavailable` share a shape but not a cause: a retired code and a
  // broken network are different things, and saying "this link is not valid" for a
  // failed request would be a lie.
  const invalid = reason === "invalid";
  return (
    <Screen>
      <span className="chip-3d flex size-14 items-center justify-center rounded-2xl">
        <Link2Off aria-hidden className="text-muted-foreground size-6" />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">
        {invalid ? "This link is not valid" : "Couldn't check this link"}
      </h1>
      <p className="text-muted-foreground text-sm">
        {invalid
          ? "The join code has been retired, or the link was cut short. Ask whoever shared it for a new one."
          : "That didn't come back from the server. Try again in a moment."}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button asChild className="rounded-lg text-sm" variant="ghost">
          <Link href="/messages">Go to messages</Link>
        </Button>
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
