import { cn } from "@/lib/utils";

// A bespoke 3D spinner with an apple-like solid material: a single self-colored
// raised ring (bright top lip, recessed inner shadow, tight ring) with an
// orange conic arc sweeping around it. No gradients on the base and no glow
// bloom - the depth comes from the inset highlight/shadow on the solid track,
// so the motion is unmistakable and the material reads as one physical object.
const Spinner3D: React.FC<{
  className?: string;
}> = ({ className }) => (
  <div
    aria-label="Loading"
    aria-live="polite"
    className={cn("relative size-14 shrink-0", className)}
    role="status" // eslint-disable-line jsx-a11y/prefer-tag-over-role -- role=status is the live-region pattern for a spinner; no semantic tag fits
  >
    {/* Solid 3D track: raised ring with a bright top lip and recessed inner
        shadow, matching the app's material language */}
    <div className="absolute inset-0 rounded-full bg-[#3a3f4a] mask-[radial-gradient(closest-side,transparent_76%,black_78%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),inset_0_1.5px_2px_rgba(255,255,255,0.28),inset_0_-2px_4px_rgba(0,0,0,0.4),0_0_0_1px_rgba(0,0,0,0.6),0_2px_6px_rgba(0,0,0,0.35)]" />

    {/* Rotating orange arc, masked into a ring */}
    <div className="absolute inset-0 animate-spin [animation-duration:1.1s]">
      <div className="h-full w-full rounded-full mask-[radial-gradient(closest-side,transparent_76%,black_78%)] [background:conic-gradient(from_0deg,transparent_0deg,transparent_72deg,#ff9500_140deg,#e65500_300deg,transparent_360deg)]" />
    </div>
  </div>
);

export default Spinner3D;
