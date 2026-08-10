import { useQuery } from "@tanstack/react-query";
import type { FollowerInfo, UserData } from "@asm/db";
import kyInstance from "@/lib/ky";

export default function useFollowerInfo(
  userId: string,
  initialState: FollowerInfo
) {
  const query = useQuery({
    queryKey: ["follower-info", userId],
    queryFn: () =>
      kyInstance.get(`/api/users/${userId}/followers`).json<FollowerInfo>(),
    initialData: initialState,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return query;
}

export function useFollowedUsers() {
  return useQuery({
    queryKey: ["followed-users"],
    queryFn: () => kyInstance.get("/api/users/followed").json<UserData[]>(),
  });
}
