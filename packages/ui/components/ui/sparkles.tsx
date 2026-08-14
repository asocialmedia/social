"use client";
import type { Container, SingleOrMultiple } from "@tsparticles/engine";
import { Particles, ParticlesProvider } from "@tsparticles/react";
import type { ParticlesPluginRegistrar } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import { motion, useAnimation } from "motion/react";
import { useId } from "react";

import { cn } from "../../lib/utils";

const initParticlesEngine: ParticlesPluginRegistrar = async (engine) => {
  await loadSlim(engine);
};

interface ParticlesProps {
  background?: string;
  className?: string;
  id?: string;
  maxSize?: number;
  minSize?: number;
  particleColor?: string;
  particleDensity?: number;
  particleSize?: number;
  speed?: number;
}
export const SparklesCore = (props: ParticlesProps) => {
  const {
    id,
    className,
    background,
    minSize,
    maxSize,
    speed,
    particleColor,
    particleDensity,
  } = props;
  const controls = useAnimation();

  const particlesLoaded = (container?: Container) => {
    if (container) {
      controls.start({
        opacity: 1,
        transition: {
          duration: 1,
        },
      });
    }
  };

  const generatedId = useId();
  return (
    <ParticlesProvider init={initParticlesEngine}>
      <motion.div animate={controls} className={cn("opacity-0", className)}>
        <Particles
          className={cn("h-full w-full")}
          id={id || generatedId}
          options={{
            background: {
              color: {
                value: background || "#0d47a1",
              },
            },
            detectRetina: true,

            fpsLimit: 120,
            fullScreen: {
              enable: false,
              zIndex: 1,
            },
            interactivity: {
              events: {
                onClick: {
                  enable: true,
                  mode: "push",
                },
                onHover: {
                  enable: false,
                  mode: "repulse",
                },
                // eslint-disable-next-line no-explicit-any -- tsparticles event types are inaccurate here
                resize: true as any,
              },
              modes: {
                push: {
                  quantity: 4,
                },
                repulse: {
                  distance: 200,
                  duration: 0.4,
                },
              },
            },
            particles: {
              bounce: {
                horizontal: {
                  value: 1,
                },
                vertical: {
                  value: 1,
                },
              },
              collisions: {
                absorb: {
                  speed: 2,
                },
                bounce: {
                  horizontal: {
                    value: 1,
                  },
                  vertical: {
                    value: 1,
                  },
                },
                enable: false,
                maxSpeed: 50,
                mode: "bounce",
                overlap: {
                  enable: true,
                  retries: 0,
                },
              },
              color: {
                animation: {
                  h: {
                    count: 0,
                    decay: 0,
                    delay: 0,
                    enable: false,
                    offset: 0,
                    speed: 1,
                    sync: true,
                  },
                  l: {
                    count: 0,
                    decay: 0,
                    delay: 0,
                    enable: false,
                    offset: 0,
                    speed: 1,
                    sync: true,
                  },
                  s: {
                    count: 0,
                    decay: 0,
                    delay: 0,
                    enable: false,
                    offset: 0,
                    speed: 1,
                    sync: true,
                  },
                },
                value: particleColor || "#ffffff",
              },
              destroy: {
                bounds: {},
                mode: "none",
                split: {
                  count: 1,
                  factor: {
                    value: 3,
                  },
                  rate: {
                    value: {
                      max: 9,
                      min: 4,
                    },
                  },
                  sizeOffset: true,
                },
              },
              effect: {
                close: true,
                options: {},
                type: {} as SingleOrMultiple<string> | undefined,
              },
              groups: {},
              life: {
                count: 0,
                delay: {
                  sync: false,
                  value: 0,
                },
                duration: {
                  sync: false,
                  value: 0,
                },
              },
              links: {
                blink: false,
                color: {
                  value: "#fff",
                },
                consent: false,
                distance: 100,
                enable: false,
                frequency: 1,
                opacity: 1,
                shadow: {
                  blur: 5,
                  color: {
                    value: "#000",
                  },
                  enable: false,
                },
                triangles: {
                  enable: false,
                  frequency: 1,
                },
                warp: false,
                width: 1,
              },
              move: {
                angle: {
                  offset: 0,
                  value: 90,
                },
                center: {
                  mode: "percent",
                  radius: 0,
                  x: 50,
                  y: 50,
                },
                decay: 0,
                direction: "none",
                distance: {},
                drift: 0,
                enable: true,
                gravity: {
                  acceleration: 9.81,
                  enable: false,
                  inverse: false,
                  maxSpeed: 50,
                },
                outModes: {
                  default: "out",
                },
                path: {
                  clamp: true,
                  delay: {
                    value: 0,
                  },
                  enable: false,
                  options: {},
                },
                random: false,
                size: false,
                speed: {
                  max: 1,
                  min: 0.1,
                },
                spin: {
                  acceleration: 0,
                  enable: false,
                },
                straight: false,
                vibrate: false,
                warp: false,
              },
              number: {
                density: {
                  enable: true,
                  height: 400,
                  width: 400,
                },
                limit: {
                  mode: "delete",
                  value: 0,
                },
                value: particleDensity || 120,
              },
              opacity: {
                animation: {
                  count: 0,
                  decay: 0,
                  delay: 0,
                  destroy: "none",
                  enable: true,
                  mode: "auto",
                  speed: speed || 4,
                  startValue: "random",
                  sync: false,
                },
                value: {
                  max: 1,
                  min: 0.1,
                },
              },
              orbit: {
                animation: {
                  count: 0,
                  decay: 0,
                  delay: 0,
                  enable: false,
                  speed: 1,
                  sync: false,
                },
                enable: false,
                opacity: 1,
                rotation: {
                  value: 45,
                },
                width: 1,
              },
              reduceDuplicates: false,
              repulse: {
                distance: 1,
                duration: 1,
                enabled: false,
                factor: 1,
                speed: 1,
                value: 0,
              },
              roll: {
                darken: {
                  enable: false,
                  value: 0,
                },
                enable: false,
                enlighten: {
                  enable: false,
                  value: 0,
                },
                mode: "vertical",
                speed: 25,
              },
              rotate: {
                animation: {
                  decay: 0,
                  enable: false,
                  speed: 0,
                  sync: false,
                },
                direction: "clockwise",
                path: false,
                value: 0,
              },
              shadow: {
                blur: 0,
                color: {
                  value: "#000",
                },
                enable: false,
                offset: {
                  x: 0,
                  y: 0,
                },
              },
              shape: {
                close: true,
                options: {},
                type: "circle",
              },
              size: {
                animation: {
                  count: 0,
                  decay: 0,
                  delay: 0,
                  destroy: "none",
                  enable: false,
                  mode: "auto",
                  speed: 5,
                  startValue: "random",
                  sync: false,
                },
                value: {
                  max: maxSize || 3,
                  min: minSize || 1,
                },
              },
              stroke: {
                width: 0,
              },
              tilt: {
                animation: {
                  decay: 0,
                  enable: false,
                  speed: 0,
                  sync: false,
                },
                direction: "clockwise",
                enable: false,
                value: 0,
              },
              twinkle: {
                lines: {
                  enable: false,
                  frequency: 0.05,
                  opacity: 1,
                },
                particles: {
                  enable: false,
                  frequency: 0.05,
                  opacity: 1,
                },
              },
              wobble: {
                distance: 5,
                enable: false,
                speed: {
                  angle: 50,
                  move: 10,
                },
              },
              zIndex: {
                opacityRate: 1,
                sizeRate: 1,
                value: 0,
                velocityRate: 1,
              },
            },
          }}
          particlesLoaded={particlesLoaded}
        />
      </motion.div>
    </ParticlesProvider>
  );
};
