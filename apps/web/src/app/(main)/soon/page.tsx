import { Button } from "@asm/ui/shadui/button";
import Link from "next/link";

export const metadata = {
  title: "Coming Soon",
  description: "This feature is under development.",
};

export default function ComingSoonPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-semibold text-2xl">Coming Soon</h1>
      <p className="max-w-sm text-muted-foreground text-sm">
        This feature is still under development. Check back later.
      </p>
      <Button asChild variant="premium">
        <Link href="/">Back Home</Link>
      </Button>
    </div>
  );
}
