import {
  clientIp,
  isSafeProfileUrl,
  rateLimitKey,
  resetTokenHash,
  resolveAppOrigin,
  resolveJwtSecret,
} from "./auth-security";

const PROXY_IP = "203.0.113.7";
const SOCKET_IP = "10.0.0.5";
const APP_URL = "https://example.test/rendly.app";

describe("resolveJwtSecret", () => {
  test("production without a secret fails closed", () => {
    expect(() => resolveJwtSecret({ NODE_ENV: "production" })).toThrow("JWT_SECRET");
    expect(() => resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "" })).toThrow("JWT_SECRET");
  });

  test("uses the configured secret, and a dev fallback outside production", () => {
    expect(resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "configured" })).toBe("configured");
    expect(resolveJwtSecret({ NODE_ENV: "development" }).length).toBeGreaterThan(0);
  });
});

describe("clientIp", () => {
  test("uses the proxy-resolved address and ignores everything the client sends", () => {
    const req = { ip: PROXY_IP, socket: { remoteAddress: SOCKET_IP }, headers: { "x-client-ip": "1.1.1.1" }, body: { client_ip: "2.2.2.2" } };
    expect(clientIp(req as never)).toBe(PROXY_IP);
  });

  test("falls back to the socket address, then null", () => {
    expect(clientIp({ ip: "", socket: { remoteAddress: SOCKET_IP } } as never)).toBe(SOCKET_IP);
    expect(clientIp({ ip: undefined, socket: {} } as never)).toBeNull();
  });
});

describe("resetTokenHash", () => {
  test("is deterministic, hex, and differs per token", () => {
    expect(resetTokenHash("token-a")).toBe(resetTokenHash("token-a"));
    expect(resetTokenHash("token-a")).toMatch(/^[0-9a-f]{64}$/);
    expect(resetTokenHash("token-a")).not.toBe(resetTokenHash("token-b"));
    expect(resetTokenHash("")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("resolveAppOrigin", () => {
  const attackerHeaders = { origin: "https://evil.test", referer: "https://evil.test/x" };

  test("production never trusts request headers", () => {
    expect(resolveAppOrigin({ NODE_ENV: "production" }, attackerHeaders)).toBeNull();
    expect(resolveAppOrigin({ NODE_ENV: "production", APP_URL: `${APP_URL}/` }, attackerHeaders)).toBe(APP_URL);
  });

  test("development falls back to headers, then localhost", () => {
    expect(resolveAppOrigin({ NODE_ENV: "development" }, { origin: "http://localhost:3011/" })).toBe("http://localhost:3011");
    expect(resolveAppOrigin({}, {})).toBe("http://localhost:3001");
  });
});

describe("isSafeProfileUrl", () => {
  test("accepts plain https links", () => {
    expect(isSafeProfileUrl("https://github.com/someone")).toBe(true);
  });

  test("rejects script, data, http, credentials, junk, empty and oversized values", () => {
    expect(isSafeProfileUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeProfileUrl("data:text/html,<script>1</script>")).toBe(false);
    expect(isSafeProfileUrl("http://github.com/someone")).toBe(false);
    expect(isSafeProfileUrl("https://user:pass@github.com/")).toBe(false);
    expect(isSafeProfileUrl("not a url")).toBe(false);
    expect(isSafeProfileUrl("")).toBe(false);
    expect(isSafeProfileUrl(null)).toBe(false);
    expect(isSafeProfileUrl(`https://github.com/${"a".repeat(400)}`)).toBe(false);
  });
});

describe("rateLimitKey", () => {
  const verify = (token: string) => (token === "good" ? "user-1" : null);

  test("a verified token keys by user", () => {
    expect(rateLimitKey("Bearer good", PROXY_IP, verify)).toBe("u:user-1");
  });

  test("forged, malformed or missing headers key by address", () => {
    expect(rateLimitKey("Bearer forged", PROXY_IP, verify)).toBe(`ip:${PROXY_IP}`);
    expect(rateLimitKey("random-junk", PROXY_IP, verify)).toBe(`ip:${PROXY_IP}`);
    expect(rateLimitKey(undefined, PROXY_IP, verify)).toBe(`ip:${PROXY_IP}`);
    expect(rateLimitKey("", null, verify)).toBe("ip:unknown");
  });
});
