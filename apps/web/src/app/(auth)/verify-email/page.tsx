"use client";

import { Button } from "@asm/ui/shadui/button";
import { XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ERROR_MESSAGES = {
  "invalid-token": "The verification link is invalid.",
  "token-expired": "The verification link has expired.",
  "verification-failed": "Email verification failed.",
  "server-error": "An error occurred. Please try again.",
};

const VerificationAnimation = () => {
  return (
    <div className="flex flex-col items-center space-y-6">
      <div className="relative h-32 w-64">
        <motion.div
          animate={{ x: 0, opacity: 1 }}
          className="absolute top-0 left-0 h-20 w-20 rounded-xl border border-primary/20 bg-primary/5 p-4"
          initial={{ x: -100, opacity: 0 }}
        >
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: SVG is purely decorative */}
          <svg
            className="h-full w-full text-primary/60"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        </motion.div>

        <motion.div
          animate={{ scaleX: 1 }}
          className="absolute top-8 left-1/2 h-1 w-20 -translate-x-1/2"
          initial={{ scaleX: 0 }}
          transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
        >
          <div className="h-full w-full bg-gradient-to-r from-primary/0 via-primary to-primary/0" />
        </motion.div>

        <motion.div
          animate={{ x: 0, opacity: 1 }}
          className="absolute top-0 right-0 h-20 w-20 rounded-xl border border-primary/20 bg-primary/5 p-4"
          initial={{ x: 100, opacity: 0 }}
        >
          {/* biome-ignore lint/a11y/noSvgWithoutTitle: SVG is purely decorative */}
          <svg
            className="h-full w-full text-primary/60"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        </motion.div>

        <motion.div
          animate={{ x: 256 }}
          className="absolute top-0 left-0 h-full w-1 bg-primary/50"
          initial={{ x: 0 }}
          transition={{
            duration: 2,
            repeat: Number.POSITIVE_INFINITY,
            ease: "linear",
          }}
        />
      </div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
        initial={{ opacity: 0, y: 20 }}
      >
        <motion.p
          animate={{ opacity: [1, 0.5, 1] }}
          className="font-medium text-foreground text-lg"
          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
        >
          Verifying your email...
        </motion.p>
        <motion.p
          animate={{ opacity: 1 }}
          className="mt-2 text-muted-foreground text-sm"
          initial={{ opacity: 0 }}
          transition={{ delay: 0.5 }}
        >
          Please wait while we confirm your identity
        </motion.p>
      </motion.div>

      <motion.div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
            className="h-2 w-2 rounded-full bg-primary"
            key={`dot-${i}`}
            transition={{
              duration: 1,
              repeat: Number.POSITIVE_INFINITY,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </motion.div>
    </div>
  );
};

const AnimatedAsocialmediaText = () => {
  const letters = "ZEPHYR.".split("");

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="pointer-events-none select-none font-bold text-4xl sm:text-6xl"
      initial={{ opacity: 0 }}
      transition={{ duration: 0.8, delay: 0.7 }}
    >
      <div className="relative flex">
        {letters.map((letter, i) => (
          <motion.span
            animate={{
              opacity: [0, 1, 1, 0.3, 1],
              y: [20, 0, 0, 0, 0],
            }}
            className="text-primary/50"
            initial={{ opacity: 0, y: 20 }}
            key={letter}
            style={{
              textShadow: "0 2px 10px rgba(0, 0, 0, 0.1)",
              display: "inline-block",
            }}
            transition={{
              duration: 4,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
              delay: i * 0.1,
              times: [0, 0.2, 0.5, 0.8, 1],
            }}
          >
            {letter}
          </motion.span>
        ))}
      </div>
      <motion.div
        animate={{
          scaleX: [0, 1, 1, 1, 0],
          opacity: [0, 1, 1, 0.3, 0],
        }}
        className="absolute bottom-0 left-0 h-0.5 bg-primary/30"
        initial={{ scaleX: 0 }}
        style={{ transformOrigin: "left" }}
        transition={{
          duration: 4,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
          times: [0, 0.2, 0.5, 0.8, 1],
        }}
      />
    </motion.div>
  );
};

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const verificationChannel = useMemo(
    () => new BroadcastChannel("email-verification"),
    []
  );
  const verificationAttempted = useRef(false);

  const handleBackToLogin = useCallback(() => {
    router.push("/login");
  }, [router]);

  useEffect(() => {
    const error = searchParams.get("error");
    const token = searchParams.get("token");
    const verified = searchParams.get("verified");

    if (verified) {
      verificationChannel.postMessage("verification-success");
      window.close();
      router.push("/");
      return;
    }

    if (error) {
      setStatus("error");
    } else if (token && !verificationAttempted.current) {
      verificationAttempted.current = true;
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ignore
      (async () => {
        try {
          const res = await fetch(
            `/api/verify-email?token=${encodeURIComponent(token)}`,
            { method: "GET", credentials: "include" }
          );
          const data = await res.json().catch(() => ({}) as unknown);
          const ok = (data as { ok?: boolean }).ok === true || res.ok;

          if (ok) {
            try {
              verificationChannel.postMessage("verification-success");
            } catch {
              // BroadcastChannel error is non-critical
            }
            setStatus("success");

            await new Promise((resolve) => setTimeout(resolve, 500));

            try {
              const sessionRes = await fetch("/api/auth/get-session", {
                credentials: "include",
              });
              const sessionData = await sessionRes.json().catch(() => null);

              if (sessionData?.user) {
                router.replace("/verify-email?verified=1");
                setTimeout(() => router.push("/"), 1000);
              } else {
                router.replace("/verify-email?verified=1");
                setTimeout(() => router.push("/login"), 1000);
              }
            } catch {
              router.replace("/verify-email?verified=1");
              setTimeout(() => router.push("/login"), 1000);
            }
            return;
          }
          setStatus("error");
        } catch {
          setStatus("error");
        }
      })();
    } else if (!token) {
      setStatus("error");
    }
  }, [searchParams, router, verificationChannel]);

  const error = searchParams.get("error");
  const errorMessage = error
    ? ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES]
    : "Invalid verification link";

  return (
    <AnimatePresence>
      <motion.div
        animate={{ opacity: 1 }}
        className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-background via-background/95 to-background"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 -left-4 h-[500px] w-[500px] rounded-full bg-blue-500/10 blur-[100px]" />
          <div className="absolute top-1/2 right-0 h-[400px] w-[400px] rounded-full bg-purple-500/10 blur-[100px]" />
          <div className="absolute bottom-0 left-1/2 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-pink-500/10 blur-[100px]" />
        </div>

        <div className="relative flex min-h-screen items-center justify-center p-4">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-lg border border-border/50 bg-background/60 p-8 shadow-lg backdrop-blur-xl"
            initial={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.5 }}
          >
            {status === "loading" && <VerificationAnimation />}

            {status === "success" && (
              <motion.div
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center space-y-4"
                initial={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  className="rounded-full bg-primary/10 p-4"
                  transition={{ duration: 0.5 }}
                >
                  {/* biome-ignore lint/a11y/noSvgWithoutTitle: SVG is decorative */}
                  <svg
                    className="h-16 w-16 text-primary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                    />
                  </svg>
                </motion.div>
                <h2 className="text-center font-bold text-2xl text-foreground">
                  Email Verified! 🎉
                </h2>
                <p className="text-center text-muted-foreground">
                  Your email has been successfully verified. Redirecting you
                  now...
                </p>
                <motion.div
                  animate={{ rotate: 360 }}
                  className="h-8 w-8 rounded-full border-4 border-primary/20 border-t-primary"
                  transition={{
                    duration: 1,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "linear",
                  }}
                />
              </motion.div>
            )}

            {status === "error" && (
              <motion.div
                animate={{ opacity: 1 }}
                className="flex flex-col items-center space-y-4"
                initial={{ opacity: 0 }}
              >
                <XCircle className="h-16 w-16 text-destructive" />
                <h2 className="text-center font-bold text-2xl text-foreground">
                  Verification Failed
                </h2>
                <p className="text-center text-muted-foreground">
                  {errorMessage}
                </p>
                <Button className="mt-4 w-full" onClick={handleBackToLogin}>
                  Back to Login
                </Button>
              </motion.div>
            )}
          </motion.div>

          <motion.div
            animate={{ opacity: 1 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2"
            initial={{ opacity: 0 }}
            transition={{ delay: 0.5 }}
          >
            <AnimatedAsocialmediaText />
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
