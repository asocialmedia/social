import { createHmac, timingSafeEqual } from "node:crypto";

const cookieName = "asm_protocol_guest";
export function protocolGuest(request: Request, now = Date.now()) {
  const secret =
    process.env.PROTOCOLS_GUEST_SECRET ?? process.env.PROTOCOLS_INTERNAL_TOKEN;
  if (!secret || secret.length < 32) {
    return { cookie: undefined, identity: "unconfigured" };
  }
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("base64url");
  const supplied = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  const [id, expires, signature] = (supplied ?? "").split(".");
  if (
    id &&
    /^[a-f0-9-]{36}$/.test(id) &&
    expires &&
    /^\d{13}$/.test(expires) &&
    Number(expires) > now &&
    Number(expires) <= now + 86_400_000 &&
    signature
  ) {
    const actual = Buffer.from(signature);
    const expected = Buffer.from(sign(`${id}.${expires}`));
    if (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    ) {
      return { cookie: undefined, identity: id };
    }
  }
  const identity = crypto.randomUUID();
  const value = `${identity}.${now + 86_400_000}`;
  return {
    cookie: `${cookieName}=${value}.${sign(value)}; HttpOnly; SameSite=Lax; Path=/api/protocols; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    identity,
  };
}
