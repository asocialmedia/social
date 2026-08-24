"use client";

import type * as React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface VerificationContextType {
  isVerifying: boolean;
  setIsVerifying: (state: boolean) => void;
  verificationChannel: BroadcastChannel | null;
}

const VerificationContext = createContext<VerificationContextType | undefined>(
  undefined
);

export const VerificationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationChannel, setVerificationChannel] =
    useState<BroadcastChannel | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel("email-verification");
    // oxlint-disable-next-line react/set-state-in-effect -- the channel is only available client-side after mount
    setVerificationChannel(channel);

    return () => {
      channel.close();
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      isVerifying,
      setIsVerifying,
      verificationChannel,
    }),
    [isVerifying, setIsVerifying, verificationChannel]
  );

  return (
    <VerificationContext.Provider value={contextValue}>
      {children}
    </VerificationContext.Provider>
  );
};

export const useVerification = () => {
  const context = useContext(VerificationContext);
  if (!context) {
    throw new Error(
      "useVerification must be used within a VerificationProvider"
    );
  }
  return context;
};
