import { CenteredLogoLoader } from "@/components/layouts/loaders/centered-logo-loader";

export default function Loading() {
  return (
    <output
      aria-label="Page is loading"
      className="bg-background fixed inset-0 z-50 flex items-center justify-center"
    >
      <CenteredLogoLoader size={64} />
    </output>
  );
}
