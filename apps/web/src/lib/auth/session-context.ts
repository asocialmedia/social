"use client";

import type { Session, User } from "@asm/auth/core";
import { createContext, useContext } from "react";

export interface SessionContextValue {
  session: Session | null;
  user: User | null;
}
export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  return useContext(SessionContext) ?? { session: null, user: null };
}
