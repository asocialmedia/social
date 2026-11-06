import type { StyleProp, ViewStyle } from "react-native";

import { ZephLoader } from "./zeph-loader";
import type { ZephLoaderVariant } from "./zeph-loader";

export function Spinner3D({
  className,
  size = 56,
  style,
  variant,
}: {
  className?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  variant?: ZephLoaderVariant;
}) {
  return (
    <ZephLoader
      className={className}
      size={size}
      style={style}
      variant={variant}
    />
  );
}
export default Spinner3D;
