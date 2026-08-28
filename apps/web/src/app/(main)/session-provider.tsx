"use client";

import type { Session, User } from "@asm/auth/core";
import type React from "react";
import { createContext, useContext } from "react";

// oxlint-disable-next-line no-redeclare -- context idiom: type shares its name with the runtime context
interface SessionContext {
  session: Session | null;
  user: User | null;
}

const SessionContext = createContext<SessionContext | null>(null);

export default function SessionProvider({
  children,
  value,
}: React.PropsWithChildren<{ value: SessionContext | null }>) {
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContext {
  const context = useContext(SessionContext);
  if (!context) {
    // Guests browse without a session; every consumer must handle a null user.
    return { session: null, user: null };
  }
  return context;
}
