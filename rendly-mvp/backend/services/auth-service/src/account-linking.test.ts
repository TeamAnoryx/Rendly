import {
  normalizeEmail,
  escapeLikePattern,
  pickVerifiedGitHubEmail,
  pickVerifiedLinkedInEmail,
  resolveOAuthSignIn,
  resolvePasswordSignup,
  SIGNUP_EMAIL_TAKEN_MESSAGE,
  AMBIGUOUS_EMAIL_MESSAGE,
  type LinkCandidate,
} from "./account-linking";

function account(overrides: Partial<LinkCandidate> = {}): LinkCandidate {
  return {
    id: "u1",
    email: "jane@acme.io",
    github_id: null,
    linkedin_id: null,
    has_password: false,
    email_verified: false,
    ...overrides,
  };
}

describe("normalizeEmail", () => {
  test("trims and lowercases", () => {
    expect(normalizeEmail("  Jane@ACME.io ")).toBe("jane@acme.io");
  });
  test("rejects empty and non-strings", () => {
    expect(normalizeEmail("   ")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("no-at-sign")).toBeNull();
  });
});

describe("escapeLikePattern", () => {
  test("escapes wildcards so ilike is an exact match", () => {
    expect(escapeLikePattern("a_b%c\\d@x.io")).toBe("a\\_b\\%c\\\\d@x.io");
  });
});

describe("pickVerifiedGitHubEmail", () => {
  test("uses the primary verified email, normalised", () => {
    const entries = [
      { email: "other@x.io", primary: false, verified: true },
      { email: "Jane@Acme.io", primary: true, verified: true },
    ];
    expect(pickVerifiedGitHubEmail(entries)).toBe("jane@acme.io");
  });
  test("ignores an unverified primary email", () => {
    const entries = [
      { email: "jane@acme.io", primary: true, verified: false },
      { email: "other@x.io", primary: false, verified: true },
    ];
    expect(pickVerifiedGitHubEmail(entries)).toBeNull();
  });
  test("returns null for malformed input", () => {
    expect(pickVerifiedGitHubEmail(undefined)).toBeNull();
    expect(pickVerifiedGitHubEmail({})).toBeNull();
  });
});

describe("pickVerifiedLinkedInEmail", () => {
  test("uses email only when email_verified === true", () => {
    expect(pickVerifiedLinkedInEmail({ email: "JANE@acme.io", email_verified: true })).toBe("jane@acme.io");
    expect(pickVerifiedLinkedInEmail({ email: "jane@acme.io", email_verified: "true" })).toBeNull();
    expect(pickVerifiedLinkedInEmail({ email: "jane@acme.io" })).toBeNull();
  });
});

describe("resolveOAuthSignIn", () => {
  test("logs in when the provider id already belongs to an account", () => {
    const r = resolveOAuthSignIn({
      provider: "github",
      providerId: "gh1",
      verifiedEmail: "jane@acme.io",
      byProviderId: account({ github_id: "gh1" }),
      byEmail: [],
    });
    expect(r).toEqual({ action: "login", userId: "u1", markEmailVerified: true });
  });

  test("links on a case-insensitive email match", () => {
    const r = resolveOAuthSignIn({
      provider: "linkedin",
      providerId: "li1",
      verifiedEmail: "JANE@Acme.IO",
      byProviderId: null,
      byEmail: [account({ email: "Jane@acme.io", github_id: "gh1" })],
    });
    expect(r).toEqual({ action: "link", userId: "u1", clearPassword: false });
  });

  test("unverified provider email is never used to link (creates a fresh account without email)", () => {
    const r = resolveOAuthSignIn({
      provider: "github",
      providerId: "gh2",
      verifiedEmail: null,
      byProviderId: null,
      byEmail: [account()],
    });
    expect(r).toEqual({ action: "create", email: null });
  });

  test("link onto a password account clears the password when the email was never verified", () => {
    const r = resolveOAuthSignIn({
      provider: "github",
      providerId: "gh1",
      verifiedEmail: "jane@acme.io",
      byProviderId: null,
      byEmail: [account({ has_password: true, email_verified: false })],
    });
    expect(r).toEqual({ action: "link", userId: "u1", clearPassword: true });
  });

  test("link keeps the password when the email was already provider-verified", () => {
    const r = resolveOAuthSignIn({
      provider: "github",
      providerId: "gh1",
      verifiedEmail: "jane@acme.io",
      byProviderId: null,
      byEmail: [account({ has_password: true, email_verified: true, linkedin_id: "li1" })],
    });
    expect(r).toEqual({ action: "link", userId: "u1", clearPassword: false });
  });

  test("conflict when the email account has a different id for the same provider", () => {
    const r = resolveOAuthSignIn({
      provider: "github",
      providerId: "gh-new",
      verifiedEmail: "jane@acme.io",
      byProviderId: null,
      byEmail: [account({ github_id: "gh-old" })],
    });
    expect(r).toEqual({
      action: "conflict",
      status: 409,
      message: "This email is already linked to a different GitHub account.",
    });
  });

  test("relinks LinkedIn when the same verified email arrives with a new id (new LinkedIn app)", () => {
    const r = resolveOAuthSignIn({
      provider: "linkedin",
      providerId: "li-new-app",
      verifiedEmail: "jane@acme.io",
      byProviderId: null,
      byEmail: [account({ linkedin_id: "li-old-app", email_verified: true })],
    });
    expect(r).toEqual({ action: "link", userId: "u1", clearPassword: false });
  });

  test("LinkedIn without a verified email still never relinks", () => {
    const r = resolveOAuthSignIn({
      provider: "linkedin",
      providerId: "li-new-app",
      verifiedEmail: null,
      byProviderId: null,
      byEmail: [],
    });
    expect(r).toEqual({ action: "create", email: null });
  });

  test("conflict when several legacy accounts share the email", () => {
    const r = resolveOAuthSignIn({
      provider: "github",
      providerId: "gh1",
      verifiedEmail: "jane@acme.io",
      byProviderId: null,
      byEmail: [account({ id: "u1" }), account({ id: "u2", email: "JANE@acme.io" })],
    });
    expect(r).toEqual({ action: "conflict", status: 409, message: AMBIGUOUS_EMAIL_MESSAGE });
  });

  test("creates with the verified email when nothing matches", () => {
    const r = resolveOAuthSignIn({
      provider: "linkedin",
      providerId: "li1",
      verifiedEmail: "new@acme.io",
      byProviderId: null,
      byEmail: [],
    });
    expect(r).toEqual({ action: "create", email: "new@acme.io" });
  });
});

describe("resolvePasswordSignup", () => {
  test("rejects an email that already has an account", () => {
    expect(resolvePasswordSignup("Jane@Acme.io", 1)).toEqual({
      action: "conflict",
      status: 409,
      message: SIGNUP_EMAIL_TAKEN_MESSAGE,
    });
  });
  test("creates with the normalised email when unused", () => {
    expect(resolvePasswordSignup(" Jane@Acme.io ", 0)).toEqual({ action: "create", email: "jane@acme.io" });
  });
});
