import type { UserData } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

interface MentionedUsersResponse {
  users: (UserData & {
    _count: {
      mentions: number;
    };
  })[];
}

export function useMentionedUsers() {
  const { data, isLoading } = useQuery<MentionedUsersResponse>({
    queryFn: async () => {
      const res = await fetch("/api/users/mentioned");
      if (!res.ok) {
        throw new Error("Failed to fetch mentioned users");
      }
      return res.json();
    },
    queryKey: ["mentionedUsers"],
    staleTime: 1000 * 60 * 5,
  });

  return {
    isLoading,
    mentionedUsers: data?.users ?? [],
  };
}
