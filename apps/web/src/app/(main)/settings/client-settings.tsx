"use client";

import type { UserData } from "@asm/db";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@asm/ui/shadui/tabs";
import { motion } from "motion/react";
import { FossBanner } from "@/components/misc/foss-banner";
import { LegalLinksCard } from "@/components/misc/legal-links-card";
import AccountSettings from "./tabs/account-settings";
import ProfileSettings from "./tabs/profile-settings";
import SecuritySettings from "./tabs/security-settings";

interface ClientSettingsProps {
  user: UserData;
}

export default function ClientSettings({ user }: ClientSettingsProps) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] w-full items-start justify-center">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="container max-w-4xl px-4 py-8 md:px-8 md:py-12 lg:py-16"
        initial={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="mb-10 bg-gradient-to-r from-primary to-secondary bg-clip-text text-center font-bold text-2xl text-transparent md:text-3xl lg:text-4xl">
          Settings
        </h1>

        <div className="relative mx-auto rounded-xl border border-border/50 bg-background/30 p-4 shadow-lg backdrop-blur-lg sm:p-6">
          <Tabs className="w-full" defaultValue="profile">
            <TabsList className="mb-6 w-full justify-start bg-background/50 backdrop-blur-md">
              <TabsTrigger
                className="data-[state=active]:bg-primary/20"
                value="profile"
              >
                Profile
              </TabsTrigger>
              <TabsTrigger
                className="data-[state=active]:bg-primary/20"
                value="account"
              >
                Account
              </TabsTrigger>
              <TabsTrigger
                className="data-[state=active]:bg-primary/20"
                value="security"
              >
                Security
              </TabsTrigger>
            </TabsList>

            <div className="mt-6 space-y-6">
              <TabsContent
                className="focus-visible:outline-none"
                value="profile"
              >
                <motion.div
                  animate={{ opacity: 1, x: 0 }}
                  initial={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <ProfileSettings user={user} />
                </motion.div>
              </TabsContent>

              <TabsContent
                className="focus-visible:outline-none"
                value="account"
              >
                <motion.div
                  animate={{ opacity: 1, x: 0 }}
                  initial={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <AccountSettings user={user} />
                </motion.div>
              </TabsContent>

              <TabsContent
                className="focus-visible:outline-none"
                value="security"
              >
                <motion.div
                  animate={{ opacity: 1, x: 0 }}
                  initial={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <SecuritySettings user={user} />
                </motion.div>
              </TabsContent>
            </div>
          </Tabs>

          <LegalLinksCard className="mt-8" />
          <FossBanner className="mt-8" />

          {/* Background gradient effect */}
          <div className="absolute inset-0 -z-10 rounded-xl bg-gradient-to-br from-primary/5 via-secondary/5 to-background blur-3xl" />
        </div>
      </motion.div>
    </div>
  );
}
