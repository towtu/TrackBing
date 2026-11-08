import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { createBeeClient, createBeeRequest } from "./beeChat";
import { emitFoodLogChanged } from "./foodLogEvents";
import type { BeeInsight } from "../../supabase/functions/_shared/beeTypes";
/** Server revision/day/expiry owns freshness; changes trigger once, never a mascot render/tap. */
export function useBeeInsight(contextKey: string | null) {
  const [insight, setInsight] = useState<BeeInsight | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(() => {
      setInsight(null);
      setRevision((value) => value + 1);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    let active = true;
    let client: ReturnType<typeof createBeeClient> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    setInsight(null);
    if (contextKey === null) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!active || !session) return;
        const { data: entitlement, error } = await supabase.rpc(
          "account_entitlement",
        );
        if (!active || error || entitlement?.tier !== "pro") return;
        client = createBeeClient(session.user.id);
        const result = await client.send(createBeeRequest({ kind: "insight" }));
        if (!active) return;
        const next = result?.ok ? result.snapshot.insight : null;
        const remaining = next ? Date.parse(next.expires_at) - Date.now() : 0;
        if (!next || !Number.isFinite(remaining) || remaining <= 0) return;
        setInsight(next);
        // Recheck the server cache once at expiry/local midnight, never on renders.
        // Failed or already expired responses schedule no automatic retry.
        expiry = setTimeout(() => {
          setInsight(null);
          // Dashboard finishes refreshing its date/totals before advancing contextKey.
          emitFoodLogChanged();
        }, Math.min(remaining, 2_147_483_647)); // Native/browser timers use signed 32-bit delays.
      } catch {
        if (active) setInsight(null); // Dashboard keeps its ordinary offline action.
      }
    })();
    return () => {
      active = false;
      client?.dispose();
      if (expiry !== undefined) clearTimeout(expiry);
    };
  }, [contextKey, revision]);
  return insight && Date.parse(insight.expires_at) > Date.now()
    ? insight
    : null;
}
