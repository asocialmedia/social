import { Button } from "@asm/ui/shadui/button";
import Link from "next/link";
import { StatusScreen } from "@/components/layouts/status-screen";

export default function NotFound() {
  return (
    <StatusScreen
      action={
        <Button asChild variant="premium">
          <Link href="/">Return Home</Link>
        </Button>
      }
      description="The page you're looking for doesn't exist or has been moved."
      title="Page not found"
    />
  );
}
