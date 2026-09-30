import { describe, expect, it } from "vitest";
import { validateAuthCredentials, validateSignupCode } from "./authValidation";

describe("authentication input bounds", () => {
  it("trims email while preserving passwords exactly", () => {
    expect(validateAuthCredentials(" person@trackbing.app ", "  strong password  ", false)).toEqual({ ok: true, email: "person@trackbing.app", password: "  strong password  " });
  });
  it("permits existing shorter passwords only for sign in", () => {
    expect(validateAuthCredentials("person@trackbing.app", "old", true).ok).toBe(true);
    expect(validateAuthCredentials("person@trackbing.app", "old", false).ok).toBe(false);
  });
  it.each(["", "not-an-email", "a@b", "a b@trackbing.app", "person\n@trackbing.app", `${"a".repeat(245)}@trackbing.app`])("rejects email before any API request: %s", (email) => {
    expect(validateAuthCredentials(email, "valid password", true).ok).toBe(false);
  });
  it("rejects empty and excessively long passwords", () => {
    expect(validateAuthCredentials("person@trackbing.app", "", true).ok).toBe(false);
    expect(validateAuthCredentials("person@trackbing.app", "a".repeat(1025), true).ok).toBe(false);
  });
  it("validates the configured six-digit signup code and normalizes outside whitespace", () => {
    expect(validateSignupCode(" 123456 ")).toEqual({ ok: true, code: "123456" });
    for (const code of ["", "12345", "1234567", "12 456", "12345a", "１２３４５６"]) expect(validateSignupCode(code).ok).toBe(false);
  });
});
