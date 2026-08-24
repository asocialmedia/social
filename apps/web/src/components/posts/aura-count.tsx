import type { VoteInfo } from "@asm/db";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";

import kyInstance from "@/lib/ky";
import { cn } from "@/lib/utils";

interface AuraCountProps {
  initialAura: number;
  postId: string;
}

export default function AuraCount({ postId, initialAura }: AuraCountProps) {
  const queryKey = ["vote-info", postId];

  const { data } = useQuery<VoteInfo>({
    enabled: false,
    initialData: { aura: initialAura, userVote: 0 },
    queryFn: () =>
      kyInstance.get(`/api/posts/${postId}/votes`).json<VoteInfo>(),
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // The count always mirrors the shared vote cache (seeded with initialAura);
  // deriving it directly avoids a cascading render from a mirror effect.
  const aura = data ? data.aura : initialAura;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className="text-foreground mb-2 flex items-center text-lg font-semibold">
            <Flame
              className={cn(
                "mr-1 h-5 w-5",
                aura < 0 ? "text-[#7c5cff]" : "text-orange-500"
              )}
            />
            <span>{aura}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Aura</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
