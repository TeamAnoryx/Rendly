/**
 * Account linking: one person = one account across GitHub, LinkedIn and email/password.
 * Pure module (no I/O) so the security-relevant decisions are unit tested.
 */

export type OAuthProvider = "github" | "linkedin";

const PROVIDER_LABEL: Record<OAuthProvider, string> = { github: "GitHub", linkedin: "LinkedIn" };

export const SIGNUP_EMAIL_TAKEN_MESSAGE =
  "An account with this email already exists. Sign in with GitHub/LinkedIn or your password, or reset your password.";

export const AMBIGUOUS_EMAIL_MESSAGE =
  "More than one account uses this email. Please contact support so we can merge them.";

/** Trim + lowercase. Returns null for anything that is not a non-empty string containing "@". */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

/** Escape LIKE/ILIKE wildcards so an email can be used as an exact, case-insensitive pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Entry from GitHub GET /user/emails. */
export type GitHubEmailEntry = {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
};

/** The primary GitHub email, only if GitHub reports it verified. Otherwise null (never link by email). */
export function pickVerifiedGitHubEmail(entries: unknown): string | null {
  if (!Array.isArray(entries)) return null;
  const primary = entries.find(
    (e): e is GitHubEmailEntry => !!e && typeof e === "object" && (e as GitHubEmailEntry).primary === true
  );
  if (!primary || primary.verified !== true) return null;
  return normalizeEmail(primary.email);
}

/** LinkedIn OIDC userinfo email, only when email_verified is exactly true. */
export function pickVerifiedLinkedInEmail(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as { email?: unknown; email_verified?: unknown };
  if (p.email_verified !== true) return null;
  return normalizeEmail(p.email);
}

/** The subset of a users row the resolution needs. */
export type LinkCandidate = {
  id: string;
  email: string | null;
  github_id: string | null;
  linkedin_id: string | null;
  has_password: boolean;
  email_verified: boolean;
};

export type OAuthResolution =
  /** Provider id already on an account. markEmailVerified: account email equals the provider-verified email. */
  | { action: "login"; userId: string; markEmailVerified: boolean }
  /** Attach the provider id to the account that owns the verified email. */
  | { action: "link"; userId: string; clearPassword: boolean }
  /** No account matches: create one (email is the verified email or null). */
  | { action: "create"; email: string | null }
  | { action: "conflict"; status: 409; message: string };

export type OAuthResolutionInput = {
  provider: OAuthProvider;
  providerId: string;
  /** Provider-verified email (already normalised), or null when the provider did not verify one. */
  verifiedEmail: string | null;
  /** Account whose github_id / linkedin_id equals providerId. */
  byProviderId: LinkCandidate | null;
  /** Accounts whose email equals verifiedEmail (case-insensitive). Empty when verifiedEmail is null. */
  byEmail: LinkCandidate[];
};

function providerIdOf(account: LinkCandidate, provider: OAuthProvider): string | null {
  return provider === "github" ? account.github_id : account.linkedin_id;
}

/**
 * Resolution order: (a) provider id match -> login; (b) verified email match -> link
 * (refuse if that account has a different id for this provider); (c) create.
 * Linking onto an account with a password whose email was never provider-verified clears the
 * password: OAuth proves email ownership, an unverified password may belong to someone else.
 */
export function resolveOAuthSignIn(input: OAuthResolutionInput): OAuthResolution {
  const { provider, providerId, byProviderId } = input;
  const verifiedEmail = normalizeEmail(input.verifiedEmail);

  if (byProviderId) {
    const accountEmail = normalizeEmail(byProviderId.email);
    return {
      action: "login",
      userId: byProviderId.id,
      markEmailVerified: !!verifiedEmail && accountEmail === verifiedEmail && !byProviderId.email_verified,
    };
  }

  if (!verifiedEmail) return { action: "create", email: null };

  const matches = input.byEmail.filter((a) => normalizeEmail(a.email) === verifiedEmail);
  if (matches.length > 1) return { action: "conflict", status: 409, message: AMBIGUOUS_EMAIL_MESSAGE };
  if (matches.length === 0) return { action: "create", email: verifiedEmail };

  const account = matches[0];
  const existingId = providerIdOf(account, provider);
  if (existingId && existingId !== providerId) {
    return {
      action: "conflict",
      status: 409,
      message: `This email is already linked to a different ${PROVIDER_LABEL[provider]} account.`,
    };
  }
  return { action: "link", userId: account.id, clearPassword: account.has_password && !account.email_verified };
}

export type PasswordSignupResolution =
  | { action: "create"; email: string }
  | { action: "conflict"; status: 409; message: string }
  | { action: "invalid"; status: 400; message: string };

/** Email/password sign-up: never create a second row for an email that already has an account. */
export function resolvePasswordSignup(rawEmail: unknown, existingCount: number): PasswordSignupResolution {
  const email = normalizeEmail(rawEmail);
  if (!email) return { action: "invalid", status: 400, message: "Enter a valid email address." };
  if (existingCount > 0) return { action: "conflict", status: 409, message: SIGNUP_EMAIL_TAKEN_MESSAGE };
  return { action: "create", email };
}
