"use client";

import { auraParticles, nextAuraBurstTiming } from "@asm/ui/lib/aura-burst";
import type { AuraBurstTiming } from "@asm/ui/lib/aura-burst";
import { Flame } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

export interface AuraBurstHandle {
  spawn: (x: number, y: number) => void;
}

export function AuraBurstLayer({ ref }: { ref: Ref<AuraBurstHandle> }) {
  const [auraBursts, setAuraBursts] = useState<
    { durationMs: number; id: number; x: number; y: number }[]
  >([]);
  const nextId = useRef(0);
  const timing = useRef<AuraBurstTiming | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();
  useImperativeHandle(
    ref,
    () => ({
      spawn(x, y) {
        nextId.current += 1;
        const id = nextId.current;
        const next = nextAuraBurstTiming(Date.now(), timing.current);
        timing.current = next;
        setAuraBursts((current) => [
          ...current.slice(-6),
          { durationMs: next.durationMs, id, x, y },
        ]);
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(
          () => setAuraBursts([]),
          next.durationMs + 150
        );
      },
    }),
    []
  );
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );
  return (
    <>
      {auraBursts.flatMap((burst) =>
        auraParticles(burst.id).map((particle, index) => (
          <motion.div
            animate={{
              opacity: [0, particle.opacity, particle.opacity, 0],
              transform: reducedMotion
                ? undefined
                : [
                    "translate(0px, 0px) rotate(0deg) scale(0.95)",
                    `translate(${particle.drift * 0.2}px, ${-particle.lift * 0.2}px) rotate(${particle.rotation * 0.2}deg) scale(1.18)`,
                    `translate(${particle.drift}px, ${-particle.lift}px) rotate(${particle.rotation}deg) scale(0.8)`,
                  ],
            }}
            className="pointer-events-none absolute z-10 flex items-center justify-center"
            initial={{ opacity: 0 }}
            key={`${burst.id}-${index}`}
            style={{
              height: particle.size,
              left: burst.x - particle.size / 2,
              top: burst.y - particle.size / 2,
              width: particle.size,
            }}
            transition={{
              duration: burst.durationMs / 1000,
              ease: [0.23, 1, 0.32, 1],
              opacity: {
                duration: burst.durationMs / 1000,
                ease: "linear",
                times: [0, 0.08, 0.72, 1],
              },
            }}
          >
            <Flame
              color={particle.edge}
              fill={particle.fill}
              size={particle.size}
              strokeWidth={1.5}
            />
            <Flame
              className="absolute"
              color={particle.light}
              fill={particle.light}
              size={particle.size * 0.4}
              strokeWidth={1}
              style={{ bottom: particle.size * 0.15 }}
            />
          </motion.div>
        ))
      )}
    </>
  );
}
