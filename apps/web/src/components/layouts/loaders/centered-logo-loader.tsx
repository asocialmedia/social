import { ZephLoader } from "../feedback/zeph-loader";
import type { ZephLoaderVariant } from "../feedback/zeph-loader";

export const CenteredLogoLoader = ({
  size = 80,
  variant = "general",
}: {
  size?: number;
  variant?: ZephLoaderVariant;
}) => (
  <div className="flex w-full items-center justify-center py-16">
    <ZephLoader label="Loading page" size={size} variant={variant} />
  </div>
);
