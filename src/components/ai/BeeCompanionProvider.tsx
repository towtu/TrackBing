import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { accountDay } from "@/src/lib/accountDay";
import { buildBeeUserContext, chooseBeeUserSituation, type BeeUserContext } from "@/src/lib/beeCompanionContext";
import type { BeeSituation } from "@/src/lib/beeCompanion";
import { createFoodAccountGuard } from "@/src/lib/foodAccountGuard";
import { subscribeFoodLogChanged } from "@/src/lib/foodLogEvents";
import { supabase } from "@/src/lib/supabase";

// Device accessibility preference only; no account details or nutrition in storage.
const MOTION_KEY = "trackbing:bee-motion";
const Companion = createContext({
  situation: "greeting" as BeeSituation,
  motionEnabled: false,
  toggleMotion: () => {},
  celebrateSaved: () => {},
});
export const useBeeCompanion = () => useContext(Companion);

/** One private, read-only context across routes. No model call for art or motion. */
export function BeeCompanionProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [context, setContext] = useState<BeeUserContext | null>(null);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionRef = useRef(false);
  const motionRevision = useRef(0);

  useEffect(() => {
    let active = true;
    const revision = motionRevision.current;
    void AsyncStorage.getItem(MOTION_KEY).then((value) => {
      if (active && revision === motionRevision.current) { motionRef.current = value !== "paused"; setMotionEnabled(motionRef.current); }
    }).catch(() => { console.warn("Bee motion preference could not load; motion remains paused."); });
    return () => { active = false; };
  }, []);
  const toggleMotion = useCallback(() => {
    motionRevision.current++;
    motionRef.current = !motionRef.current;
    setMotionEnabled(motionRef.current);
    void AsyncStorage.setItem(MOTION_KEY, motionRef.current ? "enabled" : "paused")
      .catch(() => console.warn("Bee motion preference could not be saved on this device."));
  }, []);
  const celebrateSaved = useCallback(() => {
    if (celebrationTimer.current) clearTimeout(celebrationTimer.current);
    setCelebrating(true);
    celebrationTimer.current = setTimeout(() => setCelebrating(false), 8000);
  }, []);
  useEffect(() => () => { if (celebrationTimer.current) clearTimeout(celebrationTimer.current); }, []);

  useEffect(() => {
    const guard = createFoodAccountGuard();
    let mounted = true, running = false, queued = false;
    let zone: unknown, date: string | null = null;
    const refresh = async () => {
      if (running) { queued = true; return; }
      running = true;
      try {
        do {
          queued = false;
          try {
            const account = await guard.authorize();
            if (!mounted || !account || account.userId !== userId) { if (mounted) setContext(null); return; }
            const { data: goal, error: goalError } = await account.client.from("user_goals")
              .select("time_zone,calorie_target").eq("user_id", userId).maybeSingle();
            if (goalError) throw new Error("Companion context unavailable");
            const day = accountDay(goal?.time_zone);
            const [foods, weights] = await Promise.all([
              account.client.from("food_logs").select("calories").eq("user_id", userId)
                .gte("created_at", day.start).lt("created_at", day.end).limit(250),
              account.client.from("weight_logs").select("is_baseline")
                .eq("user_id", userId).eq("is_baseline", false)
                .gte("measured_at", day.start).lt("measured_at", day.end)
                .order("measured_at", { ascending: false }).limit(1),
            ]);
            if (!mounted || !account.isActive()) return;
            if (foods.error) throw new Error("Companion diary unavailable");
            if (queued) continue;
            zone = day.timeZone; date = day.date;
            setContext(buildBeeUserContext(day.date, goal, foods.data, weights.error || !weights.data?.[0] ? null : { local_date: day.date, is_baseline: weights.data[0].is_baseline }));
          } catch {
            if (mounted) setContext(null); // Unknown data stays neutral, never a false progress cue.
          }
        } while (mounted && queued);
      } finally { running = false; }
    };
    void refresh();
    const off = subscribeFoodLogChanged(() => { setContext(null); void refresh(); });
    const auth = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) { setContext(null); setCelebrating(false); }
    }).data.subscription;
    const onResume = () => { if (mounted) { setContext(null); void refresh(); } };
    const app = AppState.addEventListener("change", (state) => { if (state === "active") onResume(); });
    const onVisibility = () => { if (!document.hidden) onResume(); };
    if (Platform.OS === "web") document.addEventListener("visibilitychange", onVisibility);
    const dayTimer = setInterval(() => {
      if (Platform.OS === "web" ? document.hidden : AppState.currentState !== "active") return;
      if (date !== accountDay(zone).date) { setContext(null); void refresh(); }
    }, 60_000);
    return () => {
      mounted = false; guard.dispose(); off(); auth.unsubscribe(); app.remove(); clearInterval(dayTimer);
      if (Platform.OS === "web") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [userId]);

  return <Companion.Provider value={{ situation: celebrating ? "celebrating" : chooseBeeUserSituation(context), motionEnabled, toggleMotion, celebrateSaved }}>{children}</Companion.Provider>;
}
