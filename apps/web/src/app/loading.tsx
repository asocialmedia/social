import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";

export default function Loading() {
  return (
    <div
      aria-label="Page is loading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      role="status"
    >
      <CenteredLogoLoader size={64} />
    </div>
  );
}
