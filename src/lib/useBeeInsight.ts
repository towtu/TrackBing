import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { createBeeClient, createBeeRequest } from "./beeChat";
import { subscribeFoodLogChanged } from "./foodLogEvents";
import type { BeeInsight } from "../../supabase/functions/_shared/beeTypes";
/** Server revision/day/expiry owns freshness; changes trigger once, never a mascot render/tap. */
export function useBeeInsight(contextKey: string) {
  const [insight, setInsight] = useState<BeeInsight | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(
    () => subscribeFoodLogChanged(() => setRevision((value) => value + 1)),
    [],
  );
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
    void (async () => {
      try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: entitlement, error } = await supabase.rpc(
        "account_entitlement",
      );
      if (!active || error || entitlement?.tier !== "pro") {
        if (active) setInsight(null);
        return;
      }
      client = createBeeClient(session.user.id);
      const result = await client.send(createBeeRequest({ kind: "insight" }));
      if (active && result?.ok) setInsight(result.snapshot.insight ?? null);
      } catch {
        if (active) setInsight(null); // Dashboard keeps its ordinary offline action.
      }
    })();
    return () => {
      active = false;
      client?.dispose();
    };
  }, [contextKey, revision]);
  return insight && Date.parse(insight.expires_at) > Date.now()
    ? insight
    : null;
}
