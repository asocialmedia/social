import Spinner3D from "@/components/layouts/feedback/spinner-3d";

export default function AuthLoading() {
  return (
    <div className="bg-background fixed inset-0 z-50 flex items-center justify-center">
      <Spinner3D label="Page is loading" className="size-16" />
    </div>
  );
}
