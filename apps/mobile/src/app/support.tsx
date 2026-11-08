// Public support route: the same 3-step ticket form as the auth-scoped help
// screen, reachable at /support like web's (docs)/support page (and at
// asocialmedia://support).
import HelpScreen from "@/features/auth/components/help-screen";

export default function SupportRoute() {
  return <HelpScreen />;
}
