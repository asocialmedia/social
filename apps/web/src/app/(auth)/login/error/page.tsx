"use client";

import { Button } from "@asm/ui/shadui/button";
import { AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const ERROR_MESSAGES = {
  emailExists: "This email is already registered.",
  invalidCredentials: "Invalid email or password.",
  oauthError: "Error connecting with social provider.",
  serverError: "An unexpected error occurred.",
  accountNotFound: "Account not found.",
  unauthorized: "You must be logged in to access this page.",
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

export default function LoginErrorPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const email = searchParams.get("email");

  const errorMessage = error
    ? ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES]
    : "An error occurred";

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
            <motion.div
              animate={{ opacity: 1 }}
              className="flex flex-col items-center space-y-6"
              initial={{ opacity: 0 }}
            >
              <motion.div
                animate={{ scale: 1 }}
                className="rounded-full bg-destructive/10 p-4"
                initial={{ scale: 0 }}
                transition={{ type: "spring", duration: 0.5 }}
              >
                <AlertCircle className="h-12 w-12 text-destructive" />
              </motion.div>

              <div className="space-y-2 text-center">
                <h2 className="font-bold text-2xl text-foreground">
                  Authentication Error
                </h2>
                <p className="text-muted-foreground">{errorMessage}</p>
                {email && (
                  <p className="text-muted-foreground text-sm">
                    for email: <span className="font-medium">{email}</span>
                  </p>
                )}
              </div>

              <div className="flex w-full flex-col gap-2">
                <Button asChild className="w-full">
                  <Link href="/login">Login with Email</Link>
                </Button>
                <Button asChild className="w-full" variant="outline">
                  <Link href="/signup">Create New Account</Link>
                </Button>
              </div>

              <motion.p
                animate={{ opacity: 1 }}
                className="text-center text-muted-foreground text-sm"
                initial={{ opacity: 0 }}
                transition={{ delay: 0.5 }}
              >
                Need help?{" "}
                <Link
                  className="text-primary transition-colors hover:underline"
                  href="mailto:dev.hashcodes@gmail.com"
                >
                  Contact Support
                </Link>
              </motion.p>
            </motion.div>
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
