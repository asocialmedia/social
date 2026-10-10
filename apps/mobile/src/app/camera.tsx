// Full-screen camera route. Presented like gusts: fade from bottom over a
// black base, header hidden, unmounted on blur so the session never leaks.
import { CameraScreen } from "@/features/camera/components/camera-screen";

export default function CameraRoute() {
  return <CameraScreen />;
}
