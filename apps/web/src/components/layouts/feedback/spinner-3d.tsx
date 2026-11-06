import { ZephLoader } from "./zeph-loader";
import type { ZephLoaderVariant } from "./zeph-loader";

export default function Spinner3D({
  className,
  variant,
}: {
  className?: string;
  variant?: ZephLoaderVariant;
}) {
  return (
    <ZephLoader
      className={className}
      size={className ? undefined : 56}
      variant={variant}
    />
  );
}
