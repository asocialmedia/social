import type { auth } from "./configuration/config";

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;

export interface AuthContext {
  session: Session | null;
  user: User | null;
}
