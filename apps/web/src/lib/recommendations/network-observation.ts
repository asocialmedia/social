import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const observationSchema = z.object({
  authorId: z.string().max(2300),
  hasImage: z.boolean(),
  hasVideo: z.boolean(),
  postId: z.string().max(2300),
  profileId: z.string().max(64),
  publicContent: z.boolean().default(false),
  revision: z.number().int().nonnegative(),
  source: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  topics: z.array(z.string().min(2).max(64)).max(20),
});
export type NetworkObservation = z.infer<typeof observationSchema>;

function signingKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  return new TextEncoder().encode(secret);
}

// A short-lived signed receipt lets telemetry use server-validated topics without importing remote posts.
export function signNetworkObservation(
  userId: string,
  observation: NetworkObservation
): Promise<string> {
  return new SignJWT({ ...observationSchema.parse(observation) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("asm:network-observation")
    .setAudience(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(signingKey());
}

export async function verifyNetworkObservation(
  userId: string,
  token: string
): Promise<NetworkObservation> {
  const { payload } = await jwtVerify(token, signingKey(), {
    algorithms: ["HS256"],
    audience: userId,
    issuer: "asm:network-observation",
    maxTokenAge: "15m",
  });
  return observationSchema.parse(payload);
}
