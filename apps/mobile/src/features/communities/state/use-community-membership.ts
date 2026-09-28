// Native counterpart of web's `communities/mutations.ts` join/leave and
// subscription hooks. One holder for the membership state so the Join pill, the
// notify bell and the roster's moderation affordances cannot disagree: a join
// here is the single write every control reads back.
//
// Mirrors the web behaviour exactly, including the toast copy and the
// install-token retry. The one addition is the visit ping, which web fires from
// its server-rendered page; native has no such render, so the detail screen
// records the visit on open instead.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "@/components/feedback/toast";
import { authClient } from "@/features/auth/lib/auth-client";
import { useInstall } from "@/features/auth/state/install";
import { getApiBaseUrl } from "@/lib/api-env";

import {
  joinCommunity,
  leaveCommunity,
  setCommunitySubscription,
} from "../lib/communities-api";
import type { CommunityMembershipState } from "../lib/communities-api";

type Membership = { role: string; status: string } | null;

export interface CommunityMembership {
  canModerate: boolean;
  isOwner: boolean;
  membership: Membership;
  pending: boolean;
  requireLogin: () => void;
  setSubscribed: (next: boolean) => Promise<void>;
  subscribed: boolean;
  toggle: () => Promise<void>;
}

// Everything the controls read, stamped with the slug it belongs to. Carrying
// the slug inside the snapshot is what lets a community-to-community navigation
// reset cleanly by derivation, with no ref read during render and no effect that
// re-derives state the component already has.
interface Snapshot {
  canModerate: boolean;
  membership: Membership;
  slug: string;
  subscribed: boolean;
}

