export class CommunityError extends Error {
  code:
    | "RATE_LIMITED"
    | "ALREADY_MEMBER"
    | "AURA_TOO_LOW"
    | "FORBIDDEN"
    | "INVALID_ROLE"
    | "INVALID_SLUG"
    | "LIMIT_REACHED"
    | "MOD_LIMIT_REACHED"
    | "NOT_FOUND"
    | "SLUG_TAKEN";
  constructor(code: CommunityError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "CommunityError";
  }
}
