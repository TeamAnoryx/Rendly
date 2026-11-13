import { isCompanyEmail, normalizeEmail } from "./company-email";

describe("isCompanyEmail", () => {
  test.each(["jane@anoryx.com", "Jane.Doe@Acme.co.uk", "  ops@stripe.com  ", "a.b+tag@eng.example.io", "dev@yahoo-labs.ai"])(
    "accepts company address %s",
    (email) => {
      expect(isCompanyEmail(email)).toEqual({ ok: true });
    }
  );

  test.each([
    "someone@gmail.com",
    "someone@googlemail.com",
    "someone@yahoo.com",
    "someone@yahoo.co.uk",
    "someone@yahoo.fr",
    "someone@uk.yahoo.com",
    "someone@outlook.com",
    "someone@outlook.de",
    "someone@hotmail.com",
    "someone@hotmail.co.uk",
    "someone@live.com",
    "someone@msn.com",
    "someone@icloud.com",
    "someone@me.com",
    "someone@mac.com",
    "someone@aol.com",
    "someone@protonmail.com",
    "someone@proton.me",
    "someone@gmx.de",
    "someone@mail.com",
    "someone@yandex.ru",
    "someone@zoho.com",
    "someone@rediffmail.com",
    "someone@qq.com",
    "someone@163.com",
    "someone@126.com",
    "SOMEONE@GMAIL.COM",
  ])("rejects free webmail %s", (email) => {
    const result = isCompanyEmail(email);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/company email/i);
  });

  test.each([
    "x@mailinator.com",
    "x@tempmail.com",
    "x@10minutemail.com",
    "x@guerrillamail.com",
    "x@yopmail.com",
    "x@eu.mailinator.com",
  ])("rejects disposable %s", (email) => {
    const result = isCompanyEmail(email);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/disposable/i);
  });

  test.each(["", "   ", "plainaddress", "@acme.com", "jane@", "jane@acme", "jane @acme.com", "jane@acme..com", null, 42, undefined])(
    "rejects malformed input %p",
    (email) => {
      expect(isCompanyEmail(email)).toEqual({ ok: false, message: "Enter a valid email address." });
    }
  );

  test("accepts an address of exactly 254 characters", () => {
    const email = `${"a".repeat(245)}@acme.com`;
    expect(email).toHaveLength(254);
    expect(isCompanyEmail(email)).toEqual({ ok: true });
  });

  test("rejects an address of 255 characters", () => {
    const email = `${"a".repeat(246)}@acme.com`;
    expect(email).toHaveLength(255);
    expect(isCompanyEmail(email)).toEqual({ ok: false, message: "Enter a valid email address." });
  });
});

describe("normalizeEmail", () => {
  test("trims and lowercases", () => {
    expect(normalizeEmail("  Jane@Acme.COM ")).toBe("jane@acme.com");
  });
});
