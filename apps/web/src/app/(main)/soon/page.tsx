import { Button } from "@asm/ui/shadui/button";
import errorImage from "@assets/general/error.png";
import Link from "next/link";
import { StatusScreen } from "@/components/layouts/status-screen";

export const metadata = {
  title: "Coming Soon",
  description: "This feature is under development.",
};

export default function ComingSoonPage() {
  return (
    <StatusScreen
      action={
        <Button asChild variant="premium">
          <Link href="/">Back Home</Link>
        </Button>
      }
      description="This feature is still under development. Check back later."
      image={errorImage}
      minHeight="min-h-[60vh]"
      title="Coming Soon"
    />
  );
}
