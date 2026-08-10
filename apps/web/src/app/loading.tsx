"use client";

import { GooeyText } from "@asm/ui/components/ui/gooey-text-morphing";
import { SpiralAnimation } from "@asm/ui/components/ui/spiral-animation";
import { Button } from "@asm/ui/shadui/button";
import { Home } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getRandomFact } from "@/components/constants/loading-facts";

export default function Loading() {
  const [funFact, setFunFact] = useState("");
  const [showHomeLink, setShowHomeLink] = useState(false);

  useEffect(() => {
    const updateFunFact = () => setFunFact(getRandomFact());
    updateFunFact();
    const interval = setInterval(updateFunFact, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setShowHomeLink(true), 10_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 hidden md:block">
        <SpiralAnimation />
      </div>

      <div className="relative flex min-h-screen w-full flex-col items-center justify-center">
        <div className="relative z-10 flex flex-col items-center justify-center space-y-16">
          <GooeyText
            className="pb-2 text-foreground opacity-60"
            cooldownTime={0.25}
            morphTime={2}
            texts={["Loading", "लोडिंग", "積載中", "Carregando", "Загрузка"]}
          />

          <AnimatePresence mode="wait">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md px-8 text-center"
              exit={{ opacity: 0, y: -10 }}
              initial={{ opacity: 0, y: 10 }}
              key={funFact}
            >
              <p className="mb-3 text-base text-foreground/60">Did you know?</p>
              <p className="text-base text-foreground/80">{funFact}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="fixed inset-x-0 bottom-0 pb-8">
          <AnimatePresence>
            {showHomeLink ? (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-center"
                exit={{ opacity: 0, y: 20 }}
                initial={{ opacity: 0, y: 20 }}
              >
                <Link href="/">
                  <Button
                    className="text-foreground/60 transition-colors hover:text-foreground/80"
                    variant="ghost"
                  >
                    <Home className="mr-2 h-4 w-4" />
                    Taking too long? Return Home
                  </Button>
                </Link>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,transparent_0%,rgba(0,0,0,0.2)_100%)]" />
      </div>
    </div>
  );
}
