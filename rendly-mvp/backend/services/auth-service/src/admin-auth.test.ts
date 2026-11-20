import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

jest.mock("./security", () => {
  const actual = jest.requireActual("./security");
  return { ...actual, recordSecurityEvent: jest.fn(async () => undefined) };
});

import { recordSecurityEvent } from "./security";
import {
  ADMIN_AUDIENCE,
  checkAdminCredentials,
  lockoutRemaining,
  recordAdminLoginFailure,
  recordAdminLoginSuccess,
  signAdminToken,
  verifyAdminToken,
} from "./admin-auth";

const EMAIL = "admin@example.test";
const PASSWORD = "a-long-test-password";

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.ADMIN_EMAIL = EMAIL;
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(PASSWORD, 4);
});

describe("checkAdminCredentials", () => {
  it("accepts the configured email (any case) and password", async () => {
    await expect(checkAdminCredentials(" Admin@Example.test ", PASSWORD)).resolves.toBe(true);
  });

  it("rejects a wrong password, a wrong email and bad input", async () => {
    await expect(checkAdminCredentials(EMAIL, "wrong-password")).resolves.toBe(false);
    await expect(checkAdminCredentials("other@example.test", PASSWORD)).resolves.toBe(false);
    await expect(checkAdminCredentials(EMAIL, "")).resolves.toBe(false);
    await expect(checkAdminCredentials({}, PASSWORD)).resolves.toBe(false);
  });

  it("refuses everyone when the server has no password hash", async () => {
    const saved = process.env.ADMIN_PASSWORD_HASH;
    process.env.ADMIN_PASSWORD_HASH = "";
    await expect(checkAdminCredentials(EMAIL, PASSWORD)).resolves.toBe(false);
    process.env.ADMIN_PASSWORD_HASH = saved;
  });
});

describe("plain-text ADMIN_PASSWORD", () => {
  const PLAIN = "plain-test-password";
  let savedHash: string | undefined;

  beforeEach(() => {
    savedHash = process.env.ADMIN_PASSWORD_HASH;
    process.env.ADMIN_PASSWORD = PLAIN;
  });

  afterEach(() => {
    process.env.ADMIN_PASSWORD_HASH = savedHash;
    delete process.env.ADMIN_PASSWORD;
  });

  it("is used when no hash is set", async () => {
    process.env.ADMIN_PASSWORD_HASH = "";
    await expect(checkAdminCredentials(EMAIL, PLAIN)).resolves.toBe(true);
    await expect(checkAdminCredentials(EMAIL, PLAIN.slice(0, -1))).resolves.toBe(false);
    await expect(checkAdminCredentials(EMAIL, "")).resolves.toBe(false);
    await expect(checkAdminCredentials(EMAIL, null)).resolves.toBe(false);
    await expect(checkAdminCredentials(EMAIL, undefined)).resolves.toBe(false);
    await expect(checkAdminCredentials("other@example.test", PLAIN)).resolves.toBe(false);
  });

  it("is ignored when a hash is also set (the hash wins)", async () => {
    await expect(checkAdminCredentials(EMAIL, PLAIN)).resolves.toBe(false);
    await expect(checkAdminCredentials(EMAIL, PASSWORD)).resolves.toBe(true);
  });
});

describe("admin tokens", () => {
  it("round-trips an admin token", () => {
    expect(verifyAdminToken(signAdminToken(EMAIL))).toBe(EMAIL);
  });

  it("rejects ordinary user tokens and tokens for another email", () => {
    const userToken = jwt.sign({ sub: "user-1", provider: "password" }, "test-secret", { expiresIn: "1h" });
    expect(verifyAdminToken(userToken)).toBeNull();
    const otherAdmin = jwt.sign({ sub: "x@example.test", role: "admin" }, "test-secret", { audience: ADMIN_AUDIENCE });
    expect(verifyAdminToken(otherAdmin)).toBeNull();
    expect(verifyAdminToken("garbage")).toBeNull();
    expect(verifyAdminToken(null)).toBeNull();
  });
});

describe("lockout", () => {
  it("locks an address after five failures and alerts", () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 4; i++) recordAdminLoginFailure(ip);
    expect(lockoutRemaining(ip)).toBe(0);
    recordAdminLoginFailure(ip);
    expect(lockoutRemaining(ip)).toBeGreaterThan(14 * 60_000);
    expect(recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "admin_login_lockout", severity: "critical" }));
  });

  it("clears failures on success", () => {
    const ip = "203.0.113.8";
    recordAdminLoginFailure(ip);
    recordAdminLoginSuccess(ip);
    for (let i = 0; i < 4; i++) recordAdminLoginFailure(ip);
    expect(lockoutRemaining(ip)).toBe(0);
  });
});
