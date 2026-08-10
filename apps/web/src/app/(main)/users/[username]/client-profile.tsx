"use client";

import type { UserData } from "@asm/db";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ScrollUpButton from "@/components/layouts/scroll-up-button";
import StickyFooter from "@/components/layouts/stinky-footer";
import ProfileFeedView from "@/components/profile/profile-feed-view";
import LeftSidebar from "@/components/profile/sidebars/profile-left-side-bar";
import RightSidebar from "@/components/profile/sidebars/profile-right-side-bar";

interface ProfilePageProps {
  loggedInUserId: string;
  userData: UserData;
  username: string;
}

const ClientProfile: React.FC<ProfilePageProps> = ({
  username,
  userData,
  loggedInUserId,
}) => {
  const [showLeftSidebar] = useState(true);
  const [showRightSidebar] = useState(true);
  const [isFooterSticky, setIsFooterSticky] = useState(false);
  const [showScrollUpButton, setShowScrollUpButton] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const rightSidebarRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    const scrollThreshold = 200;
    setShowScrollUpButton(window.scrollY > scrollThreshold);

    if (mainRef.current && rightSidebarRef.current) {
      const { top: sidebarTop, height: sidebarHeight } =
        rightSidebarRef.current.getBoundingClientRect();
      setIsFooterSticky(sidebarTop + sidebarHeight <= 0);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1">
        {showLeftSidebar ? <LeftSidebar /> : null}
        <main
          className={`flex-1 overflow-y-auto ${
            showLeftSidebar || showRightSidebar ? "" : "w-full"
          }`}
          ref={mainRef}
        >
          <div className="mx-auto max-w-5xl p-0 md:p-4">
            <ProfileFeedView
              loggedInUserId={loggedInUserId}
              userData={userData}
              username={username}
            />
          </div>
        </main>
        {showRightSidebar ? (
          <div className="relative hidden w-96 bg-[hsl(var(--background-alt))] md:block">
            <div ref={rightSidebarRef}>
              <RightSidebar
                loggedInUserId={loggedInUserId}
                userData={userData}
                username={username}
              />
            </div>
            <div
              className={`transition-all duration-300 ${
                isFooterSticky ? "fixed top-0 right-0 mt-20 w-96" : ""
              }`}
            >
              <StickyFooter />
            </div>
          </div>
        ) : null}
      </div>
      <ScrollUpButton isVisible={showScrollUpButton} />
    </div>
  );
};

export default ClientProfile;