export function useCommunityMembership({
  initialMembership,
  isLoggedIn,
  slug,
}: {
  initialMembership: Membership;
  isLoggedIn: boolean;
  slug: string;
}): CommunityMembership {
  const router = useRouter();
  const { runWithInstallToken } = useInstall();
  const [pending, setPending] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    canModerate: false,
    membership: initialMembership,
    slug,
    subscribed: false,
  }));

  // A different community means every mirrored value is stale, so fall back to
  // this slug's fresh initial state until the membership read lands.
  const current = useMemo<Snapshot>(
    () =>
      snapshot.slug === slug
        ? snapshot
        : {
            canModerate: false,
            membership: initialMembership,
            slug,
            subscribed: false,
          },
    [initialMembership, slug, snapshot]
  );

  // The same fallback, held in a ref so `patch` can keep a stable identity.
  // Closing over `current` instead would make `patch` a function of the
  // snapshot it writes, and the membership read below is keyed on `patch`: one
  // response would change the identity, re-arm the effect, and keep the screen
  // requesting membership for as long as it stayed open.
  const freshRef = useRef<Snapshot>({
    canModerate: false,
    membership: initialMembership,
    slug,
    subscribed: false,
  });
  useEffect(() => {
    freshRef.current = {
      canModerate: false,
      membership: initialMembership,
      slug,
      subscribed: false,
    };
  }, [initialMembership, slug]);

  // Only the slug is read here, and the base is derived inside the updater, so a
  // write is always applied to the snapshot for the community the caller is
  // looking at even if it lands after a navigation.
  const patch = useCallback(
    (next: Partial<Snapshot>) => {
      setSnapshot((value) => ({
        ...(value.slug === slug ? value : freshRef.current),
        ...next,
      }));
    },
    [slug]
  );

  const options = useCallback(
    async () => ({
      apiBase: getApiBaseUrl(),
      cookie: await authClient.getCookie(),
    }),
    []
  );

  const requireLogin = useCallback(() => {
    toast({ description: "Sign in to do that", title: "Members only" });
    router.push("/(auth)/login");
  }, [router]);

  // Seed the bell and the moderation flag from the dedicated membership read.
  // Without it the bell would sit at "off" until the first write, and a
  // moderator would not know they can moderate.
  //
  // One read per viewer and community, and nothing else: the response only
  // writes the snapshot, so every dependency here has to be an input to the
  // request rather than something the response changes.
  useEffect(() => {
    if (!isLoggedIn) {
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `${getApiBaseUrl()}/api/communities/${encodeURIComponent(slug)}/membership`,
          { headers: { cookie: await authClient.getCookie() } }
        );
        if (!response.ok || !active) {
          return;
        }
        const state = (await response.json()) as CommunityMembershipState;
        if (!active) {
          return;
        }
        patch({
          canModerate: state.canModerate,
          membership: state.membership,
          subscribed: state.subscribed,
        });
      } catch {
        // A failed bell sync is not worth a toast; the control stays usable and
        // the next write reconciles it.
      }
    })();
    return () => {
      active = false;
    };
  }, [isLoggedIn, patch, slug]);

  const toggle = useCallback(async () => {
    if (!isLoggedIn) {
      requireLogin();
      return;
    }
    if (pending) {
      return;
    }
    setPending(true);
    const wasActive = current.membership?.status === "ACTIVE";
    // Optimistic mirror, like the web JoinButton's local state, so the control
    // flips the instant it is tapped rather than after the round trip.
    const optimistic: Membership = wasActive
      ? null
      : { role: "PARTICIPANT", status: "ACTIVE" };
    patch({ membership: optimistic });

    let result: Awaited<ReturnType<typeof joinCommunity>> | null = null;
    try {
      result = await runWithInstallToken(
        async () =>
          wasActive
            ? leaveCommunity(slug, await options())
            : joinCommunity(slug, await options()),
        (value) => value?.kind === "install-token-required"
      );
    } catch {
      result = null;
    }
    setPending(false);

    // Anything other than a success (a real error, or the user dismissing the
    // install gate) rolls the optimistic mirror back to what it was.
    if (result === null || result.kind !== "success") {
      patch({ membership: current.membership });
      if (result?.kind === "error") {
        toast({
          description: wasActive
            ? "Couldn't leave, try again?"
            : "Couldn't join, try again?",
          title: "That didn't work",
          variant: "destructive",
        });
      }
      return;
    }

    patch({
      canModerate: result.state.canModerate,
      membership: result.state.membership,
    });
    if (wasActive) {
      toast({ description: "You left the community", title: "Left" });
      return;
    }
    // A PENDING membership is an honest "Requested", not a failure.
    const requested = result.state.status === "PENDING";
    toast({
      description: requested
        ? "You'll join once a moderator approves"
        : "You're in",
      title: requested ? "Requested" : "Joined",
    });
  }, [
    current.membership,
    isLoggedIn,
    options,
    patch,
    pending,
    requireLogin,
    runWithInstallToken,
    slug,
  ]);

  const setSubscribed = useCallback(
    async (next: boolean) => {
      if (!isLoggedIn) {
        requireLogin();
        return;
      }
      patch({ subscribed: next });
      let result: Awaited<ReturnType<typeof setCommunitySubscription>> | null =
        null;
      try {
        result = await runWithInstallToken(
          async () => setCommunitySubscription(slug, next, await options()),
          (value) => value?.kind === "install-token-required"
        );
      } catch {
        result = null;
      }
      if (result === null || result.kind !== "success") {
        patch({ subscribed: !next });
        if (result?.kind === "error") {
          toast({
            description: "Couldn't update notifications, try again?",
            title: "That didn't work",
            variant: "destructive",
          });
        }
      }
    },
    [isLoggedIn, options, patch, requireLogin, runWithInstallToken, slug]
  );

  return {
    canModerate: current.canModerate,
    isOwner:
      current.membership?.role === "OWNER" &&
      current.membership?.status === "ACTIVE",
    membership: current.membership,
    pending,
    requireLogin,
    setSubscribed,
    subscribed: current.subscribed,
    toggle,
  };
}
