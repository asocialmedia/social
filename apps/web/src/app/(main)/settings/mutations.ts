import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

const usernameSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores"
    ),
});

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export function useUpdateUsername() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: z.infer<typeof usernameSchema>) => {
      const response = await fetch("/api/users/username", {
        body: JSON.stringify(values),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update username");
      }

      return response.json() as Promise<{ success: true }>;
    },
    onSuccess: () => {
      // The session and profile caches key on ["user", id]; invalidating the
      // generic ["userData"] key never matched, so the new username stayed
      // stale until a full reload. Refetch the session (which carries the
      // fresh username) and let the ["user", id] caches pick it up.
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
      queryClient.invalidateQueries({ queryKey: ["userData"] });
    },
  });
}

export function useUpdateEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: z.infer<typeof emailSchema>) => {
      const response = await fetch("/api/users/email", {
        body: JSON.stringify(values),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update email");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
      queryClient.invalidateQueries({ queryKey: ["userData"] });
    },
  });
}
