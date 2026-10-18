import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/** A form belongs to its mounted account, including while auth requests are pending. */
export function createFoodAccountGuard() {
  let active = true;
  let ownerId: string | null = null;
  const initial = supabase.auth.getSession().then(({ data: { session } }) => {
    if (!active || !session || (ownerId !== null && ownerId !== session.user.id)) {
      active = false;
      return null;
    }
    ownerId = session.user.id;
    return ownerId;
  }).catch(() => {
    active = false;
    return null;
  });
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || (ownerId !== null && session?.user.id !== ownerId)) active = false;
    else if (session && ownerId === null) ownerId = session.user.id;
  });

  return {
    isActive: () => active,
    async authorize() {
      try {
        const originalOwner = await initial;
        if (!active || !originalOwner) return null;
        const { data: { session } } = await supabase.auth.getSession();
        if (!active || session?.user.id !== originalOwner) return null;
        const token = session.access_token;
        const verified = await supabase.auth.getUser(token);
        if (!active || verified.error || verified.data.user?.id !== originalOwner) return null;
        const current = await supabase.auth.getSession();
        if (!active || current.data.session?.user.id !== originalOwner) return null;
        // accessToken bypasses SDK session storage. This client can never pick up another account's JWT.
        const client = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
          accessToken: async () => active ? token : null,
        });
        return { userId: originalOwner, client, isActive: () => active };
      } catch {
        return null;
      }
    },
    dispose() {
      active = false;
      subscription.unsubscribe();
    },
  };
}
