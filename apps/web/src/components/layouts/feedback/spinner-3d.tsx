import { cn } from "@/lib/utils";

// Raised solid ring and an orange arc, shared by navigation and media buffering.
const Spinner3D = ({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}) => (
  <output
    aria-label={label}
    aria-busy="true"
    className={cn("relative inline-block size-14 shrink-0", className)}
  >
    <span className="absolute inset-0 rounded-full bg-[#3a3f4a] mask-[radial-gradient(closest-side,transparent_76%,black_78%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),inset_0_1px_2px_rgba(255,255,255,0.28),inset_0_-2px_4px_rgba(0,0,0,0.4),0_0_0_1px_rgba(0,0,0,0.6),0_2px_6px_rgba(0,0,0,0.35)]" />
    <span className="absolute inset-0 animate-spin [animation-duration:1.1s] motion-reduce:animate-none">
      <span className="block h-full w-full rounded-full mask-[radial-gradient(closest-side,transparent_76%,black_78%)] [background:conic-gradient(from_0deg,transparent_0deg,transparent_72deg,#ff9500_140deg,#e65500_300deg,transparent_360deg)]" />
    </span>
  </output>
);

export default Spinner3D;
