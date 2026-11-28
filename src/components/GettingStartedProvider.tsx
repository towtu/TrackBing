import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { gettingStartedSteps, isNewTrackBingAccount, tourStorageKey, type TourTarget } from "@/src/lib/gettingStarted";
import { GettingStartedTour, type TourAnchor } from "./GettingStartedTour";

type TourControls = {
  start: () => void;
  suspendInsight: boolean;
  registerAnchor: (target: TourTarget, anchor: TourAnchor | null) => void;
};

const TourContext = createContext<TourControls>({
  start: () => undefined,
  suspendInsight: false,
  registerAnchor: () => undefined,
});

type Props = { account?: { id: string; created_at: string }; children: ReactNode };

export function GettingStartedProvider({ account, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const storageKey = account && tourStorageKey(account.id);
  const eligible = isNewTrackBingAccount(account?.created_at);
  const [autoStart, setAutoStart] = useState<"checking" | "ready" | "handled">("checking");
  const [step, setStep] = useState<number | null>(null);
  const [anchors, setAnchors] = useState<Partial<Record<TourTarget, TourAnchor | null>>>({});
  const current = step === null ? null : gettingStartedSteps[step];

  useEffect(() => {
    if (!eligible || !storageKey) return;
    let active = true;
    void AsyncStorage.getItem(storageKey).then(
      (value) => { if (active) setAutoStart(previous => previous === "checking" && value !== "seen" ? "ready" : "handled"); },
      () => { if (active) setAutoStart("handled"); },
    );
    return () => { active = false; };
  }, [eligible, storageKey]);

  useEffect(() => {
    if (autoStart === "ready" && pathname === "/" && anchors.calories) {
      setAutoStart("handled");
      setStep(0);
    }
  }, [anchors.calories, autoStart, pathname]);

  const registerAnchor = useCallback<TourControls["registerAnchor"]>((target, anchor) => {
    setAnchors(previous =>
      previous[target]?.element === anchor?.element && previous[target]?.scrollBy === anchor?.scrollBy
        ? previous : { ...previous, [target]: anchor },
    );
  }, []);

  const goToStep = useCallback((index: number) => {
    const path = gettingStartedSteps[index].path;
    setStep(index);
    if (pathname !== path) router.navigate(path);
  }, [pathname, router]);

  const start = useCallback(() => {
    if (!storageKey) return;
    setAutoStart("handled");
    goToStep(0);
  }, [goToStep, storageKey]);

  const finish = (goHome: boolean) => {
    setStep(null);
    setAutoStart("handled");
    if (storageKey) void AsyncStorage.setItem(storageKey, "seen").catch(() => {
      if (__DEV__) console.warn("Unable to save the TrackBing tour preference.");
    });
    if (goHome && pathname !== "/") router.navigate("/");
  };

  const suspendInsight = step !== null || (eligible && autoStart !== "handled");
  const controls = useMemo(() => ({ start, suspendInsight, registerAnchor }), [registerAnchor, start, suspendInsight]);

  return <TourContext.Provider value={controls}>
    {children}
    {current && step !== null && <GettingStartedTour
      step={step}
      onScreen={pathname === current.path}
      anchor={anchors[current.target] ?? undefined}
      onBack={() => goToStep(step - 1)}
      onNext={() => {
        if (pathname !== current.path) goToStep(step);
        else if (step + 1 === gettingStartedSteps.length) finish(true);
        else goToStep(step + 1);
      }}
      onSkip={() => finish(false)}
    />}
  </TourContext.Provider>;
}

export function useGettingStarted() {
  return useContext(TourContext);
}

export function useTourAnchor(target: TourTarget, scrollBy?: TourAnchor["scrollBy"]) {
  const { registerAnchor } = useGettingStarted();
  return useCallback((element: TourAnchor["element"] | null) => {
    registerAnchor(target, element ? { element, scrollBy } : null);
  }, [registerAnchor, scrollBy, target]);
}
