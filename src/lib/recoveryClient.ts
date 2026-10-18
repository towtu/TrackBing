import { createClient } from '@supabase/supabase-js';
import { createPasswordRecovery } from './passwordRecovery';

export function createRecoveryClient() {
  const client = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { storageKey: 'trackbing-password-recovery', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18000);
      try { return await fetch(input, { ...init, signal: controller.signal }); }
      finally { clearTimeout(timer); }
    } },
  });
  return createPasswordRecovery(client.auth);
}
