import { describe, it, expect } from "vitest";
import { generateCodes, pickCode, markUsed, otpExpired, attemptsLeft, phoneKey, waDigits } from "./otp";

describe("whatsapp otp", () => {
  it("generates 100 unique 6-digit codes", () => {
    const c = generateCodes();
    expect(c).toHaveLength(100);
    expect(new Set(c.map((x) => x.code)).size).toBe(100);
    expect(c.every((x) => /^\d{6}$/.test(x.code) && !x.used)).toBe(true);
  });
  it("picks only unused codes and none when all used", () => {
    const codes = [{ code: "111111", used: true }, { code: "222222", used: false }];
    expect(pickCode(codes)).toBe("222222");
    expect(pickCode(markUsed(codes, "222222"))).toBeUndefined();
  });
  it("codes expire after 15 minutes", () => {
    expect(otpExpired(0, 14 * 60 * 1000)).toBe(false);
    expect(otpExpired(1, 15 * 60 * 1000 + 2)).toBe(true);
  });
  it("allows 5 attempts", () => {
    expect(attemptsLeft(4)).toBe(1);
    expect(attemptsLeft(5)).toBe(0);
  });
  it("normalizes phone numbers", () => {
    expect(phoneKey("0300-1234567")).toBe("03001234567");
    expect(waDigits("0300-1234567")).toBe("923001234567");
  });
});
