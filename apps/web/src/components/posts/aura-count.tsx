import type { VoteInfo } from "@asm/db";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@asm/ui/shadui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Flame } from "lucide-react";
import { useEffect, useState } from "react";

import kyInstance from "@/lib/ky";

interface AuraCountProps {
  initialAura: number;
  postId: string;
}

export default function AuraCount({ postId, initialAura }: AuraCountProps) {
  const queryKey = ["vote-info", postId];
  const [localAura, setLocalAura] = useState(initialAura);

  const { data } = useQuery<VoteInfo>({
    enabled: false,
    initialData: { aura: initialAura, userVote: 0 },
    queryFn: () =>
      kyInstance.get(`/api/posts/${postId}/votes`).json<VoteInfo>(),
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (data) {
      // eslint-disable-next-line react-compiler -- sync aura count with the server value
      setLocalAura(data.aura);
    }
  }, [data]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <div className="text-foreground mb-2 flex items-center text-lg font-semibold">
            <Flame className="mr-1 h-5 w-5 text-orange-500" />
            <span>{localAura}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Aura</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
