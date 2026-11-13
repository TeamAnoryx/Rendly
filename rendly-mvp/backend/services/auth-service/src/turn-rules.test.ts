import crypto from "crypto";
import { buildIceConfig, parseTurnUrls, PUBLIC_STUN_URL, turnCredential, turnUsername, TURN_CREDENTIAL_TTL_SECONDS } from "./turn-rules";

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0); // 1767268800 s

describe("parseTurnUrls", () => {
  it("keeps only turn:/turns: urls, trimmed and deduplicated", () => {
    expect(parseTurnUrls(" turn:a.example:3478?transport=udp, turns:a.example:5349 ,stun:x:1, https://x,turn:a.example:3478?transport=udp")).toEqual([
      "turn:a.example:3478?transport=udp",
      "turns:a.example:5349",
    ]);
  });
  it("returns [] for empty or missing input", () => {
    expect(parseTurnUrls(undefined)).toEqual([]);
    expect(parseTurnUrls("")).toEqual([]);
    expect(parseTurnUrls(" , ")).toEqual([]);
  });
});

describe("turnUsername / turnCredential", () => {
  it("expires TTL seconds from now", () => {
    expect(TURN_CREDENTIAL_TTL_SECONDS).toBe(600);
    expect(turnUsername(NOW, "deadbeef")).toBe(`${NOW / 1000 + 600}:deadbeef`);
  });
  it("is base64 HMAC-SHA1 of the username", () => {
    const username = "1767269400:deadbeef";
    const expected = crypto.createHmac("sha1", "s3cret").update(username).digest("base64");
    expect(turnCredential("s3cret", username)).toBe(expected);
    expect(turnCredential("other", username)).not.toBe(expected);
  });
});

describe("buildIceConfig", () => {
  it("returns relay credentials when urls and secret are set", () => {
    const cfg = buildIceConfig({ turnUrls: "turn:t.example:3478,turns:t.example:5349", sharedSecret: "s3cret", nowMs: NOW, randomHex8: "0a1b2c3d" });
    expect(cfg.relay).toBe(true);
    expect(cfg.iceServers).toHaveLength(1);
    const server = cfg.iceServers[0];
    expect(server.urls).toEqual(["turn:t.example:3478", "turns:t.example:5349"]);
    expect(server.username).toBe("1767269400:0a1b2c3d");
    expect(server.credential).toBe(turnCredential("s3cret", "1767269400:0a1b2c3d"));
  });
  it("falls back to public STUN without a secret", () => {
    expect(buildIceConfig({ turnUrls: "turn:t.example:3478", sharedSecret: "", nowMs: NOW, randomHex8: "0a1b2c3d" })).toEqual({
      relay: false,
      iceServers: [{ urls: PUBLIC_STUN_URL }],
    });
  });
  it("falls back to public STUN without usable urls", () => {
    expect(buildIceConfig({ turnUrls: "stun:only:1", sharedSecret: "s3cret", nowMs: NOW, randomHex8: "0a1b2c3d" }).relay).toBe(false);
    expect(buildIceConfig({ turnUrls: undefined, sharedSecret: "s3cret", nowMs: NOW, randomHex8: "0a1b2c3d" }).relay).toBe(false);
  });
});
