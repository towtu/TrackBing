export const MAX_EMAIL_LENGTH = 254;
export const MIN_SIGNUP_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1024;
export const SIGNUP_CODE_LENGTH = 6;

type ValidationFailure = { ok: false; title: string; message: string };

export function validateAuthCredentials(email: string, password: string, isLogin: boolean): ValidationFailure | { ok: true; email: string; password: string } {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password) return { ok: false, title: "Missing details", message: "Enter both your email and password." };
  if (normalizedEmail.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || /[\u0000-\u001f\u007f]/.test(normalizedEmail)) return { ok: false, title: "Invalid email", message: "Enter a valid email address of up to 254 characters." };
  if (password.length > MAX_PASSWORD_LENGTH) return { ok: false, title: "Password too long", message: "Use a password of up to 1,024 characters." };
  if (!isLogin && password.length < MIN_SIGNUP_PASSWORD_LENGTH) return { ok: false, title: "Password too short", message: "Use at least 8 characters for your password." };
  return { ok: true, email: normalizedEmail, password };
}

export function validateSignupCode(value: string): ValidationFailure | { ok: true; code: string } {
  const code = value.trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, title: "Check your code", message: "Enter the 6-digit code from your verification email." };
  return { ok: true, code };
}
