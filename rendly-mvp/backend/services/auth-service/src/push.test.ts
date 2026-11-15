// web-push ships as ESM only; the allowlist tests never send, so stub it out for Jest.
jest.mock("web-push", () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() } }));

import { isPushServiceEndpoint, parseSubscription } from "./push";

describe("push endpoint allowlist", () => {
  test("accepts the browser push services", () => {
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushServiceEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushServiceEndpoint("https://web.push.apple.com/abc")).toBe(true);
  });

  test("rejects other hosts, http, ports, credentials and look-alikes", () => {
    expect(isPushServiceEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushServiceEndpoint("https://localhost/x")).toBe(false);
    expect(isPushServiceEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushServiceEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(isPushServiceEndpoint("https://evilfcm.googleapis.com.attacker.io/x")).toBe(false);
    expect(isPushServiceEndpoint("not a url")).toBe(false);
  });

  test("parseSubscription rejects a non-push endpoint", () => {
    const keys = { p256dh: "k", auth: "a" };
    expect(parseSubscription({ endpoint: "https://internal.example/x", keys })).toBeNull();
    expect(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys })).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: "k",
      auth: "a",
    });
  });
});
