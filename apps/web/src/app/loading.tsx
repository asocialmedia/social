import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";

export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <CenteredLogoLoader size={64} />
    </div>
  );
}
