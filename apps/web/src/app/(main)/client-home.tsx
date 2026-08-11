"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import FollowingFeed from "@/components/home/feedview/following";
import ForYouFeed from "@/components/home/for-you-feed";
import PostEditor from "@/components/posts/editor/post-editor";

interface ClientHomeProps {
  userData: UserData;
}

type FeedTab = "for-you" | "following";

const ClientHome: React.FC<ClientHomeProps> = ({ userData }) => {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<FeedTab>(() =>
    searchParams.get("tab") === "following" ? "following" : "for-you"
  );

  useEffect(() => {
    const fromUrl = searchParams.get("tab");
    if (fromUrl === "following" || fromUrl === "for-you") {
      setTab(fromUrl);
    }
  }, [searchParams]);

  const handleTabChange = useCallback((value: string) => {
    setTab(value as FeedTab);
  }, []);

  if (!userData) {
    return null;
  }

  return (
    <div className="mx-auto flex min-h-screen w-[65%] min-w-[22rem] max-w-3xl flex-col border-border/40 border-x bg-[hsl(var(--background-alt))]">
      <Tabs onValueChange={handleTabChange} value={tab}>
        <div className="sticky top-0 z-20 border-border/40 border-b bg-[hsl(var(--background-alt))]/90 backdrop-blur-md">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-0 bg-transparent p-0">
            <TabsTrigger
              className="rounded-none border-transparent border-b-2 py-4 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
              value="for-you"
            >
              Global
            </TabsTrigger>
            <TabsTrigger
              className="rounded-none border-transparent border-b-2 py-4 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
              value="following"
            >
              Following
            </TabsTrigger>
          </TabsList>
        </div>

        <PostEditor />

        <TabsContent className="mt-0" value="for-you">
          <ForYouFeed />
        </TabsContent>

        <TabsContent className="mt-0" value="following">
          <FollowingFeed />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ClientHome;
