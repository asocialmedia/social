"use client";

import { clientLog } from "@asm/config/debug";
import type { CommunityData } from "@asm/db";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { useToast } from "@/lib/gooey-toast";

import {
  approveMember,
  createCommunity,
  joinCommunity,
  leaveCommunity,
  setMemberRole,
} from "./actions";

// Community mutations. Each one refreshes the community caches and the global
// feeds, because joining changes the sidebar rail and publishing changes the
// discovery ordering.
export function useCreateCommunityMutation() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: unknown) => createCommunity(input),
    onError(error) {
      clientLog.error("Community creation error:", error);
      toast({
        description:
          error instanceof Error
            ? error.message
            : "Couldn't create that community, try again?",
        variant: "destructive",
      });
    },
    onSuccess: (community: CommunityData) => {
      queryClient.invalidateQueries({ queryKey: ["communities"] });
      queryClient.invalidateQueries({ queryKey: ["community-joined"] });
      // The account now owns one more community, so the sidebar's aura ladder
      // is stale (its "next needs" tier advances).
      queryClient.invalidateQueries({ queryKey: ["community-creation-quota"] });
      toast({ description: `a/${community.slug} is live`, title: "Created" });
      router.push(`/a/${community.slug}`);
    },
  });
}

export function useJoinCommunityMutation(slug: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (communityId: string) => joinCommunity(communityId),
    onError(error) {
      clientLog.error("Community join error:", error);
      toast({
        description: "Couldn't join, try again?",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", slug] });
      queryClient.invalidateQueries({ queryKey: ["community-joined"] });
      queryClient.invalidateQueries({ queryKey: ["communities"] });
      toast({ description: "You're in", title: "Joined" });
    },
  });
}

export function useLeaveCommunityMutation(slug: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (communityId: string) => leaveCommunity(communityId),
    onError(error) {
      clientLog.error("Community leave error:", error);
      toast({
        description: "Couldn't leave, try again?",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", slug] });
      queryClient.invalidateQueries({ queryKey: ["community-joined"] });
      queryClient.invalidateQueries({ queryKey: ["communities"] });
      toast({ description: "You left the community", title: "Left" });
    },
  });
}

export function useApproveMemberMutation(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      communityId,
      userId,
    }: {
      communityId: string;
      userId: string;
    }) => approveMember(communityId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-members", slug] });
    },
  });
}

export function useSetMemberRoleMutation(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      communityId,
      role,
      userId,
    }: {
      communityId: string;
      role: "MODERATOR" | "MEMBER";
      userId: string;
    }) => setMemberRole(communityId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-members", slug] });
    },
  });
}
