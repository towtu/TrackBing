import { validateAuthCredentials, validateSignupCode } from './authValidation';

type AuthError = { code?: string; status?: number } | null;
type RecoveryAuth = {
  resetPasswordForEmail(email: string): Promise<{ error: AuthError }>;
  verifyOtp(input: { email: string; token: string; type: 'recovery' }): Promise<{ error: AuthError; data: { user: { id: string; email?: string } | null; session: { access_token: string } | null } }>;
  updateUser(input: { password: string }): Promise<{ error: AuthError }>;
  signOut(input: { scope: 'global' }): Promise<{ error: AuthError }>;
};
type Result = { ok: boolean; message: string };

export function validateRecoveryPassword(password: string, repeated: string) {
  const validation = validateAuthCredentials('validation@example.test', password, false);
  if (!validation.ok) return validation;
  if (password !== repeated) return { ok: false as const, message: 'The passwords do not match.', title: 'Check your password' };
  return { ok: true as const, password };
}
function authFailure(error: AuthError, fallback: string) {
  if (error?.status === 429 || error?.code?.includes('rate_limit')) return 'Too many requests. Please wait before trying again.';
  if (error?.code === 'weak_password') return 'Choose a stronger password. Your account may require a mix of letters, numbers and symbols.';
  if (error?.code === 'same_password') return 'Choose a password different from your current password.';
  return fallback;
}

/** Only this ephemeral Auth session can change the verified account's password. */
export function createPasswordRecovery(auth: RecoveryAuth) {
  let active = true;
  let busy = false;
  let email: string | null = null;
  let verified = false;
  let completed = false;
  const unavailable = (): Result => ({ ok: false, message: 'This request is no longer active. Start again to request a code.' });
  return {
    dispose() { active = false; email = null; verified = false; },
    async send(value: string): Promise<Result> {
      if (!active || completed) return unavailable();
      if (busy) return { ok: false, message: 'Please wait for the current request.' };
      const input = validateAuthCredentials(value, 'email-validation-only', true);
      if (!input.ok) return { ok: false, message: input.message };
      busy = true;
      try {
        const { error } = await auth.resetPasswordForEmail(input.email);
        if (!active) return unavailable();
        if (error) return { ok: false, message: authFailure(error, 'Could not request a code. Check your connection and try again.') };
        email = input.email; verified = false;
        return { ok: true, message: 'If an account exists for this email, a recovery code will arrive shortly. Check your inbox and spam folder.' };
      } catch {
        return { ok: false, message: 'Could not request a code. Check your connection and try again.' };
      } finally { busy = false; }
    },
    async finish(token: string, password: string, repeated: string): Promise<Result> {
      if (!active || completed || !email) return unavailable();
      if (busy) return { ok: false, message: 'Please wait for the current request.' };
      const input = validateRecoveryPassword(password, repeated);
      if (!input.ok) return { ok: false, message: input.message };
      const code = validateSignupCode(token);
      if (!code.ok && !verified) return { ok: false, message: 'Enter the 6-digit code from your password recovery email.' };
      busy = true;
      try {
        if (!verified && code.ok) {
          const result = await auth.verifyOtp({ email, token: code.code, type: 'recovery' });
          if (!active) return unavailable();
          if (result.error || !result.data.session || !result.data.user || result.data.user.email?.toLowerCase() !== email.toLowerCase()) {
            return { ok: false, message: authFailure(result.error, 'That code is invalid or expired. Check it or request a new code.') };
          }
          verified = true;
        }
        if (!active || !verified) return unavailable();
        const { error } = await auth.updateUser({ password: input.password });
        if (error) return { ok: false, message: authFailure(error, 'Could not confirm the password change. Try signing in with the new password before requesting another code.') };
        completed = true; verified = false;
        // A failed signout must not turn a completed password change into a false failure.
        try {
          const revoked = await auth.signOut({ scope: 'global' });
          if (revoked.error) throw new Error('Session revocation failed');
          return { ok: true, message: 'Your password was changed. Sign in with your new password next time.' };
        } catch {
          return { ok: true, message: 'Your password was changed. We could not sign out your other sessions; sign out on your other devices when possible.' };
        }
      } catch {
        return { ok: false, message: 'Could not confirm the password change. Check your connection and try signing in with the new password.' };
      } finally { busy = false; }
    },
  };
}
